import { join } from "node:path";
import { DEFAULT_CLOSURE_LLM_CACHE_PATH } from "../utils/default-cache-paths.js";
import { readJsonFile, writeJsonFile } from "../utils/fs-cache.js";
import type {
  ClosureImpactConfidence,
  ClosureImpactLevel,
  ClosureNoticeStructuredImpact,
  ForestClosureNotice
} from "../types/domain.js";
import {
  MAX_DETAIL_TEXT_CHARS,
  type ModelProfile,
  buildNoticeHash,
  clampText,
  hasImpactRestriction,
  inferClosureStructuredImpactByRules,
  loadEnvFile,
  parseBoolean,
  parseModelProfile,
  parseNonNegativeInteger,
  parsePositiveInteger,
  toConfidence,
  toImpactLevel
} from "./closure-impact-rules.js";

export { inferClosureStructuredImpactByRules } from "./closure-impact-rules.js";

interface ClosureImpactEnricherOptions {
  envFilePath?: string | null;
  cachePath?: string;
  cacheTtlMs?: number;
  maxNoticesPerRefresh?: number;
}

interface ClosureImpactCacheEntry {
  inputHash: string;
  updatedAt: string;
  impact: ClosureNoticeStructuredImpact;
}

interface ClosureImpactCacheArchive {
  schemaVersion: number;
  entries: Record<string, ClosureImpactCacheEntry>;
}

interface LlmStructuredImpactDraft {
  campingImpact: ClosureImpactLevel;
  access2wdImpact: ClosureImpactLevel;
  access4wdImpact: ClosureImpactLevel;
  confidence: ClosureImpactConfidence;
  rationale: string | null;
}

const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_NOTICES_PER_REFRESH = 12;

export class ClosureImpactEnricher {
  private readonly enabled: boolean;

  private readonly endpoint: string;

  private readonly apiKey: string;

  private readonly deploymentReasoner: string;

  private readonly deploymentDeep: string | null;

  private readonly modelProfile: ModelProfile;

  private readonly timeoutMs: number;

  private readonly rateLimitRetries: number;

  private readonly minCallIntervalMs: number;

  private readonly cachePath: string;

  private readonly cacheTtlMs: number;

  private readonly maxNoticesPerRefresh: number;

  private nextAllowedCallAtMs = 0;

  private cacheLoaded = false;

  private cacheDirty = false;

  private readonly cache = new Map<string, ClosureImpactCacheEntry>();

  constructor(options?: ClosureImpactEnricherOptions) {
    const explicitEnvFilePath = options?.envFilePath ?? process.env.CLOSURE_LLM_ENV_FILE ?? null;
    if (explicitEnvFilePath) {
      loadEnvFile(explicitEnvFilePath);
    } else if (process.env.HOME) {
      loadEnvFile(join(process.env.HOME, "scenario-lab", ".env.local"));
    }

    const endpoint = (process.env.AZURE_OPENAI_ENDPOINT ?? "").trim().replace(/\/+$/, "");
    const apiKey = (process.env.AZURE_OPENAI_API_KEY ?? "").trim();
    const deploymentReasoner = (
      process.env.CLOSURE_LLM_DEPLOYMENT ??
      process.env.AZURE_OPENAI_DEPLOYMENT_REASONER ??
      ""
    ).trim();
    const deploymentDeep = (
      process.env.CLOSURE_LLM_DEPLOYMENT_DEEP ??
      process.env.AZURE_OPENAI_DEPLOYMENT_DEEP ??
      ""
    ).trim();
    const modelProfile = parseModelProfile(
      process.env.CLOSURE_LLM_MODEL_PROFILE ?? process.env.SCENARIO_LAB_MODEL_PROFILE
    );
    const scenarioTimeoutSec = Number.parseFloat(process.env.SCENARIO_LAB_TIMEOUT_SEC ?? "");
    const scenarioTimeoutMs = Number.isFinite(scenarioTimeoutSec) && scenarioTimeoutSec > 0
      ? `${Math.round(scenarioTimeoutSec * 1000)}`
      : undefined;
    const scenarioMinIntervalSec = Number.parseFloat(
      process.env.SCENARIO_LAB_MIN_CALL_INTERVAL_SEC ?? ""
    );
    const scenarioMinIntervalMs =
      Number.isFinite(scenarioMinIntervalSec) && scenarioMinIntervalSec >= 0
        ? `${Math.round(scenarioMinIntervalSec * 1000)}`
        : undefined;

    const autoEnabled = Boolean(endpoint && apiKey && deploymentReasoner);
    const enabled = parseBoolean(process.env.CLOSURE_LLM_ENABLED, autoEnabled);

    this.enabled = enabled && autoEnabled;
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.deploymentReasoner = deploymentReasoner;
    this.deploymentDeep = deploymentDeep || null;
    this.modelProfile = modelProfile;
    this.timeoutMs = parsePositiveInteger(
      process.env.CLOSURE_LLM_TIMEOUT_MS ?? scenarioTimeoutMs,
      90_000
    );
    this.rateLimitRetries = parseNonNegativeInteger(
      process.env.CLOSURE_LLM_RATE_LIMIT_RETRIES ?? process.env.SCENARIO_LAB_RATE_LIMIT_RETRIES,
      2
    );
    this.minCallIntervalMs = parseNonNegativeInteger(
      process.env.CLOSURE_LLM_MIN_CALL_INTERVAL_MS ?? scenarioMinIntervalMs,
      15_000
    );
    this.cachePath = options?.cachePath ??
      process.env.CLOSURE_LLM_CACHE_PATH ??
      DEFAULT_CLOSURE_LLM_CACHE_PATH;
    this.cacheTtlMs = options?.cacheTtlMs ??
      parsePositiveInteger(process.env.CLOSURE_LLM_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);
    this.maxNoticesPerRefresh = options?.maxNoticesPerRefresh ??
      parsePositiveInteger(
        process.env.CLOSURE_LLM_MAX_NOTICES_PER_REFRESH,
        DEFAULT_MAX_NOTICES_PER_REFRESH
      );
  }

  async enrichNotices(
    notices: ForestClosureNotice[]
  ): Promise<{ notices: ForestClosureNotice[]; warnings: string[] }> {
    const warnings = new Set<string>();
    await this.loadCacheIfNeeded();

    let llmCalls = 0;
    let llmFallbackCount = 0;
    let llmSkippedByBudgetCount = 0;
    let firstLlmError: string | null = null;

    const enriched: ForestClosureNotice[] = [];

    for (const notice of notices) {
      const normalizedNotice: ForestClosureNotice = {
        ...notice,
        detailText: clampText(notice.detailText ?? null, MAX_DETAIL_TEXT_CHARS)
      };

      const ruleImpact = inferClosureStructuredImpactByRules(normalizedNotice);
      let selectedImpact: ClosureNoticeStructuredImpact = ruleImpact;

      const shouldAttemptLlm =
        this.enabled &&
        Boolean(normalizedNotice.detailText) &&
        !(
          ruleImpact.confidence === "HIGH" &&
          hasImpactRestriction(ruleImpact.campingImpact) &&
          hasImpactRestriction(ruleImpact.access2wdImpact) &&
          hasImpactRestriction(ruleImpact.access4wdImpact)
        );

      if (shouldAttemptLlm) {
        const inputHash = buildNoticeHash(normalizedNotice);
        const cachedImpact = this.getCacheEntry(normalizedNotice.id, inputHash);
        if (cachedImpact) {
          selectedImpact = cachedImpact;
        } else if (llmCalls >= this.maxNoticesPerRefresh) {
          llmSkippedByBudgetCount += 1;
        } else {
          try {
            const llmDraft = await this.requestLlmStructuredImpact(normalizedNotice);
            selectedImpact = {
              source: "LLM",
              confidence: llmDraft.confidence,
              campingImpact: llmDraft.campingImpact,
              access2wdImpact: llmDraft.access2wdImpact,
              access4wdImpact: llmDraft.access4wdImpact,
              rationale: llmDraft.rationale
            };
            this.cache.set(normalizedNotice.id, {
              inputHash,
              updatedAt: new Date().toISOString(),
              impact: selectedImpact
            });
            this.cacheDirty = true;
            llmCalls += 1;
          } catch (error) {
            llmFallbackCount += 1;
            if (!firstLlmError) {
              firstLlmError = error instanceof Error ? error.message : "Unknown LLM error";
            }
          }
        }
      }

      enriched.push({
        ...normalizedNotice,
        structuredImpact: selectedImpact
      });
    }

    await this.persistCacheIfNeeded();

    if (llmCalls > 0) {
      warnings.add(
        `AI structured ${llmCalls} closure notice(s) to extract camping and 2WD/4WD access impacts.`
      );
    }

    if (llmFallbackCount > 0) {
      warnings.add(
        `AI structuring failed for ${llmFallbackCount} closure notice(s); deterministic parsing was used instead${firstLlmError ? ` (first error: ${firstLlmError})` : ""}.`
      );
    }

    if (llmSkippedByBudgetCount > 0) {
      warnings.add(
        `AI structuring skipped ${llmSkippedByBudgetCount} closure notice(s) due to per-refresh budget limit (${this.maxNoticesPerRefresh}).`
      );
    }

    return {
      notices: enriched,
      warnings: [...warnings]
    };
  }

  private async requestLlmStructuredImpact(
    notice: ForestClosureNotice
  ): Promise<LlmStructuredImpactDraft> {
    const deployment = this.selectDeployment();
    const prompt = this.buildPrompt(notice);
    const maxAttempts = this.rateLimitRetries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.waitForCallSlot();

      const response = await fetch(`${this.endpoint}/openai/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "api-key": this.apiKey
        },
        body: JSON.stringify({
          model: deployment,
          temperature: 0,
          max_tokens: 700,
          response_format: {
            type: "json_object"
          },
          messages: [
            {
              role: "system",
              content:
                "You extract structured impacts from NSW forest closure notices. Return valid JSON only."
            },
            {
              role: "user",
              content: prompt
            }
          ]
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });

      if (response.status === 429 && attempt < maxAttempts) {
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterMs = retryAfterHeader
          ? Math.max(1_000, Number.parseInt(retryAfterHeader, 10) * 1_000)
          : 15_000;
        await this.sleep(retryAfterMs + 1_000);
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Azure OpenAI request failed (${response.status}): ${body.slice(0, 240)}`);
      }

      this.nextAllowedCallAtMs = Date.now() + this.minCallIntervalMs;

      const payload = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") {
        throw new Error("Azure OpenAI response did not include JSON content.");
      }

      const parsed = JSON.parse(content) as Record<string, unknown>;
      const draft: LlmStructuredImpactDraft = {
        campingImpact: toImpactLevel(parsed.camping_impact, "UNKNOWN"),
        access2wdImpact: toImpactLevel(parsed.access_2wd_impact, "UNKNOWN"),
        access4wdImpact: toImpactLevel(parsed.access_4wd_impact, "UNKNOWN"),
        confidence: toConfidence(parsed.confidence, "MEDIUM"),
        rationale:
          typeof parsed.rationale === "string"
            ? clampText(parsed.rationale, 400)
            : null
      };

      return draft;
    }

    throw new Error("Azure OpenAI request did not complete after retries.");
  }

  private buildPrompt(notice: ForestClosureNotice): string {
    const detailText = clampText(notice.detailText ?? null, MAX_DETAIL_TEXT_CHARS) ?? "";
    return [
      "Task: convert this closure notice prose into structured impacts relevant to camping and vehicle access.",
      "Output JSON keys only:",
      "- camping_impact: NONE | ADVISORY | RESTRICTED | CLOSED | UNKNOWN",
      "- access_2wd_impact: NONE | ADVISORY | RESTRICTED | CLOSED | UNKNOWN",
      "- access_4wd_impact: NONE | ADVISORY | RESTRICTED | CLOSED | UNKNOWN",
      "- confidence: LOW | MEDIUM | HIGH",
      "- rationale: short plain sentence",
      "Rules:",
      "- Use UNKNOWN when the notice text does not provide enough information.",
      "- Do not infer burn legality; this task is only for closure/access/camping impact.",
      "- Return only JSON.",
      "",
      `Title: ${notice.title}`,
      `Status from listing: ${notice.status}`,
      `When: ${notice.listedAtText ?? "unknown"} until ${notice.untilText ?? "unknown"}`,
      `Detail: ${detailText}`
    ].join("\n");
  }

  private selectDeployment(): string {
    if (this.modelProfile === "low_cost") {
      return this.deploymentReasoner;
    }

    if (this.modelProfile === "max_quality") {
      return this.deploymentDeep ?? this.deploymentReasoner;
    }

    return this.deploymentReasoner;
  }

  private async waitForCallSlot(): Promise<void> {
    const waitMs = this.nextAllowedCallAtMs - Date.now();
    if (waitMs > 0) {
      await this.sleep(waitMs);
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private getCacheEntry(
    noticeId: string,
    inputHash: string
  ): ClosureNoticeStructuredImpact | null {
    const cached = this.cache.get(noticeId);
    if (!cached || cached.inputHash !== inputHash) {
      return null;
    }

    const updatedAtMs = Date.parse(cached.updatedAt);
    if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > this.cacheTtlMs) {
      this.cache.delete(noticeId);
      this.cacheDirty = true;
      return null;
    }

    return cached.impact;
  }

  private async loadCacheIfNeeded(): Promise<void> {
    if (this.cacheLoaded) {
      return;
    }

    this.cacheLoaded = true;
    const archive = await readJsonFile<ClosureImpactCacheArchive>(this.cachePath);
    if (!archive || archive.schemaVersion !== CACHE_SCHEMA_VERSION) {
      return;
    }

    for (const [id, entry] of Object.entries(archive.entries ?? {})) {
      if (
        typeof entry?.inputHash !== "string" ||
        typeof entry?.updatedAt !== "string" ||
        typeof entry?.impact !== "object" ||
        !entry.impact
      ) {
        continue;
      }

      const impact = entry.impact;
      const sanitizedImpact: ClosureNoticeStructuredImpact = {
        source: impact.source === "LLM" ? "LLM" : "RULES",
        confidence: toConfidence(impact.confidence, "MEDIUM"),
        campingImpact: toImpactLevel(impact.campingImpact, "UNKNOWN"),
        access2wdImpact: toImpactLevel(impact.access2wdImpact, "UNKNOWN"),
        access4wdImpact: toImpactLevel(impact.access4wdImpact, "UNKNOWN"),
        rationale: typeof impact.rationale === "string" ? impact.rationale : null
      };

      this.cache.set(id, {
        inputHash: entry.inputHash,
        updatedAt: entry.updatedAt,
        impact: sanitizedImpact
      });
    }
  }

  private async persistCacheIfNeeded(): Promise<void> {
    if (!this.cacheDirty) {
      return;
    }

    const archive: ClosureImpactCacheArchive = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      entries: Object.fromEntries(this.cache.entries())
    };
    await writeJsonFile(this.cachePath, archive);
    this.cacheDirty = false;
  }
}
