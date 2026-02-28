import { describe, expect, it } from "vitest";
import {
  parseClosureNoticesPage,
  parseClosureNoticeDetailPage,
  classifyClosureNoticeTags
} from "../../pipeline/services/forestry-parser.js";
import type { RawPagesArchive, RawPagesArchiveEntry } from "../../shared/pipeline-types.js";

/**
 * Tests that verify parse-closures pipeline logic: reading HTML from a raw
 * pages archive and calling parser functions to produce structured closures.
 *
 * These tests exercise the same code path as pipeline/scripts/parse-closures.ts
 * but without file I/O.
 */

const CLOSURES_LIST_URL = "https://forestclosure.fcnsw.net/indexframe";

const buildArchive = (
  pages: Record<string, string>
): RawPagesArchive => ({
  schemaVersion: 1,
  pages: Object.fromEntries(
    Object.entries(pages).map(([url, html]): [string, RawPagesArchiveEntry] => [
      url,
      { fetchedAt: "2024-01-01T00:00:00.000Z", finalUrl: url, html }
    ])
  )
});

describe("parse-closures pipeline logic", () => {
  it("parses closure notices from archived HTML", () => {
    const listHtml = `
      <div id="closuresList">
        <li id="closureItem1">
          <a href="ClosureDetailsFrame?id=101" title="Watagan State Forest - Road Closed">
            <h3>Watagan State Forest - Road Closed</h3>
            <time>01 Jan 2024</time>
            <time>31 Mar 2024</time>
          </a>
        </li>
      </div>
    `;

    const detailHtml = `
      <main>
        <div class="text-container-wd">
          <p>The main access road is closed due to landslide damage.</p>
          <p>Alternative access via Freemans Drive.</p>
        </div>
      </main>
    `;

    const archive = buildArchive({
      [CLOSURES_LIST_URL]: listHtml,
      [`${CLOSURES_LIST_URL.replace("/indexframe", "")}/ClosureDetailsFrame?id=101`]:
        detailHtml
    });

    // Parse list page
    const listEntry = archive.pages[CLOSURES_LIST_URL]!;
    const closures = parseClosureNoticesPage(listEntry.html, listEntry.finalUrl);
    expect(closures).toHaveLength(1);
    expect(closures[0]!.title).toBe("Watagan State Forest - Road Closed");

    // Parse detail page
    const detailUrl = closures[0]!.detailUrl;
    const detailEntry = archive.pages[detailUrl];
    expect(detailEntry).toBeDefined();

    const detailText = parseClosureNoticeDetailPage(detailEntry!.html);
    expect(detailText).toContain("main access road is closed");
    expect(detailText).toContain("Alternative access");

    // Classify tags from detail text
    const tags = classifyClosureNoticeTags(detailText ?? "");
    expect(tags).toContain("ROAD_ACCESS");
  });

  it("handles missing detail pages gracefully", () => {
    const listHtml = `
      <div id="closuresList">
        <li id="closureItem1">
          <a href="ClosureDetailsFrame?id=999" title="Missing SF - Closed">
            <h3>Missing SF - Closed</h3>
          </a>
        </li>
      </div>
    `;

    const archive = buildArchive({
      [CLOSURES_LIST_URL]: listHtml
    });

    const listEntry = archive.pages[CLOSURES_LIST_URL]!;
    const closures = parseClosureNoticesPage(listEntry.html, listEntry.finalUrl);
    expect(closures).toHaveLength(1);

    // Detail page not in archive — should result in null detailText
    const detailEntry = archive.pages[closures[0]!.detailUrl];
    expect(detailEntry).toBeUndefined();
  });
});
