import { ProxyAgent } from "undici";
import type { RawPagesArchiveEntry } from "../../shared/pipeline-types.js";

/** Well-known RFS API URLs (same as TotalFireBanService defaults). */
export const RATINGS_URL =
  "https://www.rfs.nsw.gov.au/_designs/xml/fire-danger-ratings/fire-danger-ratings-v2";
export const GEO_JSON_URL =
  "https://www.rfs.nsw.gov.au/_designs/geojson/fire-danger-ratings-geojson";

const TOTAL_FIRE_BAN_URLS = [RATINGS_URL, GEO_JSON_URL] as const;
const DEFAULT_TIMEOUT_MS = 20_000;

interface ScrapeTotalFireBanPagesOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  proxyUrl?: string | null;
  log?: (message: string) => void;
}

type ProxyableRequestInit = RequestInit & {
  dispatcher?: ProxyAgent;
};

const fetchAndCapture = async (
  url: string,
  pages: Record<string, RawPagesArchiveEntry>,
  options: Required<Pick<ScrapeTotalFireBanPagesOptions, "fetchImpl" | "timeoutMs" | "proxyUrl" | "log">>
): Promise<void> => {
  const { fetchImpl, timeoutMs, proxyUrl, log } = options;
  log(`Fetching ${url} ...`);

  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : null;
  try {
    const requestOptions: ProxyableRequestInit = {
      headers: {
        "User-Agent":
          "campfire-allowed-near-me/1.0 (contact: local-dev; purpose: total fire ban lookup)",
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(timeoutMs)
    };
    if (dispatcher) {
      requestOptions.dispatcher = dispatcher;
    }

    const response = await fetchImpl(url, requestOptions);
    const body = await response.text();
    log(`HTTP ${response.status} (${body.length} bytes)`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    pages[url] = {
      fetchedAt: new Date().toISOString(),
      finalUrl: response.url || url,
      html: body
    };
  } finally {
    await dispatcher?.close();
  }
};

export const scrapeTotalFireBanPages = async (
  options: ScrapeTotalFireBanPagesOptions = {}
): Promise<Record<string, RawPagesArchiveEntry>> => {
  const normalizedOptions = {
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    proxyUrl: options.proxyUrl ?? null,
    log: options.log ?? (() => {})
  };

  const pages: Record<string, RawPagesArchiveEntry> = {};
  for (const url of TOTAL_FIRE_BAN_URLS) {
    await fetchAndCapture(url, pages, normalizedOptions);
  }

  return pages;
};
