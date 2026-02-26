import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRawPagesArchive, writeRawPagesArchive } from "../../scripts/pipeline/pipeline-io.js";
import type { RawPagesArchive } from "../../packages/shared/src/pipeline-types.js";

describe("pipeline-io raw pages archive", () => {
  it("writes and reads a raw pages archive round-trip", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "campfire-pipeline-io-"));
    const archivePath = join(tmpDir, "test-archive.json");

    try {
      const archive: RawPagesArchive = {
        schemaVersion: 1,
        pages: {
          "https://example.com/page1": {
            fetchedAt: "2024-01-01T00:00:00.000Z",
            finalUrl: "https://example.com/page1",
            html: "<html><body>Page 1</body></html>"
          },
          "https://example.com/page2": {
            fetchedAt: "2024-01-01T00:01:00.000Z",
            finalUrl: "https://example.com/page2-redirected",
            html: "<html><body>Page 2</body></html>"
          }
        }
      };

      writeRawPagesArchive(archivePath, archive);
      const loaded = readRawPagesArchive(archivePath);

      expect(loaded.schemaVersion).toBe(1);
      expect(Object.keys(loaded.pages)).toHaveLength(2);
      expect(loaded.pages["https://example.com/page1"]!.html).toBe(
        "<html><body>Page 1</body></html>"
      );
      expect(loaded.pages["https://example.com/page2"]!.finalUrl).toBe(
        "https://example.com/page2-redirected"
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws when archive file does not exist", () => {
    expect(() => readRawPagesArchive("/nonexistent/archive.json")).toThrow(
      "Raw pages archive not found"
    );
  });

  it("throws when archive has wrong schema version", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "campfire-pipeline-io-"));
    const archivePath = join(tmpDir, "bad-version.json");

    try {
      writeFileSync(archivePath, JSON.stringify({ schemaVersion: 99, pages: {} }));
      expect(() => readRawPagesArchive(archivePath)).toThrow("schema version");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
