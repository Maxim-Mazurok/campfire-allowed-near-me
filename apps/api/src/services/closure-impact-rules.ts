import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type {
  ClosureImpactConfidence,
  ClosureImpactLevel,
  ClosureNoticeStructuredImpact,
  ForestClosureNotice
} from "../types/domain.js";

export type ModelProfile = "balanced" | "max_quality" | "low_cost";

export const loadEnvFile = (filePath: string): void => {
  if (!existsSync(filePath)) {
    return;
  }

  let content = "";
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    const key = trimmed.slice(0, separator).trim();
    if (!key || process.env[key]) {
      continue;
    }

    const rawValue = trimmed.slice(separator + 1).trim();
    const normalizedValue = rawValue.replace(/^['"]|['"]$/g, "");
    process.env[key] = normalizedValue;
  }
};

export const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
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

export const parsePositiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

export const parseNonNegativeInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
};

export const parseModelProfile = (value: string | undefined): ModelProfile => {
  if (value === "low_cost" || value === "max_quality" || value === "balanced") {
    return value;
  }
  return "balanced";
};

export const MAX_DETAIL_TEXT_CHARS = 5_000;

const IMPACT_LEVEL_ORDER: Record<ClosureImpactLevel, number> = {
  NONE: 0,
  ADVISORY: 1,
  RESTRICTED: 2,
  CLOSED: 3,
  UNKNOWN: -1
};

export const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

export const toImpactLevel = (value: unknown, fallback: ClosureImpactLevel): ClosureImpactLevel => {
  if (
    value === "NONE" ||
    value === "ADVISORY" ||
    value === "RESTRICTED" ||
    value === "CLOSED" ||
    value === "UNKNOWN"
  ) {
    return value;
  }

  return fallback;
};

export const toConfidence = (
  value: unknown,
  fallback: ClosureImpactConfidence
): ClosureImpactConfidence => {
  if (value === "LOW" || value === "MEDIUM" || value === "HIGH") {
    return value;
  }

  return fallback;
};

export const hasImpactRestriction = (value: ClosureImpactLevel): boolean =>
  value === "RESTRICTED" || value === "CLOSED";

export const clampText = (value: string | null | undefined, maxLength: number): string | null => {
  if (!value) {
    return null;
  }

  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
};

const mergeImpactLevel = (
  left: ClosureImpactLevel,
  right: ClosureImpactLevel
): ClosureImpactLevel => {
  if ((IMPACT_LEVEL_ORDER[right] ?? -1) > (IMPACT_LEVEL_ORDER[left] ?? -1)) {
    return right;
  }
  return left;
};

const inferExplicitCampingOpen = (text: string): boolean =>
  /\bcamp(?:ing|ground)?(?:\s+areas?)?.{0,50}\b(open|reopen|remain open)\b/i.test(text);

const inferExplicitAccessOpen = (text: string): boolean =>
  /\b(access|road|roads|track|tracks|trail|trails).{0,50}\b(open|reopen|accessible)\b/i.test(
    text
  );

export const inferClosureStructuredImpactByRules = (
  notice: Pick<ForestClosureNotice, "title" | "detailText" | "status">
): ClosureNoticeStructuredImpact => {
  const title = normalizeText(notice.title ?? "");
  const detailText = clampText(notice.detailText ?? null, MAX_DETAIL_TEXT_CHARS);
  const text = normalizeText([title, detailText ?? ""].filter(Boolean).join(" "));
  const lower = text.toLowerCase();

  const reasons: string[] = [];
  const partialSignals =
    /\b(partial|partly|partially|sections?\s+of|exclusive use on part|limited camping)\b/i.test(
      lower
    );
  const remainsOpenSignal =
    /\bforest will remain open\b/i.test(lower) || /\bremain open\b/i.test(lower);
  const fullClosureSignal =
    notice.status === "CLOSED" && !partialSignals && !remainsOpenSignal;

  let campingImpact: ClosureImpactLevel = "NONE";
  let access2wdImpact: ClosureImpactLevel = "NONE";
  let access4wdImpact: ClosureImpactLevel = "NONE";
  let confidence: ClosureImpactConfidence = "LOW";

  if (fullClosureSignal) {
    campingImpact = "CLOSED";
    access2wdImpact = "CLOSED";
    access4wdImpact = "CLOSED";
    confidence = "HIGH";
    reasons.push("Notice is marked closed with no partial/open exception wording.");
  } else {
    if (!inferExplicitCampingOpen(lower)) {
      if (
        /\bcamp(?:ing|ground)?(?:\s+areas?)?.{0,55}\b(closed|closure|not permissible|no access)\b/i.test(
          lower
        )
      ) {
        campingImpact = "CLOSED";
        confidence = "MEDIUM";
        reasons.push("Camping closure language detected.");
      } else if (
        /\bcamp(?:ing|ground)?(?:\s+areas?)?.{0,55}\b(limited|restricted|busy|close proximity)\b/i.test(
          lower
        )
      ) {
        campingImpact = "RESTRICTED";
        confidence = "MEDIUM";
        reasons.push("Camping restriction language detected.");
      }
    }

    const genericAccessClosure =
      /\b(road|roads|track|tracks|trail|trails|vehicle access|access)\b.{0,55}\b(closed|closure|blocked|no access|avoid)\b/i.test(
        lower
      );
    if (genericAccessClosure && !inferExplicitAccessOpen(lower)) {
      access2wdImpact = mergeImpactLevel(access2wdImpact, "RESTRICTED");
      access4wdImpact = mergeImpactLevel(access4wdImpact, "RESTRICTED");
      confidence = confidence === "LOW" ? "MEDIUM" : confidence;
      reasons.push("Road/access closure language detected.");
    }

    if (
      /\b(2wd|two[-\s]?wheel)\b.{0,45}\b(closed|closure|restricted|limited|no access)\b/i.test(
        lower
      )
    ) {
      access2wdImpact = mergeImpactLevel(access2wdImpact, "RESTRICTED");
      confidence = confidence === "LOW" ? "MEDIUM" : confidence;
      reasons.push("2WD restriction language detected.");
    }

    if (
      /\b(4wd|four[-\s]?wheel)\b.{0,45}\b(closed|closure|restricted|limited|no access)\b/i.test(
        lower
      )
    ) {
      access4wdImpact = mergeImpactLevel(access4wdImpact, "RESTRICTED");
      confidence = confidence === "LOW" ? "MEDIUM" : confidence;
      reasons.push("4WD restriction language detected.");
    }

    if (
      notice.status === "PARTIAL" &&
      access2wdImpact === "NONE" &&
      access4wdImpact === "NONE"
    ) {
      access2wdImpact = "RESTRICTED";
      access4wdImpact = "RESTRICTED";
      confidence = confidence === "LOW" ? "MEDIUM" : confidence;
      reasons.push("Partial closure status implies at least some access restrictions.");
    }

    if (
      /\b(plan ahead|extremely busy|consider alternative|increased truck traffic)\b/i.test(lower)
    ) {
      if (campingImpact === "NONE") {
        campingImpact = "ADVISORY";
      }
      confidence = confidence === "LOW" ? "MEDIUM" : confidence;
      reasons.push("Advisory travel/crowding language detected.");
    }
  }

  return {
    source: "RULES",
    confidence,
    campingImpact,
    access2wdImpact,
    access4wdImpact,
    rationale: reasons.length ? reasons.join(" ") : "No specific impact language detected."
  };
};

export const buildNoticeHash = (notice: ForestClosureNotice): string => {
  const payload = JSON.stringify({
    title: notice.title,
    detailText: clampText(notice.detailText ?? null, MAX_DETAIL_TEXT_CHARS),
    status: notice.status,
    listedAt: notice.listedAt,
    untilAt: notice.untilAt
  });

  return createHash("sha256").update(payload).digest("hex");
};
