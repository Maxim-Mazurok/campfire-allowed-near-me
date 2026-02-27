import { createHash } from "node:crypto";
import { readJsonFile, writeJsonFile } from "../utils/fs-cache.js";
import type { BanStatus, SolidFuelBanScope } from "../types/domain.js";

const DEFAULT_BAN_SCOPE_LLM_CACHE_PATH = "data/cache/ban-scope-llm.json";
const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_STATUS_TEXT_CHARS = 500;

interface BanScopeEnricherOptions {
  cachePath?: string;
  cacheTtlMs?: number;
  verbose?: boolean;
}

interface BanScopeCacheEntry {
  inputHash: string;
  updatedAt: string;
  result: BanScopeLlmResult;
}

interface BanScopeCacheArchive {
  schemaVersion: number;
  entries: Record<string, BanScopeCacheEntry>;
}

interface BanScopeLlmResult {
  banStatus: BanStatus;
  banScope: SolidFuelBanScope;
  rationale: string | null;
}

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

const buildInputHash = (statusText: string): string =>
  createHash("sha256").update(normalizeText(statusText)).digest("hex");

const toBanStatus = (value: unknown): BanStatus | null => {
  if (value === "NOT_BANNED" || value === "BANNED" || value === "UNKNOWN") {
    return value;
  }
  return null;
};

const toBanScope = (value: unknown): SolidFuelBanScope | null => {
  if (value === "ALL" || value === "OUTSIDE_CAMPS" || value === "INCLUDING_CAMPS") {
    return value;
  }
  return null;
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }

  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  return fallback;
};

export interface QuestionableBanStatus {
  areaName: string;
  statusText: string;
  fallbackBanStatus: BanStatus;
  fallbackBanScope: SolidFuelBanScope;
}

export interface EnrichedBanScope {
  areaName: string;
  banStatus: BanStatus;
  banScope: SolidFuelBanScope;
  source: "LLM" | "FALLBACK";
  rationale: string | null;
}

export class BanScopeEnricher {
  private readonly enabled: boolean;

  private readonly endpoint: string;

  private readonly apiKey: string;

  private readonly deployment: string;

  private readonly timeoutMs: number;

  private readonly cachePath: string;

  private readonly cacheTtlMs: number;

  private readonly log: (message: string) => void;

  private cacheLoaded = false;

  private cacheDirty = false;

  private readonly cache = new Map<string, BanScopeCacheEntry>();

  constructor(options?: BanScopeEnricherOptions) {
    const endpoint = (process.env.AZURE_OPENAI_ENDPOINT ?? "").trim().replace(/\/+$/, "");
    const apiKey = (process.env.AZURE_OPENAI_API_KEY ?? "").trim();
    const deployment = (
      process.env.BAN_SCOPE_LLM_DEPLOYMENT ??
      process.env.CLOSURE_LLM_DEPLOYMENT ??
      process.env.AZURE_OPENAI_DEPLOYMENT_REASONER ??
      ""
    ).trim();

    const autoEnabled = Boolean(endpoint && apiKey && deployment);
    const enabled = parseBoolean(process.env.BAN_SCOPE_LLM_ENABLED, autoEnabled);

    this.enabled = enabled && autoEnabled;
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.deployment = deployment;
    this.timeoutMs = 30_000;
    this.cachePath = options?.cachePath ?? DEFAULT_BAN_SCOPE_LLM_CACHE_PATH;
    this.cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.log = options?.verbose ? (message) => console.log(`  ${message}`) : () => {};
  }

  async enrichQuestionableStatuses(
    questionableStatuses: QuestionableBanStatus[]
  ): Promise<{ results: EnrichedBanScope[]; warnings: string[] }> {
    const warnings: string[] = [];

    if (questionableStatuses.length === 0) {
      return { results: [], warnings };
    }

    this.log(`[ban-scope] ${questionableStatuses.length} questionable ban status(es) to classify`);
    await this.loadCacheIfNeeded();

    let llmCalls = 0;
    let llmErrors = 0;
    let cacheHits = 0;
    const results: EnrichedBanScope[] = [];

    for (const questionable of questionableStatuses) {
      const inputHash = buildInputHash(questionable.statusText);
      const cached = this.getCacheEntry(inputHash);

      if (cached) {
        cacheHits += 1;
        results.push({
          areaName: questionable.areaName,
          banStatus: cached.banStatus,
          banScope: cached.banScope,
          source: "LLM",
          rationale: cached.rationale
        });
        continue;
      }

      if (!this.enabled) {
        results.push({
          areaName: questionable.areaName,
          banStatus: questionable.fallbackBanStatus,
          banScope: questionable.fallbackBanScope,
          source: "FALLBACK",
          rationale: "LLM not available; using regex fallback"
        });
        continue;
      }

      try {
        this.log(`[ban-scope] LLM call for "${questionable.areaName}": "${questionable.statusText.slice(0, 80)}..."`);
        const result = await this.classifyWithLlm(questionable.statusText);
        this.cache.set(inputHash, {
          inputHash,
          updatedAt: new Date().toISOString(),
          result
        });
        this.cacheDirty = true;
        llmCalls += 1;
        results.push({
          areaName: questionable.areaName,
          banStatus: result.banStatus,
          banScope: result.banScope,
          source: "LLM",
          rationale: result.rationale
        });
      } catch (error) {
        llmErrors += 1;
        this.log(`[ban-scope] LLM error for "${questionable.areaName}": ${error instanceof Error ? error.message : "Unknown"}`);
        results.push({
          areaName: questionable.areaName,
          banStatus: questionable.fallbackBanStatus,
          banScope: questionable.fallbackBanScope,
          source: "FALLBACK",
          rationale: `LLM failed: ${error instanceof Error ? error.message : "Unknown error"}`
        });
      }
    }

    await this.persistCacheIfNeeded();

    this.log(
      `[ban-scope] Done: ${llmCalls} LLM call(s), ${cacheHits} cache hit(s), ${llmErrors} error(s)`
    );

    if (llmCalls > 0) {
      warnings.push(`AI classified ${llmCalls} questionable ban status text(s).`);
    }

    if (llmErrors > 0) {
      warnings.push(`AI classification failed for ${llmErrors} ban status text(s); regex fallback was used.`);
    }

    return { results, warnings };
  }

  private async classifyWithLlm(statusText: string): Promise<BanScopeLlmResult> {
    const clampedText = statusText.length > MAX_STATUS_TEXT_CHARS
      ? `${statusText.slice(0, MAX_STATUS_TEXT_CHARS)}...`
      : statusText;

    const prompt = [
      "Task: classify this NSW Forestry Corp solid fuel fire ban status text.",
      "",
      "Output JSON with exactly these keys:",
      "- ban_status: NOT_BANNED | BANNED | UNKNOWN",
      "- ban_scope: ALL | OUTSIDE_CAMPS | INCLUDING_CAMPS",
      "- rationale: short plain sentence",
      "",
      "Definitions:",
      "- ban_scope=ALL: ban or no-ban applies everywhere, no camp-specific distinction",
      "- ban_scope=OUTSIDE_CAMPS: fires banned outside designated campgrounds but permitted inside campgrounds",
      "- ban_scope=INCLUDING_CAMPS: fires banned in all areas including camping areas",
      "",
      "Rules:",
      "- If fires are banned only outside camps: ban_status=BANNED, ban_scope=OUTSIDE_CAMPS",
      "- If fires are banned including camping areas: ban_status=BANNED, ban_scope=INCLUDING_CAMPS",
      "- If fires are banned with no camp-specific mention: ban_status=BANNED, ban_scope=ALL",
      "- If no ban: ban_status=NOT_BANNED, ban_scope=ALL",
      "- Return only JSON.",
      "",
      `Status text: ${clampedText}`
    ].join("\n");

    const response = await fetch(`${this.endpoint}/openai/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": this.apiKey
      },
      body: JSON.stringify({
        model: this.deployment,
        temperature: 0,
        max_tokens: 300,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You classify NSW forest fire ban status texts. Return valid JSON only."
          },
          { role: "user", content: prompt }
        ]
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Azure OpenAI request failed (${response.status}): ${body.slice(0, 240)}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = payload.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new Error("Azure OpenAI response did not include JSON content.");
    }

    const parsed = JSON.parse(content) as Record<string, unknown>;
    return {
      banStatus: toBanStatus(parsed.ban_status) ?? "UNKNOWN",
      banScope: toBanScope(parsed.ban_scope) ?? "ALL",
      rationale: typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 400) : null
    };
  }

  private getCacheEntry(inputHash: string): BanScopeLlmResult | null {
    const cached = this.cache.get(inputHash);
    if (!cached || cached.inputHash !== inputHash) {
      return null;
    }

    const updatedAtMs = Date.parse(cached.updatedAt);
    if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > this.cacheTtlMs) {
      this.cache.delete(inputHash);
      this.cacheDirty = true;
      return null;
    }

    return cached.result;
  }

  private async loadCacheIfNeeded(): Promise<void> {
    if (this.cacheLoaded) {
      return;
    }

    this.cacheLoaded = true;
    const archive = await readJsonFile<BanScopeCacheArchive>(this.cachePath);
    if (!archive || archive.schemaVersion !== CACHE_SCHEMA_VERSION) {
      return;
    }

    for (const [id, entry] of Object.entries(archive.entries ?? {})) {
      if (
        typeof entry?.inputHash !== "string" ||
        typeof entry?.updatedAt !== "string" ||
        typeof entry?.result !== "object" ||
        !entry.result
      ) {
        continue;
      }

      const result = entry.result;
      const sanitizedResult: BanScopeLlmResult = {
        banStatus: toBanStatus(result.banStatus) ?? "UNKNOWN",
        banScope: toBanScope(result.banScope) ?? "ALL",
        rationale: typeof result.rationale === "string" ? result.rationale : null
      };

      this.cache.set(id, {
        inputHash: entry.inputHash,
        updatedAt: entry.updatedAt,
        result: sanitizedResult
      });
    }
  }

  private async persistCacheIfNeeded(): Promise<void> {
    if (!this.cacheDirty) {
      return;
    }

    const archive: BanScopeCacheArchive = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      entries: Object.fromEntries(this.cache.entries())
    };
    await writeJsonFile(this.cachePath, archive);
    this.cacheDirty = false;
  }
}
