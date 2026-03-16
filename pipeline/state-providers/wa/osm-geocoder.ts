/**
 * WA Campground OSM Geocoder
 *
 * Uses the Overpass API to find WA campground coordinates by name.
 * Queries OSM for all "tourism=camp_site" nodes/ways in the WA bounding box,
 * then attempts exact and fuzzy name matching against the RATIS campground list.
 *
 * WA bounding box: lat -38 to -13.5, lng 112 to 129
 *
 * For campgrounds not matched in OSM, falls back to the DBCA Legislated Lands
 * ArcGIS layer to compute a centroid from the park polygon.
 *
 * Note: Overpass API has rate limits. Requests should be batched to avoid
 * 429 errors. A single bounding-box query is used to minimise request count.
 */

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// WA bounding box (south, west, north, east)
const WA_BBOX_SW = { s: -38, w: 112, n: -20, e: 129 };

// DBCA Legislated Lands ArcGIS service (DBCA-011)
const DBCA_ARCGIS_URL =
  "https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Property_and_Planning/MapServer/15/query";

export interface OsmCampground {
  name: string;
  latitude: number;
  longitude: number;
  osmId: number;
}

interface OverpassElement {
  id: number;
  type: "node" | "way" | "relation";
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// OSM Overpass fetch
// ---------------------------------------------------------------------------

const buildOverpassQuery = (
  s: number,
  w: number,
  n: number,
  e: number
): string => {
  return (
    `[out:json][timeout:35];` +
    `(node["tourism"="camp_site"](${s},${w},${n},${e});` +
    `way["tourism"="camp_site"](${s},${w},${n},${e}););` +
    `out center;`
  );
};

export const fetchOsmCampgrounds = async (
  fetchImpl: typeof fetch
): Promise<{ campgrounds: OsmCampground[]; warnings: string[] }> => {
  const warnings: string[] = [];
  const campgrounds: OsmCampground[] = [];

  const { s, w, n, e } = WA_BBOX_SW;

  try {
    const query = buildOverpassQuery(s, w, n, e);
    const resp = await fetchImpl(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "campfire-allowed-near-me/1.0",
      },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!resp.ok) {
      if (resp.status === 429) {
        warnings.push(
          "Overpass API rate limited (429). WA campground coordinates will use DBCA fallback only."
        );
        return { campgrounds: [], warnings };
      }
      throw new Error(`HTTP ${resp.status}`);
    }

    const data = (await resp.json()) as { elements: OverpassElement[] };
    for (const el of data.elements ?? []) {
      const name = el.tags?.name?.trim();
      if (!name) continue;
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (lat === undefined || lng === undefined) continue;
      campgrounds.push({ name, latitude: lat, longitude: lng, osmId: el.id });
    }
  } catch (err) {
    warnings.push(
      `Could not fetch WA campgrounds from OSM Overpass: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  return { campgrounds, warnings };
};

// ---------------------------------------------------------------------------
// Name normalisation and matching
// ---------------------------------------------------------------------------

const normalizeName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const SUFFIXES_TO_STRIP = [
  "camp site",
  "campsite",
  "campground",
  "camping area",
  "camping ground",
  "camp",
];

const stripSuffix = (name: string): string => {
  for (const suffix of SUFFIXES_TO_STRIP) {
    if (name.endsWith(` ${suffix}`)) {
      return name.slice(0, -(suffix.length + 1)).trim();
    }
  }
  return name;
};

export const matchCampgroundToOsm = (
  ratisName: string,
  osmIndex: Map<string, OsmCampground>
): OsmCampground | null => {
  const norm = normalizeName(ratisName);

  // 1. Exact match
  const exact = osmIndex.get(norm);
  if (exact) return exact;

  // 2. RATIS name with suffix stripped
  const stripped = stripSuffix(norm);
  if (stripped !== norm) {
    const strippedMatch = osmIndex.get(stripped);
    if (strippedMatch) return strippedMatch;
  }

  // 3. Containment: OSM name contains RATIS name or vice versa
  for (const [osmNorm, osm] of osmIndex) {
    if (osmNorm.includes(norm) || norm.includes(osmNorm)) return osm;
    // Also try stripped version
    const osmStripped = stripSuffix(osmNorm);
    if (osmStripped.includes(stripped) || stripped.includes(osmStripped))
      return osm;
  }

  return null;
};

export const buildOsmIndex = (
  campgrounds: OsmCampground[]
): Map<string, OsmCampground> => {
  const index = new Map<string, OsmCampground>();
  for (const cg of campgrounds) {
    index.set(normalizeName(cg.name), cg);
  }
  return index;
};

// ---------------------------------------------------------------------------
// DBCA ArcGIS fallback: get park polygon centroid
// ---------------------------------------------------------------------------

interface ArcGisPolygon {
  rings: [number, number][][];
}

interface ArcGisFeature {
  attributes: { leg_name: string; leg_purpose: string };
  geometry?: ArcGisPolygon;
}

const computePolygonCentroid = (
  rings: [number, number][][]
): { lat: number; lng: number } | null => {
  // Find the longest ring and compute its centroid
  let best: [number, number][] = [];
  for (const ring of rings) {
    if (ring.length > best.length) best = ring;
  }
  if (!best.length) return null;
  const sumLng = best.reduce((s, p) => s + p[0], 0);
  const sumLat = best.reduce((s, p) => s + p[1], 0);
  return { lat: sumLat / best.length, lng: sumLng / best.length };
};

export const fetchDbcaParkCentroid = async (
  parkName: string,
  fetchImpl: typeof fetch
): Promise<{ lat: number; lng: number } | null> => {
  // Clean park name for ARCGIS query (strip reserve type suffixes)
  const clean = parkName.replace(/['"]/g, "").trim();
  try {
    const params = new URLSearchParams({
      where: `leg_name LIKE '%${clean}%'`,
      outFields: "leg_name,leg_purpose",
      returnGeometry: "true",
      resultRecordCount: "5",
      f: "json",
    });
    const resp = await fetchImpl(`${DBCA_ARCGIS_URL}?${params}`, {
      headers: { "User-Agent": "campfire-allowed-near-me/1.0" },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { features?: ArcGisFeature[] };
    const feature = data.features?.[0];
    if (!feature?.geometry) return null;
    return computePolygonCentroid(feature.geometry.rings);
  } catch {
    return null;
  }
};
