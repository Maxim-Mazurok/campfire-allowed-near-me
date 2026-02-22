import { load } from "cheerio";
import { DEFAULT_FACILITY_DEFINITIONS } from "../constants/facilities.js";
import { isLikelyStateForestName, normalizeForestLabel } from "../utils/forest-name-validation.js";
import { slugify } from "../utils/slugs.js";
import type {
  BanStatus,
  FacilityDefinition,
  ForestAreaSummary
} from "../types/domain.js";

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

const inferFacilityIconKey = (label: string, paramName: string): string => {
  const text = `${label} ${paramName}`.toLowerCase();

  if (/camp/.test(text)) {
    return "camping";
  }

  if (/walk/.test(text)) {
    return "walking";
  }

  if (/4wd|four.?wheel/.test(text)) {
    return "four-wheel-drive";
  }

  if (/bike|cycling|mountain/.test(text)) {
    return "cycling";
  }

  if (/horse|riding/.test(text)) {
    return "horse-riding";
  }

  if (/canoe|kayak|paddle/.test(text)) {
    return "canoeing";
  }

  if (/water|swim|river|lake/.test(text)) {
    return "waterways";
  }

  if (/fish/.test(text)) {
    return "fishing";
  }

  if (/caravan|camper|motorhome/.test(text)) {
    return "caravan";
  }

  if (/picnic/.test(text)) {
    return "picnic";
  }

  if (/lookout|view|scenic/.test(text)) {
    return "lookout";
  }

  if (/adventure/.test(text)) {
    return "adventure";
  }

  if (/hunting|hunt/.test(text)) {
    return "hunting";
  }

  if (/cabin|hut/.test(text)) {
    return "cabin";
  }

  if (/fireplace|fire pit|fire\b/.test(text)) {
    return "fireplace";
  }

  if (/2wd|two.?wheel/.test(text)) {
    return "two-wheel-drive";
  }

  if (/toilet|restroom|bathroom|amenities/.test(text)) {
    return "toilets";
  }

  if (/wheelchair|accessible|accessibilit/.test(text)) {
    return "wheelchair";
  }

  return "facility";
};

const parseFilterKey = (name: string, label: string): string => {
  const slug = slugify(name || label).replace(/-/g, "_");
  return slug || "facility_unknown";
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

export const parseForestDirectoryFilters = (html: string): FacilityDefinition[] => {
  const $ = load(html);
  const rows = new Map<string, FacilityDefinition>();

  const facilityForms = $("form").filter((_, form) =>
    /\bfacilit(y|ies)\b/i.test(normalizeText($(form).text()))
  );

  const inputSelector =
    "input[type='checkbox'][name], input[type='radio'][name], input[type='hidden'][name]";

  const inputSource = facilityForms.length ? facilityForms : $("body");

  inputSource.find(inputSelector).each((_, node) => {
    const input = $(node);
    const name = normalizeText(input.attr("name") ?? "");
    if (!name) {
      return;
    }

    const value = normalizeText(input.attr("value") ?? "");
    const loweredValue = value.toLowerCase();

    if (loweredValue && loweredValue !== "yes" && loweredValue !== "on" && loweredValue !== "true") {
      return;
    }

    const id = input.attr("id");
    const labelFromFor = id
      ? normalizeText($(`label[for='${id}']`).first().text())
      : "";
    const labelFromParent = normalizeText(input.closest("label").text());
    const parentText = normalizeText(input.parent().text());
    const label = [labelFromFor, labelFromParent, parentText]
      .map((entry) => entry.replace(/\s*:\s*(yes|no)?\s*$/i, "").trim())
      .find((entry) => Boolean(entry) && !/\bapply\b|\bsearch\b/i.test(entry));

    if (!label) {
      return;
    }

    if (label.length > 80 || /\bstate forests?\b|\bshowing\s+\d+\s+results\b/i.test(label)) {
      return;
    }

    const key = parseFilterKey(name, label);
    if (rows.has(key)) {
      return;
    }

    rows.set(key, {
      key,
      label,
      paramName: name,
      iconKey: inferFacilityIconKey(label, name)
    });
  });

  if (rows.size) {
    return [...rows.values()];
  }

  const bodyText = normalizeText($("body").text()).toLowerCase();
  for (const candidate of DEFAULT_FACILITY_DEFINITIONS) {
    if (!bodyText.includes(candidate.label.toLowerCase())) {
      continue;
    }

    const key = parseFilterKey(candidate.paramName, candidate.label);
    rows.set(key, {
      key,
      label: candidate.label,
      paramName: candidate.paramName,
      iconKey: candidate.iconKey || inferFacilityIconKey(candidate.label, candidate.paramName)
    });
  }

  return [...rows.values()];
};

const cleanDirectoryForestName = (value: string): string =>
  normalizeText(value.replace(/\s*\|\s*show on map/i, "").replace(/[|,;]$/, ""));

const FORESTRY_BASE_URL = "https://www.forestrycorporation.com.au";

const normalizeForestDetailPath = (path: string): string =>
  path
    .replace(/\/+$/, "")
    .replace(/^\/visiting\//i, "/visit/");

const resolveForestDetailUrl = (href: string): string | null => {
  const value = normalizeText(href);
  if (!value || value.startsWith("#") || /^javascript:/i.test(value)) {
    return null;
  }

  try {
    const path = normalizeForestDetailPath(
      new URL(value, `${FORESTRY_BASE_URL}/visiting/`).pathname
    );
    if (!isForestDetailPath(path)) {
      return null;
    }

    return new URL(path, FORESTRY_BASE_URL).toString();
  } catch {
    return null;
  }
};

const isForestDetailPath = (path: string): boolean =>
  /^\/(?:visit(?:ing)?\/)?forests\/[^/?#]+\/?$/i.test(path);

export interface ForestDirectoryEntry {
  forestName: string;
  forestUrl: string;
}

export const parseForestDirectoryForests = (html: string): ForestDirectoryEntry[] => {
  const $ = load(html);
  const forestsByName = new Map<string, string>();

  const addForest = (label: string, href: string): void => {
    const forestUrl = resolveForestDetailUrl(href);
    if (!forestUrl) {
      return;
    }

    const name = cleanDirectoryForestName(label);
    if (!name || name.length > 120) {
      return;
    }

    if (!/state\s+forest/i.test(name)) {
      return;
    }

    if (!isLikelyStateForestName(name)) {
      return;
    }

    const normalizedName = normalizeForestLabel(name);
    if (!forestsByName.has(normalizedName)) {
      forestsByName.set(normalizedName, forestUrl);
    }
  };

  $("a[href]").each((_, node) => {
    addForest($(node).text(), $(node).attr("href") ?? "");
  });

  if (!forestsByName.size) {
    $("script").each((_, node) => {
      const scriptBody = $(node).html() ?? "";
      const markerForestLinkRegex =
        /<a href=['"]([^'"]*\/(?:visit(?:ing)?\/)?forests\/[^'"]+)['"][^>]*>([^<]+)<\/a>/gi;

      let match = markerForestLinkRegex.exec(scriptBody);
      while (match) {
        addForest(match[2] ?? "", match[1] ?? "");
        match = markerForestLinkRegex.exec(scriptBody);
      }
    });
  }

  return [...forestsByName.entries()].map(([forestName, forestUrl]) => ({
    forestName,
    forestUrl
  }));
};

export const parseForestDirectoryForestNames = (html: string): string[] => {
  return parseForestDirectoryForests(html).map((entry) => entry.forestName);
};

export const isCloudflareChallengeHtml = (html: string): boolean =>
  /Just a moment|Performing security verification|Enable JavaScript and cookies to continue/i.test(
    html
  );
