import { load } from "cheerio";
import { isLikelyStateForestName, normalizeForestLabel } from "../utils/forest-name-validation.js";
import { slugify } from "../utils/slugs.js";
import type {
  BanStatus,
  ClosureNoticeStatus,
  ClosureTagKey,
  ForestClosureNotice,
  ForestAreaSummary
} from "../types/domain.js";

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

  if (/\bclosed|closure\b/.test(title)) {
    return "CLOSED";
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

export const parseBanStatus = (rawStatusText: string): BanStatus => {
  const text = normalizeText(rawStatusText).toLowerCase();

  if (!text) {
    return "UNKNOWN";
  }

  if (
    /no\s+solid\s+fuel\s+fire\s+ban/.test(text) ||
    /(?:^|\s)no\s+ban(?:\s|$)/.test(text)
  ) {
    return "NOT_BANNED";
  }

  if (
    /solid\s+fuel\s+fire\s+ban/.test(text) ||
    /solid\s+fuel\s+fires?\s+banned/.test(text) ||
    /\bfires?\s+banned\b/.test(text) ||
    /\btotal\s+fire\s+ban\b/.test(text)
  ) {
    return "BANNED";
  }

  return "UNKNOWN";
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
      .map((cell) => normalizeText($(cell).text()))
      .filter(Boolean);

    // Forestry table is: area | solid fuel fire ban | firewood collection.
    // We intentionally read only the second column and ignore firewood.
    const statusText = cells[1] ?? "Unknown";

    rows.push({
      areaName,
      areaUrl,
      status: parseBanStatus(statusText),
      statusText
    });
  });

  const deduped = new Map<string, ForestAreaSummary>();
  for (const row of rows) {
    deduped.set(row.areaUrl, row);
  }

  return [...deduped.values()];
};

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

export const parseClosureNoticeDetailPage = (html: string): string | null => {
  const $ = load(html);

  const detailText = normalizeText($("main .text-container-wd").first().text());
  if (detailText) {
    return detailText;
  }

  const fallbackDetailText = normalizeText(
    $("main h3")
      .filter((_, node) => /more information/i.test(normalizeText($(node).text())))
      .first()
      .next("p")
      .text()
  );

  return fallbackDetailText || null;
};

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

      const normalizedName = normalizeForestLabel(name.replace(/[;,]$/, ""));
      if (!isLikelyStateForestName(normalizedName)) {
        return;
      }

      names.add(normalizedName);
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

      const normalizedName = normalizeForestLabel(name.replace(/[;,]$/, ""));
      if (!isLikelyStateForestName(normalizedName)) {
        return;
      }

      names.add(normalizedName);
    });
  }

  return [...names];
};

export const isCloudflareChallengeHtml = (html: string): boolean =>
  /Just a moment|Performing security verification|Enable JavaScript and cookies to continue/i.test(
    html
  );
