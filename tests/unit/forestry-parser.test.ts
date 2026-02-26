import { describe, expect, it } from "vitest";
import {
  parseAreaForestNames,
  parseBanStatus,
  parseClosureNoticeDetailPage,
  parseClosureNoticeForestNameHint,
  parseClosureNoticeStatus,
  parseClosureNoticesPage,
  classifyClosureNoticeTags,
  parseMainFireBanPage
} from "../../apps/api/src/services/forestry-parser.js";

describe("parseBanStatus", () => {
  it("detects no ban text", () => {
    expect(parseBanStatus("No Solid Fuel Fire Ban")).toBe("NOT_BANNED");
  });

  it("detects banned text", () => {
    expect(parseBanStatus("Solid Fuel Fire Ban")).toBe("BANNED");
  });

  it("detects 'solid fuel fires banned' phrasing", () => {
    expect(
      parseBanStatus(
        "Solid Fuel Fires banned in all plantation areas, including camping areas."
      )
    ).toBe("BANNED");
  });

  it("falls back to unknown", () => {
    expect(parseBanStatus("Weather advisory only")).toBe("UNKNOWN");
  });
});

describe("parseMainFireBanPage", () => {
  it("parses area rows from a table", () => {
    const html = `
      <table>
        <tr>
          <th>Forest Area</th>
          <th>Solid Fuel Fire Ban</th>
          <th>Firewood collection</th>
        </tr>
        <tr>
          <td><a href="/visit/south-coast">South Coast</a></td>
          <td>No Solid Fuel Fire Ban</td>
          <td>Firewood collection authorisations not available</td>
        </tr>
        <tr>
          <td><a href="https://www.forestrycorporation.com.au/visit/snowy-region">Snowy Region</a></td>
          <td>Solid Fuel Fires banned in all plantation areas</td>
          <td>Firewood collection authorisations available</td>
        </tr>
      </table>
    `;

    const areas = parseMainFireBanPage(
      html,
      "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans"
    );

    expect(areas).toHaveLength(2);
    expect(areas[0]).toMatchObject({
      areaName: "South Coast",
      areaUrl: "https://www.forestrycorporation.com.au/visit/south-coast",
      status: "NOT_BANNED"
    });

    expect(areas[1]).toMatchObject({
      areaName: "Snowy Region",
      status: "BANNED",
      statusText: "Solid Fuel Fires banned in all plantation areas"
    });
  });
});

describe("closure notices parsing", () => {
  it("extracts forest hints from closure titles", () => {
    expect(
      parseClosureNoticeForestNameHint(
        "Wang Wauk State Forests: Wootton historic railway walk closed"
      )
    ).toBe("Wang Wauk State Forest");
    expect(
      parseClosureNoticeForestNameHint(
        "Ourimbah State Forest's Wallaby Road and Middle Ridge Road closed indefinitely"
      )
    ).toBe("Ourimbah State Forest");
    expect(
      parseClosureNoticeForestNameHint(
        "Nowendoc State Forest: Partially closed"
      )
    ).toBe("Nowendoc State Forest");
    expect(
      parseClosureNoticeForestNameHint(
        "Dalmorton State Forest partially closed"
      )
    ).toBe("Dalmorton State Forest");
  });

  it("classifies definitive full-forest closures as CLOSED", () => {
    expect(parseClosureNoticeStatus("Boonanghi State Forest: Closed")).toBe("CLOSED");
    expect(parseClosureNoticeStatus("Avon River State Forest closed")).toBe("CLOSED");
    expect(parseClosureNoticeStatus("Vittoria State Forest: Closed for pest control operations")).toBe("CLOSED");
    expect(parseClosureNoticeStatus("Nerong State Forest closed")).toBe("CLOSED");
    expect(parseClosureNoticeStatus("Clouds Creek State Forest: Closed")).toBe("CLOSED");
  });

  it("classifies explicit partial keywords as PARTIAL", () => {
    expect(parseClosureNoticeStatus("Cherry Tree State Forest: Partial closure")).toBe("PARTIAL");
    expect(parseClosureNoticeStatus("Nowendoc State Forest: Partially closed")).toBe("PARTIAL");
    expect(parseClosureNoticeStatus("Dalmorton State Forest partially closed")).toBe("PARTIAL");
    expect(parseClosureNoticeStatus("Green Hills State Forest: Partially closed")).toBe("PARTIAL");
    expect(parseClosureNoticeStatus("Putty State Forest: partly closed")).toBe("PARTIAL");
    expect(parseClosureNoticeStatus("Bondo State Forest: Partial Road Closure Notice")).toBe("PARTIAL");
    expect(parseClosureNoticeStatus("Bago State Forest: Sections of plantations closed")).toBe("PARTIAL");
    expect(parseClosureNoticeStatus("Leard State Forest: Exclusive use on part")).toBe("PARTIAL");
    expect(parseClosureNoticeStatus("Penrose State Forest closed - Limited camping only off Paddys River Road")).toBe("PARTIAL");
  });

  it("classifies non-definitive closures as PARTIAL for LLM resolution", () => {
    expect(
      parseClosureNoticeStatus("Wang Wauk State Forests: Wootton historic railway walk closed")
    ).toBe("PARTIAL");
    expect(
      parseClosureNoticeStatus("Bellangry State Forest: Number 1 Tower Picnic Area closed")
    ).toBe("PARTIAL");
    expect(
      parseClosureNoticeStatus("Masseys Creek State Forest campgrounds closed due to bushfire impact")
    ).toBe("PARTIAL");
    expect(
      parseClosureNoticeStatus("Masseys Creek State Forest: Boonabilla Road and Basin Road closed to vehicle traffic")
    ).toBe("PARTIAL");
    expect(
      parseClosureNoticeStatus("Sunny Corner State Forest: Mary's Park closed for restoration")
    ).toBe("PARTIAL");
    expect(
      parseClosureNoticeStatus("Vulcan State Forest: Blue Hill quarry area closed to fossicking")
    ).toBe("PARTIAL");
    expect(
      parseClosureNoticeStatus("Temporary closure of Blackbutt Road, Kerewong State Forest")
    ).toBe("PARTIAL");
    expect(
      parseClosureNoticeStatus("Bridge closure in Watagan State Forest")
    ).toBe("PARTIAL");
    expect(
      parseClosureNoticeStatus("Glenwood State Forest: Closure of Mountain Bike Trails due to harvesting")
    ).toBe("PARTIAL");
    expect(
      parseClosureNoticeStatus("Fire trail closure near campground")
    ).toBe("PARTIAL");
    expect(
      parseClosureNoticeStatus("Styx River State Forest trail closed")
    ).toBe("PARTIAL");
    expect(
      parseClosureNoticeStatus("Ourimbah State Forest's Wallaby Road and Middle Ridge Road closed indefinitely")
    ).toBe("PARTIAL");
    expect(
      parseClosureNoticeStatus("Mount Boss State Forest: Fire Tower No.1 Picnic Area closed")
    ).toBe("PARTIAL");
  });

  it("classifies notices without closure language as NOTICE", () => {
    expect(parseClosureNoticeStatus("Belanglo State Forest: Large community event")).toBe("NOTICE");
    expect(parseClosureNoticeStatus("Coopernook State Forest: Increased truck traffic")).toBe("NOTICE");
    expect(parseClosureNoticeStatus("Barrington Tops State Forest: Landslip on Barrington Tops Forest Road")).toBe("NOTICE");
  });

  it("classifies closure tags from title text", () => {
    expect(classifyClosureNoticeTags("Bondo State Forest: Partial Road Closure Notice")).toEqual(
      expect.arrayContaining(["ROAD_ACCESS"])
    );
    expect(classifyClosureNoticeTags("Penrose State Forest: Limited camping access")).toEqual(
      expect.arrayContaining(["CAMPING", "ROAD_ACCESS"])
    );
    expect(
      classifyClosureNoticeTags("Vittoria State Forest: Closed for pest control operations")
    ).toEqual(expect.arrayContaining(["OPERATIONS"]));
  });

  it("parses closure notices from closures list page", () => {
    const html = `
      <div id="closuresList">
        <ol>
          <li id="closureItem0">
            <a href="./ClosureDetailsFrame?id=3664" title="Avon River State Forest closed">
              <h3>Avon River State Forest closed</h3>
              <p>
                <span class="fb-summary">When: <time>2025-05-06T23:10:00.0000000Z</time></span>
                <span> until <time>further notice</time></span>
              </p>
            </a>
          </li>
          <li id="closureItem1">
            <a href="./ClosureDetailsFrame?id=5119" title="Belanglo State Forest: Closed due to large community event">
              <h3>Belanglo State Forest: Closed due to large community event</h3>
              <p>
                <span class="fb-summary">When: <time>2026-05-01T01:59:00.0000000Z</time></span>
                <span> until <time>2026-05-03T00:00:00.0000000Z</time></span>
              </p>
            </a>
          </li>
        </ol>
      </div>
    `;

    const notices = parseClosureNoticesPage(html, "https://forestclosure.fcnsw.net/indexframe");
    expect(notices).toHaveLength(2);
    expect(notices[0]).toMatchObject({
      id: "3664",
      title: "Avon River State Forest closed",
      detailUrl: "https://forestclosure.fcnsw.net/ClosureDetailsFrame?id=3664",
      forestNameHint: "Avon River State Forest",
      status: "CLOSED"
    });
    expect(notices[0]?.untilAt).toBeNull();
    expect(notices[1]).toMatchObject({
      id: "5119",
      title: "Belanglo State Forest: Closed due to large community event",
      status: "CLOSED"
    });
    expect(notices[1]?.tags).toEqual(expect.arrayContaining(["EVENT"]));
    expect(notices[1]?.untilAt).toBe("2026-05-03T00:00:00.000Z");
  });

  it("extracts closure detail prose from notice page", () => {
    const html = `
      <main>
        <h2>Sample State Forest: Partial closure</h2>
        <h3>More Information</h3>
        <div class="text-container-wd">
          <p>Camping areas remain open.</p>
          <p>Knodingbul Road is closed at the Mount George end.</p>
        </div>
      </main>
    `;

    expect(parseClosureNoticeDetailPage(html)).toBe(
      "Camping areas remain open.\nKnodingbul Road is closed at the Mount George end."
    );
  });

  it("preserves paragraph breaks between consecutive paragraphs without extra whitespace", () => {
    const html = `
      <main>
        <div class="text-container-wd">
          <p>Camping areas at Blowering dam are open.</p><p>Please note that sections of plantations in Bago State Forest, west of Blowering Dam, remain closed due to significant impact from severe weather and bushfires.</p><p>Main access roads to Blowering Dam are open and safe. However minor roads remain closed and are generally inaccessible.</p><p>Please follow any road signage and pay attention to conditions when driving.</p>
        </div>
      </main>
    `;

    expect(parseClosureNoticeDetailPage(html)).toBe(
      [
        "Camping areas at Blowering dam are open.",
        "Please note that sections of plantations in Bago State Forest, west of Blowering Dam, remain closed due to significant impact from severe weather and bushfires.",
        "Main access roads to Blowering Dam are open and safe. However minor roads remain closed and are generally inaccessible.",
        "Please follow any road signage and pay attention to conditions when driving."
      ].join("\n")
    );
  });

  it("converts br tags to line breaks in detail text", () => {
    const html = `
      <main>
        <div class="text-container-wd">
          <p>Road closed at bridge crossing.<br>Detour via Old Pacific Highway.<br>Expected to reopen March 2026.</p>
        </div>
      </main>
    `;

    expect(parseClosureNoticeDetailPage(html)).toBe(
      "Road closed at bridge crossing.\nDetour via Old Pacific Highway.\nExpected to reopen March 2026."
    );
  });
});

describe("parseAreaForestNames", () => {
  it("extracts forest names from the area section list", () => {
    const html = `
      <p>This area includes the following State forests:</p>
      <ul>
        <li>Belanglo State Forest</li>
        <li>Bargo State Forest</li>
        <li>Yerranderie State Forest</li>
      </ul>
    `;

    expect(parseAreaForestNames(html)).toEqual([
      "Belanglo State Forest",
      "Bargo State Forest",
      "Yerranderie State Forest"
    ]);
  });

  it("prefers include lists and ignores excluded-list sections", () => {
    const html = `
      <p>State forests of the South Coast include:</p>
      <ul>
        <li>Bermagui State Forest</li>
        <li>Bodalla State Forest</li>
        <li>Currambene State Forest</li>
      </ul>
      <p>
        The following State forests are excluded in this list and sit in the Southern Highlands area list:
      </p>
      <ul>
        <li>Belanglo State Forest</li>
        <li>Wingello State Forest</li>
      </ul>
    `;

    expect(parseAreaForestNames(html)).toEqual([
      "Bermagui State Forest",
      "Bodalla State Forest",
      "Currambene State Forest"
    ]);
  });

  it("ignores non-forest noise entries in include lists", () => {
    const html = `
      <p>This area includes the following State forests:</p>
      <ul>
        <li>Find a State forest</li>
        <li>Defined State forest area</li>
        <li>Includes: Mountain Biking in Glenwood State Forest</li>
        <li>Coolangubra State Forest</li>
      </ul>
    `;

    expect(parseAreaForestNames(html)).toEqual(["Coolangubra State Forest"]);
  });

  it("appends State Forest suffix to bare names without it", () => {
    const html = `
      <p>This area includes the following State forests:</p>
      <ul>
        <li>Micalong</li>
        <li>Mowamba.</li>
      </ul>
    `;

    expect(parseAreaForestNames(html)).toEqual([
      "Micalong State Forest",
      "Mowamba State Forest"
    ]);
  });

  it("collects only included forests when page has exclusion list with bare names", () => {
    const html = `
      <p>This area includes the following State forests:</p>
      <ul>
        <li>Micalong</li>
        <li>Mowamba.</li>
      </ul>
      <p>
        Please note that the following State forests are excluded in this list
        and sit in the <a href="/other">Pine forests around Tumut</a> area list:
      </p>
      <ul>
        <li>Bago State Forest</li>
        <li>Billapaloola State Forest</li>
        <li>Bondo State Forest</li>
      </ul>
    `;

    expect(parseAreaForestNames(html)).toEqual([
      "Micalong State Forest",
      "Mowamba State Forest"
    ]);
  });

  it("handles multiple exclusion blocks after the main include list", () => {
    const html = `
      <p>State forests of the South Coast include:</p>
      <ul>
        <li>Bermagui State Forest</li>
        <li>Bodalla State Forest</li>
      </ul>
      <h2>Please note</h2>
      <p>
        The following State forests are excluded in this list and sit in the
        Southern Highlands area list:
      </p>
      <ul>
        <li>Belanglo State Forest</li>
        <li>Wingello State Forest</li>
      </ul>
      <p>
        The following State forests are excluded in this list and sit in the
        Bombala area list:
      </p>
      <ul>
        <li>Badja State Forest</li>
        <li>Nalbaugh State Forest</li>
      </ul>
    `;

    expect(parseAreaForestNames(html)).toEqual([
      "Bermagui State Forest",
      "Bodalla State Forest"
    ]);
  });

  it("strips trailing periods from forest names with State Forest suffix", () => {
    const html = `
      <p>This area includes the following State forests:</p>
      <ul>
        <li>Vulcan State Forest.</li>
        <li>Woomargama State Forest.</li>
      </ul>
    `;

    expect(parseAreaForestNames(html)).toEqual([
      "Vulcan State Forest",
      "Woomargama State Forest"
    ]);
  });
});
