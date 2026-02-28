/**
 * Parsers for FCNSW closure notice pages.
 *
 * Extracts ForestClosureNotice records from:
 * - the index/listing page  (parseClosureNoticesPage)
 * - individual detail pages (parseClosureNoticeDetailPage,
 *   parseFullClosureNoticeFromDetailPage)
 */
import { load } from "cheerio";
import { normalizeForestLabel, slugify } from "../../shared/text-utils.js";
import type {
  ClosureNoticeStatus,
  ClosureTagKey,
  ForestClosureNotice
} from "../../shared/contracts.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

const CLOSURE_FOREST_NAME_REGEX = /^(.*?\bstate forests?\b)/i;

const CLOSURE_TAG_RULES: Array<{ key: ClosureTagKey; pattern: RegExp }> = [
  {
    key: "ROAD_ACCESS",
    pattern:
      /\b(road|roads|track|tracks|trail|trails|fire\s+trail|bridge|vehicle|4wd|driv|access)\b/i
  },
  {
    key: "CAMPING",
    pattern: /\b(camp|campground|camping|picnic|rest\s+area|caravan)\b/i
  },
  {
    key: "EVENT",
    pattern: /\b(event|festival|community)\b/i
  },
  {
    key: "OPERATIONS",
    pattern:
      /\b(pest|harvest|logging|truck|quarry|fossick|maintenance|works|restoration|weather|flood|landslip|bushfire)\b/i
  }
];

const parseClosureDateValue = (rawValue: string | null): string | null => {
  const value = normalizeText(rawValue ?? "");
  if (!value || /further notice/i.test(value)) {
    return null;
  }

  const parsedMs = Date.parse(value);
  if (Number.isNaN(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString();
};

const extractBlockText = (
  $: ReturnType<typeof load>,
  container: ReturnType<ReturnType<typeof load>>
): string | null => {
  container.find("br").replaceWith("\n");
  container.find("p, div, li, h1, h2, h3, h4, h5, h6").each((_, element) => {
    $(element).prepend("\n");
    $(element).append("\n");
  });

  const rawText = container.text();
  const result = rawText
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");

  return result || null;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const parseClosureNoticeForestNameHint = (rawTitle: string): string | null => {
  const title = normalizeText(rawTitle);
  if (!title) {
    return null;
  }

  const match = CLOSURE_FOREST_NAME_REGEX.exec(title);
  if (!match?.[1]) {
    return null;
  }

  const normalized = normalizeForestLabel(match[1]).replace(/state forests$/i, "State Forest");
  return normalized || null;
};

export const parseClosureNoticeStatus = (rawTitle: string): ClosureNoticeStatus => {
  const title = normalizeText(rawTitle).toLowerCase();
  if (!title) {
    return "NOTICE";
  }

  if (
    /\bpartial|partly|partially|sections?\s+of|exclusive\s+use\s+on\s+part|limited\s+camping\b/.test(
      title
    )
  ) {
    return "PARTIAL";
  }

  // Definitive full-forest closure: "X State Forest: Closed" or "X State Forest closed"
  if (/\bstate\s+forests?\s*:?\s*closed\b/.test(title)) {
    return "CLOSED";
  }

  // Contains "closed" or "closure" but doesn't match the definitive pattern.
  // Likely a feature/area closure (walk, road, campground, etc.).
  // Mark as PARTIAL so the LLM enricher can clarify.
  if (/\bclosed|closure\b/.test(title)) {
    return "PARTIAL";
  }

  return "NOTICE";
};

export const classifyClosureNoticeTags = (rawText: string): ClosureTagKey[] => {
  const text = normalizeText(rawText);
  if (!text) {
    return [];
  }

  const tags = CLOSURE_TAG_RULES
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => rule.key);

  return [...new Set(tags)];
};

/**
 * Parse closure notices from the FCNSW index/listing page HTML.
 * Returns one ForestClosureNotice per listed item (without detailText).
 */
export const parseClosureNoticesPage = (
  html: string,
  baseUrl: string
): ForestClosureNotice[] => {
  const $ = load(html);
  const noticesById = new Map<string, ForestClosureNotice>();

  $("#closuresList li[id^='closureItem'] a[href]").each((_, node) => {
    const anchor = $(node);
    const title = normalizeText(anchor.find("h3").first().text() || anchor.attr("title") || "");
    if (!title) {
      return;
    }

    const href = anchor.attr("href");
    if (!href) {
      return;
    }

    let detailUrl = "";
    try {
      detailUrl = new URL(href, baseUrl).toString();
    } catch {
      return;
    }

    const times = anchor
      .find("time")
      .toArray()
      .map((time) => normalizeText($(time).text()));
    const listedAtText = times[0] ?? null;
    const untilText = times[1] ?? null;

    const idFromQuery = (() => {
      try {
        return new URL(detailUrl).searchParams.get("id");
      } catch {
        return null;
      }
    })();
    const noticeId = idFromQuery || slugify(title) || slugify(detailUrl) || "closure-notice";

    noticesById.set(noticeId, {
      id: noticeId,
      title,
      detailUrl,
      listedAt: parseClosureDateValue(listedAtText),
      listedAtText,
      untilAt: parseClosureDateValue(untilText),
      untilText,
      forestNameHint: parseClosureNoticeForestNameHint(title),
      status: parseClosureNoticeStatus(title),
      tags: classifyClosureNoticeTags(title)
    });
  });

  return [...noticesById.values()];
};

/**
 * Extract the "More Information" prose from a closure detail page.
 * Returns null if no meaningful text block is found.
 */
export const parseClosureNoticeDetailPage = (html: string): string | null => {
  const $ = load(html);

  const container = $("main .text-container-wd").first();
  if (container.length > 0) {
    const detailText = extractBlockText($, container);
    if (detailText) {
      return detailText;
    }
  }

  const headingNode = $("main h3")
    .filter((_, node) => /more information/i.test(normalizeText($(node).text())))
    .first();
  const fallbackParagraph = headingNode.next("p");
  if (fallbackParagraph.length > 0) {
    const fallbackDetailText = extractBlockText($, fallbackParagraph);
    if (fallbackDetailText) {
      return fallbackDetailText;
    }
  }

  return null;
};
