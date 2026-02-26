import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RawPageCache } from "../../apps/api/src/utils/raw-page-cache.js";

describe("RawPageCache", () => {
  it("returns fresh cached pages", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "campfire-raw-page-cache-"));
    const cachePath = join(tmpDir, "raw-pages.json");

    try {
      const cache = new RawPageCache({
        filePath: cachePath,
        ttlMs: 60 * 60 * 1000
      });

      await cache.set("https://example.com/a", {
        finalUrl: "https://example.com/a",
        html: "<html><body>A</body></html>"
      });

      await expect(cache.get("https://example.com/a")).resolves.toEqual({
        finalUrl: "https://example.com/a",
        html: "<html><body>A</body></html>"
      });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("evicts stale entries from the persisted archive", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "campfire-raw-page-cache-"));
    const cachePath = join(tmpDir, "raw-pages.json");

    try {
      const oldTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      writeFileSync(
        cachePath,
        JSON.stringify(
          {
            schemaVersion: 1,
            pages: {
              "https://example.com/stale": {
                fetchedAt: oldTime,
                finalUrl: "https://example.com/stale",
                html: "<html><body>stale</body></html>"
              }
            }
          },
          null,
          2
        ),
        "utf8"
      );

      const cache = new RawPageCache({
        filePath: cachePath,
        ttlMs: 30 * 1000
      });

      await expect(cache.get("https://example.com/stale")).resolves.toBeNull();

      const persistedRaw = await readFile(cachePath, "utf8");
      const persisted = JSON.parse(persistedRaw) as {
        pages: Record<string, unknown>;
      };
      expect(persisted.pages).toEqual({});
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("ignores invalid cache files and still stores new pages", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "campfire-raw-page-cache-"));
    const cachePath = join(tmpDir, "raw-pages.json");

    try {
      writeFileSync(cachePath, "{invalid", "utf8");

      const cache = new RawPageCache({
        filePath: cachePath,
        ttlMs: 60 * 60 * 1000
      });

      await cache.set("https://example.com/ok", {
        finalUrl: "https://example.com/ok",
        html: "<html><body>ok</body></html>"
      });

      await expect(cache.get("https://example.com/ok")).resolves.toEqual({
        finalUrl: "https://example.com/ok",
        html: "<html><body>ok</body></html>"
      });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("exports all pages including ones added during this session", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "campfire-raw-page-cache-"));
    const cachePath = join(tmpDir, "raw-pages.json");

    try {
      const cache = new RawPageCache({
        filePath: cachePath,
        ttlMs: 0 // TTL=0 — as used by pipeline scrape scripts
      });

      await cache.set("https://example.com/a", {
        finalUrl: "https://example.com/a-final",
        html: "<html>A</html>"
      });

      await cache.set("https://example.com/b", {
        finalUrl: "https://example.com/b",
        html: "<html>B</html>"
      });

      const allPages = await cache.exportAllPages();

      expect(Object.keys(allPages)).toHaveLength(2);
      expect(allPages["https://example.com/a"]).toMatchObject({
        finalUrl: "https://example.com/a-final",
        html: "<html>A</html>"
      });
      expect(allPages["https://example.com/b"]).toMatchObject({
        finalUrl: "https://example.com/b",
        html: "<html>B</html>"
      });
      expect(allPages["https://example.com/a"]!.fetchedAt).toBeDefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
