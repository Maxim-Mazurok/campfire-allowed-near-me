import { describe, expect, it } from "vitest";
import {
  GEO_JSON_URL,
  RATINGS_URL,
  scrapeTotalFireBanPages
} from "../../pipeline/services/total-fire-ban-scraper.js";

type ProxyableInit = RequestInit & { dispatcher?: unknown };

describe("scrapeTotalFireBanPages", () => {
  it("captures both RFS feeds without a proxy dispatcher by default", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });

      return new Response(`{"url":"${url}"}`, {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    };

    const pages = await scrapeTotalFireBanPages({ fetchImpl });

    expect(Object.keys(pages)).toEqual([RATINGS_URL, GEO_JSON_URL]);
    expect(pages[RATINGS_URL]?.html).toContain(RATINGS_URL);
    expect(pages[GEO_JSON_URL]?.html).toContain(GEO_JSON_URL);
    expect(requests).toHaveLength(2);
    expect((requests[0]?.init as ProxyableInit | undefined)?.dispatcher).toBeUndefined();
    expect((requests[1]?.init as ProxyableInit | undefined)?.dispatcher).toBeUndefined();
  });

  it("attaches an undici proxy dispatcher when a proxy URL is provided", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });

      return new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    };

    await scrapeTotalFireBanPages({
      fetchImpl,
      proxyUrl: "http://user:pass@127.0.0.1:8888"
    });

    expect(requests).toHaveLength(2);
    expect((requests[0]?.init as ProxyableInit | undefined)?.dispatcher).toBeDefined();
    expect((requests[1]?.init as ProxyableInit | undefined)?.dispatcher).toBeDefined();
  });

  it("throws when an RFS endpoint returns a non-success status", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('{"message":"forbidden"}', {
        status: 403,
        headers: {
          "content-type": "application/json"
        }
      });

    await expect(scrapeTotalFireBanPages({ fetchImpl })).rejects.toThrow(
      `HTTP 403 for ${RATINGS_URL}`
    );
  });
});
