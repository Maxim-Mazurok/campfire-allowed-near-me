import { load } from "cheerio";
import type { BanStatus, ForestAreaSummary } from "../types/domain.js";

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

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

export const parseAreaForestNames = (html: string): string[] => {
  const $ = load(html);

  const includeRegex =
    /this area includes.*state forests|state forests around|following state forests/i;

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

      names.add(name.replace(/[;,]$/, ""));
    });
  };

  for (const anchor of anchors.toArray()) {
    const list = $(anchor).nextAll("ul,ol").first();
    if (!list.length) {
      continue;
    }

    pushNamesFromList(list);
    if (names.size) {
      break;
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

      names.add(name.replace(/[;,]$/, ""));
    });
  }

  return [...names];
};

export const isCloudflareChallengeHtml = (html: string): boolean =>
  /Just a moment|Performing security verification|Enable JavaScript and cookies to continue/i.test(
    html
  );
