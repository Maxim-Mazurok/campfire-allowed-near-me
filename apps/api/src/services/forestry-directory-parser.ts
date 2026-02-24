import { load } from "cheerio";
import { DEFAULT_FACILITY_DEFINITIONS } from "../constants/facilities.js";
import { isLikelyStateForestName, normalizeForestLabel } from "../utils/forest-name-validation.js";
import { slugify } from "../utils/slugs.js";
import type {
  FacilityDefinition,
  FacilityForestEntry,
  ForestDirectorySnapshot
} from "../types/domain.js";

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

export const inferFacilityIconKey = (label: string, paramName: string): string => {
  const text = `${label} ${paramName}`.toLowerCase();

  if (/camp/.test(text)) return "camping";
  if (/walk/.test(text)) return "walking";
  if (/4wd|four.?wheel/.test(text)) return "four-wheel-drive";
  if (/bike|cycling|mountain/.test(text)) return "cycling";
  if (/horse|riding/.test(text)) return "horse-riding";
  if (/canoe|kayak|paddle/.test(text)) return "canoeing";
  if (/water|swim|river|lake/.test(text)) return "waterways";
  if (/fish/.test(text)) return "fishing";
  if (/caravan|camper|motorhome/.test(text)) return "caravan";
  if (/picnic/.test(text)) return "picnic";
  if (/lookout|view|scenic/.test(text)) return "lookout";
  if (/adventure/.test(text)) return "adventure";
  if (/hunting|hunt/.test(text)) return "hunting";
  if (/cabin|hut/.test(text)) return "cabin";
  if (/fireplace|fire pit|fire\b/.test(text)) return "fireplace";
  if (/2wd|two.?wheel/.test(text)) return "two-wheel-drive";
  if (/toilet|restroom|bathroom|amenities/.test(text)) return "toilets";
  if (/wheelchair|accessible|accessibilit/.test(text)) return "wheelchair";

  return "facility";
};

export const parseFilterKey = (name: string, label: string): string => {
  const slug = slugify(name || label).replace(/-/g, "_");
  return slug || "facility_unknown";
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
    if (!name) return;

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

    if (!label) return;

    if (label.length > 80 || /\bstate forests?\b|\bshowing\s+\d+\s+results\b/i.test(label)) {
      return;
    }

    const key = parseFilterKey(name, label);
    if (rows.has(key)) return;

    rows.set(key, {
      key,
      label,
      paramName: name,
      iconKey: inferFacilityIconKey(label, name)
    });
  });

  if (rows.size) return [...rows.values()];

  const bodyText = normalizeText($("body").text()).toLowerCase();
  for (const candidate of DEFAULT_FACILITY_DEFINITIONS) {
    if (!bodyText.includes(candidate.label.toLowerCase())) continue;

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

export const parseForestDirectoryForests = (html: string): ForestDirectoryEntry[] => {
  const $ = load(html);
  const forestsByName = new Map<string, string>();

  const addForest = (label: string, href: string): void => {
    const forestUrl = resolveForestDetailUrl(href);
    if (!forestUrl) return;

    const name = cleanDirectoryForestName(label);
    if (!name || name.length > 120) return;
    if (!/state\s+forest/i.test(name)) return;
    if (!isLikelyStateForestName(name)) return;

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

/**
 * Parse the forest directory page once and extract both forests and their
 * facilities from tooltip icons. Each forest listing contains `<i>` tags with
 * `data-original-title` describing the facility and either `g-color-primary`
 * (available) or `g-color-grey` (not available) class.
 */
export const parseForestDirectoryWithFacilities = (
  html: string
): ForestDirectorySnapshot => {
  const $ = load(html);

  // Discover all facility tooltip titles in the page to build filter definitions.
  const facilityTitleSet = new Map<string, { label: string; key: string; iconKey: string }>();
  $("i[data-original-title]").each((_, node) => {
    const title = normalizeText($(node).attr("data-original-title") ?? "");
    if (!title) return;
    const key = parseFilterKey(slugify(title), title);
    if (!facilityTitleSet.has(title)) {
      facilityTitleSet.set(title, {
        label: title,
        key,
        iconKey: inferFacilityIconKey(title, key)
      });
    }
  });

  const facilityTitles = [...facilityTitleSet.keys()];
  const filters: FacilityDefinition[] = [...facilityTitleSet.values()].map((entry) => ({
    key: entry.key,
    label: entry.label,
    paramName: entry.key,
    iconKey: entry.iconKey
  }));

  const forests: FacilityForestEntry[] = [];
  const seenForestNames = new Set<string>();

  // Find every anchor that links to a forest detail page and walk up to the
  // nearest common container to collect the associated facility icons.
  $("a[href]").each((_, anchor) => {
    const href = $(anchor).attr("href") ?? "";
    const forestUrl = resolveForestDetailUrl(href);
    if (!forestUrl) return;

    const rawLabel = cleanDirectoryForestName($(anchor).text());
    if (!rawLabel || rawLabel.length > 120) return;
    if (!/state\s+forest/i.test(rawLabel)) return;
    if (!isLikelyStateForestName(rawLabel)) return;

    const forestName = normalizeForestLabel(rawLabel);
    if (seenForestNames.has(forestName)) return;
    seenForestNames.add(forestName);

    // Walk up to a container that holds both the link and facility icons.
    const container =
      $(anchor).closest("div.mb-4").length ? $(anchor).closest("div.mb-4") :
      $(anchor).closest("div[class*='result'], div[class*='forest'], li, tr").length
        ? $(anchor).closest("div[class*='result'], div[class*='forest'], li, tr")
        : $(anchor).parent().parent();

    const facilities: Record<string, boolean> = {};
    for (const title of facilityTitles) {
      facilities[facilityTitleSet.get(title)!.key] = false;
    }

    container.find("i[data-original-title]").each((_, icon) => {
      const title = normalizeText($(icon).attr("data-original-title") ?? "");
      const meta = facilityTitleSet.get(title);
      if (!meta) return;

      const classes = $(icon).attr("class") ?? "";
      facilities[meta.key] = /g-color-primary/.test(classes);
    });

    forests.push({ forestName, forestUrl, facilities });
  });

  // Fallback: if no icon-based facilities were found, fall back to the
  // filter-based approach (returns forests without facility data).
  if (!facilityTitles.length) {
    const filterFallback = parseForestDirectoryFilters(html);
    const forestEntries = parseForestDirectoryForests(html);
    const defaultFacilities: Record<string, boolean> = Object.fromEntries(
      filterFallback.map((filter) => [filter.key, false])
    );
    return {
      filters: filterFallback,
      forests: forestEntries.map((entry) => ({
        forestName: entry.forestName,
        forestUrl: entry.forestUrl,
        facilities: { ...defaultFacilities }
      })),
      warnings: filterFallback.length > 0
        ? ["Facility tooltip icons were not found on the directory page; facility data may be incomplete."]
        : []
    };
  }

  forests.sort((left, right) => left.forestName.localeCompare(right.forestName));

  return { filters, forests, warnings: [] };
};
