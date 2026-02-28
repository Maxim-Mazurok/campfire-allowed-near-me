import { load } from "cheerio";
import { isLikelyStateForestName } from "../utils/forest-name-validation.js";
import { normalizeForestLabel } from "../../shared/text-utils.js";
import type {
  BanStatus,
  ForestAreaSummary,
  SolidFuelBanScope
} from "../../shared/contracts.js";

// Re-export directory-related parsers from their dedicated module.
export {
  inferFacilityIconKey,
  parseFilterKey,
  parseForestDirectoryFilters,
  parseForestDirectoryForests,
  parseForestDirectoryForestNames,
  parseForestDirectoryWithFacilities
} from "./forestry-directory-parser.js";
export type { ForestDirectoryEntry } from "./forestry-directory-parser.js";

// Re-export closure-notice parsers from their dedicated module.
export {
  classifyClosureNoticeTags,
  parseClosureNoticeDetailPage,
  parseClosureNoticeForestNameHint,
  parseClosureNoticeStatus,
  parseClosureNoticesPage
} from "./forestry-closure-parser.js";

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// Fire-ban status classification
// ---------------------------------------------------------------------------

export interface BanStatusClassification {
  status: BanStatus;
  banScope: SolidFuelBanScope;
  confidence: "KNOWN" | "QUESTIONABLE";
}

/**
 * Trigger words that, when found at the *end* of a status text whose
 * beginning matched a known pattern, signal the sentence may carry
 * camp-specific semantics that cannot be resolved by regex alone.
 */
const SCOPE_TRIGGER_WORDS =
  /\b(campground|campgrounds|camping|camp\s+area|camp\s+areas|designated|plantation|foreshore)\b/i;

/**
 * Known patterns for ban status texts. Order matters – first match wins.
 * `scope` is the camp-scope the pattern implies.
 */
const KNOWN_BAN_PATTERNS: Array<{
  pattern: RegExp;
  status: BanStatus;
  banScope: SolidFuelBanScope;
}> = [
  // "No Solid Fuel Fire Ban" / "no ban"
  {
    pattern: /^no\s+solid\s+fuel\s+fire\s+ban$/,
    status: "NOT_BANNED",
    banScope: "ALL"
  },
  {
    pattern: /^no\s+ban$/,
    status: "NOT_BANNED",
    banScope: "ALL"
  },

  // "Solid fuel fires are banned outside designated campgrounds. … permitted inside …"
  {
    pattern:
      /^solid\s+fuel\s+fires?\s+(?:are\s+)?banned\s+outside\s+designated\s+campgrounds?\.?\s*solid\s+fuel\s+fires?\s+(?:are\s+)?permitted\s+inside\s+designated\s+campgrounds?\.?$/,
    status: "BANNED",
    banScope: "OUTSIDE_CAMPS"
  },

  // "Solid fuel fires are banned outside designated campgrounds."
  {
    pattern:
      /^solid\s+fuel\s+fires?\s+(?:are\s+)?banned\s+outside\s+designated\s+campgrounds?\.?$/,
    status: "BANNED",
    banScope: "OUTSIDE_CAMPS"
  },

  // "Solid fuel fires are permitted inside designated campgrounds."
  {
    pattern:
      /^solid\s+fuel\s+fires?\s+(?:are\s+)?permitted\s+inside\s+designated\s+campgrounds?\.?$/,
    status: "BANNED",
    banScope: "OUTSIDE_CAMPS"
  },

  // "Solid Fuel Fires banned in all plantation areas, including camping areas…"
  {
    pattern:
      /^solid\s+fuel\s+fires?\s+(?:are\s+)?banned\s+in\s+all\s+(?:plantation\s+)?areas?,?\s*including\s+camp/,
    status: "BANNED",
    banScope: "INCLUDING_CAMPS"
  },

  // Generic "Solid Fuel Fire Ban" / "Solid fuel fires banned"
  {
    pattern: /^solid\s+fuel\s+fire\s+ban$/,
    status: "BANNED",
    banScope: "ALL"
  },
  {
    pattern: /^solid\s+fuel\s+fires?\s+banned$/,
    status: "BANNED",
    banScope: "ALL"
  }
];

/**
 * Prefix patterns for partial matching. If the beginning of the text matches
 * one of these but the full text does not match any KNOWN_BAN_PATTERNS,
 * we check for trigger words to decide if the status is questionable.
 */
const BAN_PREFIX_PATTERNS: Array<{
  pattern: RegExp;
  status: BanStatus;
  banScope: SolidFuelBanScope;
}> = [
  { pattern: /^no\s+solid\s+fuel\s+fire\s+ban/, status: "NOT_BANNED", banScope: "ALL" },
  { pattern: /^no\s+ban/, status: "NOT_BANNED", banScope: "ALL" },
  { pattern: /^solid\s+fuel\s+fires?\s+(?:are\s+)?banned\s+outside\s+designated/, status: "BANNED", banScope: "OUTSIDE_CAMPS" },
  { pattern: /^solid\s+fuel\s+fires?\s+(?:are\s+)?permitted\s+inside\s+designated/, status: "BANNED", banScope: "OUTSIDE_CAMPS" },
  { pattern: /^solid\s+fuel\s+fires?\s+(?:are\s+)?banned\b/, status: "BANNED", banScope: "ALL" },
  { pattern: /^solid\s+fuel\s+fire\s+ban/, status: "BANNED", banScope: "ALL" },
  { pattern: /\btotal\s+fire\s+ban/, status: "BANNED", banScope: "ALL" },
  { pattern: /\bfires?\s+(?:are\s+)?banned\b/, status: "BANNED", banScope: "ALL" }
];

/**
 * Classify a ban-status text into BanStatus + SolidFuelBanScope.
 *
 * 1. Try each KNOWN_BAN_PATTERNS — full match (case-insensitive, whitespace-collapsed).
 * 2. If no full match, try prefix matching + trigger-word check.
 * 3. Return "QUESTIONABLE" confidence when only a prefix matches and the
 *    remainder contains camp-related trigger words.
 */
export const classifyBanStatusText = (rawStatusText: string): BanStatusClassification => {
  const text = normalizeText(rawStatusText).replace(/\s+/g, " ").trim();

  if (!text) {
    return { status: "UNKNOWN", banScope: "ALL", confidence: "KNOWN" };
  }

  const lowerText = text.toLowerCase();

  // Full-match against known patterns
  for (const known of KNOWN_BAN_PATTERNS) {
    if (known.pattern.test(lowerText)) {
      return { status: known.status, banScope: known.banScope, confidence: "KNOWN" };
    }
  }

  // Prefix matching
  for (const prefix of BAN_PREFIX_PATTERNS) {
    const prefixMatch = prefix.pattern.exec(lowerText);
    if (prefixMatch) {
      const remainder = lowerText.slice(prefixMatch[0].length);
      if (SCOPE_TRIGGER_WORDS.test(remainder)) {
        return { status: prefix.status, banScope: prefix.banScope, confidence: "QUESTIONABLE" };
      }
      return { status: prefix.status, banScope: prefix.banScope, confidence: "KNOWN" };
    }
  }

  return { status: "UNKNOWN", banScope: "ALL", confidence: "KNOWN" };
};

export const parseBanStatus = (rawStatusText: string): BanStatus => {
  return classifyBanStatusText(rawStatusText).status;
};

export const parseMainFireBanPage = (
  html: string,
  baseUrl: string
): ForestAreaSummary[] => {
  const $ = load(html);
  const rows: ForestAreaSummary[] = [];

  $("table tr").each((_, row) => {
    const link = $(row).find("a[href]").first();
    if (!link.length) {
      return;
    }

    const areaName = normalizeText(link.text());
    if (!areaName) {
      return;
    }

    const href = link.attr("href");
    if (!href) {
      return;
    }

    const areaUrl = new URL(href, baseUrl).toString();
    const cells = $(row)
      .find("th,td")
      .toArray()
      .map((cell) => {
        // Block-level children (e.g. multiple <p> tags inside a <td>) are
        // concatenated without whitespace by Cheerio's `.text()`.
        // Join their text with a space so sentences don't run together.
        const paragraphs = $(cell).find("p");
        if (paragraphs.length > 0) {
          return paragraphs
            .toArray()
            .map((paragraph) => normalizeText($(paragraph).text()))
            .filter(Boolean)
            .join(" ");
        }
        return normalizeText($(cell).text());
      })
      .filter(Boolean);

    // Forestry table is: area | solid fuel fire ban | firewood collection.
    // We intentionally read only the second column and ignore firewood.
    const statusText = cells[1] ?? "Unknown";
    const classification = classifyBanStatusText(statusText);

    rows.push({
      areaName,
      areaUrl,
      status: classification.status,
      statusText,
      banScope: classification.banScope
    });
  });

  const deduped = new Map<string, ForestAreaSummary>();
  for (const row of rows) {
    deduped.set(row.areaUrl, row);
  }

  return [...deduped.values()];
};

// ---------------------------------------------------------------------------
// Area forest name extraction
// ---------------------------------------------------------------------------

export const parseAreaForestNames = (html: string): string[] => {
  const $ = load(html);

  const includeRegex =
    /this area includes.*state forests|state forests around|state forests?.*include|following state forests/i;
  const excludedRegex =
    /excluded in this list|sit in the .* area list|are excluded|excluded in this area/i;

  const names = new Set<string>();

  const anchors = $("h1,h2,h3,h4,p,strong").filter((_, node) =>
    includeRegex.test(normalizeText($(node).text()))
  );

  const pushNamesFromList = (list: ReturnType<typeof $>): void => {
    list.find("li").each((_, li) => {
      const name = normalizeText($(li).text());
      if (!name || name.length > 100) {
        return;
      }

      if (/quicklinks|contact us|global site search|sustainability|visit a forest/i.test(name)) {
        return;
      }

      const normalizedName = normalizeForestLabel(name.replace(/[.,;]$/, ""));
      if (isLikelyStateForestName(normalizedName)) {
        names.add(normalizedName);
        return;
      }

      // Some area pages list forest names without the "State Forest" suffix
      // (e.g. "Micalong" instead of "Micalong State Forest").
      // Only auto-suffix names that don't already mention "state forest".
      if (normalizedName && !/state forest/i.test(normalizedName)) {
        const withSuffix = `${normalizedName} State Forest`;
        if (isLikelyStateForestName(withSuffix)) {
          names.add(withSuffix);
        }
      }
    });
  };

  for (const anchor of anchors.toArray()) {
    const anchorText = normalizeText($(anchor).text());
    if (excludedRegex.test(anchorText)) {
      continue;
    }

    const directList = $(anchor).nextAll("ul,ol").first();
    if (directList.length) {
      pushNamesFromList(directList);
      continue;
    }

    const nestedList = $(anchor).nextAll("div").first().find("ul,ol").first();
    if (nestedList.length) {
      pushNamesFromList(nestedList);
    }
  }

  if (!names.size) {
    $("div[id^='content_container_'] li").each((_, li) => {
      const name = normalizeText($(li).text());
      if (!name || name.length > 100) {
        return;
      }

      if (
        /cookies|privacy|facebook|youtube|copyright|download|quicklinks|search/i.test(
          name
        )
      ) {
        return;
      }

      if (!/state forest/i.test(name)) {
        return;
      }

      const normalizedName = normalizeForestLabel(name.replace(/[.,;]$/, ""));
      if (!isLikelyStateForestName(normalizedName)) {
        return;
      }

      names.add(normalizedName);
    });
  }

  return [...names];
};

export const isCloudflareChallengeHtml = (html: string): boolean =>
  /Just a moment|Performing security verification|Verifying you are human|Enable JavaScript and cookies to continue/i.test(
    html
  );
