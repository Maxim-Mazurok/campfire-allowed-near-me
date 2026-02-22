import { describe, expect, it } from "vitest";
import {
  parseBanStatus,
  parseClosureNoticeDetailPage,
  parseClosureNoticeForestNameHint,
  parseClosureNoticeStatus,
  parseClosureNoticesPage,
  classifyClosureNoticeTags,
  parseMainFireBanPage
} from "../../apps/api/src/services/forestry-parser.js";
import {
  parseAreaForestNames,
  parseForestDirectoryFilters,
  parseForestDirectoryForests,
  parseForestDirectoryForestNames
} from "../../apps/api/src/services/forestry-directory-parser.js";

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
  });

  it("classifies closure status from title text", () => {
    expect(parseClosureNoticeStatus("Boonanghi State Forest: Closed")).toBe("CLOSED");
    expect(parseClosureNoticeStatus("Cherry Tree State Forest: Partial closure")).toBe("PARTIAL");
    expect(parseClosureNoticeStatus("Belanglo State Forest: Large community event")).toBe(
      "NOTICE"
    );
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
            <a href="./ClosureDetails?id=3664" title="Avon River State Forest closed">
              <h3>Avon River State Forest closed</h3>
              <p>
                <span class="fb-summary">When: <time>2025-05-06T23:10:00.0000000Z</time></span>
                <span> until <time>further notice</time></span>
              </p>
            </a>
          </li>
          <li id="closureItem1">
            <a href="./ClosureDetails?id=5119" title="Belanglo State Forest: Closed due to large community event">
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

    const notices = parseClosureNoticesPage(html, "https://forestclosure.fcnsw.net");
    expect(notices).toHaveLength(2);
    expect(notices[0]).toMatchObject({
      id: "3664",
      title: "Avon River State Forest closed",
      detailUrl: "https://forestclosure.fcnsw.net/ClosureDetails?id=3664",
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
      "Camping areas remain open. Knodingbul Road is closed at the Mount George end."
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
});

describe("parseForestDirectoryFilters", () => {
  it("extracts all facility filters from the Forestry forests directory form", () => {
    const html = `
      <form>
        <h3>Facilities</h3>
        <label for="camping">Camping</label>
        <input id="camping" type="checkbox" name="camping" value="Yes" />
        <label for="walking">Walking track</label>
        <input id="walking" type="checkbox" name="walking" value="Yes" />
        <label for="fourwheeling">4WD tracks</label>
        <input id="fourwheeling" type="checkbox" name="fourwheeling" value="Yes" />
        <label for="cycling">Designated mntn bike track</label>
        <input id="cycling" type="checkbox" name="cycling" value="Yes" />
        <label for="horse">Designated horse riding track</label>
        <input id="horse" type="checkbox" name="horse" value="Yes" />
        <label for="canoeing">Canoeing/kayaking</label>
        <input id="canoeing" type="checkbox" name="canoeing" value="Yes" />
        <label for="waterways">Waterways</label>
        <input id="waterways" type="checkbox" name="waterways" value="Yes" />
        <label for="fishing">Fishing</label>
        <input id="fishing" type="checkbox" name="fishing" value="Yes" />
        <label for="caravan">Caravan site</label>
        <input id="caravan" type="checkbox" name="caravan" value="Yes" />
        <label for="picnicing">Picnic area</label>
        <input id="picnicing" type="checkbox" name="picnicing" value="Yes" />
        <label for="lookout">Lookouts</label>
        <input id="lookout" type="checkbox" name="lookout" value="Yes" />
        <label for="adventure">Adventure</label>
        <input id="adventure" type="checkbox" name="adventure" value="Yes" />
        <label for="hunting">Authorised hunting</label>
        <input id="hunting" type="checkbox" name="hunting" value="Yes" />
        <label for="cabin">Cabins or huts available</label>
        <input id="cabin" type="checkbox" name="cabin" value="Yes" />
        <label for="fireplace">Fireplace</label>
        <input id="fireplace" type="checkbox" name="fireplace" value="Yes" />
        <label for="twowheeling">2WD access</label>
        <input id="twowheeling" type="checkbox" name="twowheeling" value="Yes" />
        <label for="toilets">Toilets</label>
        <input id="toilets" type="checkbox" name="toilets" value="Yes" />
        <label for="wheelchair">Wheelchair access</label>
        <input id="wheelchair" type="checkbox" name="wheelchair" value="Yes" />
      </form>
    `;

    const facilities = parseForestDirectoryFilters(html);
    expect(facilities).toHaveLength(18);
    expect(facilities.map((facility) => facility.label)).toEqual([
      "Camping",
      "Walking track",
      "4WD tracks",
      "Designated mntn bike track",
      "Designated horse riding track",
      "Canoeing/kayaking",
      "Waterways",
      "Fishing",
      "Caravan site",
      "Picnic area",
      "Lookouts",
      "Adventure",
      "Authorised hunting",
      "Cabins or huts available",
      "Fireplace",
      "2WD access",
      "Toilets",
      "Wheelchair access"
    ]);
    expect(facilities[0]).toMatchObject({
      key: "camping",
      paramName: "camping",
      iconKey: "camping"
    });
  });
});

describe("parseForestDirectoryForests", () => {
  it("extracts forest names and canonical detail URLs from directory results", () => {
    const html = `
      <ul>
        <li><a href="/visit/forests/awaba-state-forest">Awaba State Forest</a></li>
        <li><a href="/visiting/forests/chichester-state-forest-allyn-river">Chichester State Forest (Allyn River)</a></li>
      </ul>
    `;

    expect(parseForestDirectoryForests(html)).toEqual([
      {
        forestName: "Awaba State Forest",
        forestUrl: "https://www.forestrycorporation.com.au/visit/forests/awaba-state-forest"
      },
      {
        forestName: "Chichester State Forest (Allyn River)",
        forestUrl:
          "https://www.forestrycorporation.com.au/visit/forests/chichester-state-forest-allyn-river"
      }
    ]);
  });

  it("falls back to map marker scripts when anchor tags are unavailable", () => {
    const html = `
      <script type="text/javascript">
        addMarker("<h3><a href='https://www.forestrycorporation.com.au/visiting/forests/double-duke'>Double Duke State Forest</a></h3>", "-29.1", "153.2", 1)
      </script>
      <script type="text/javascript">
        addMarker("<h3><a href='https://www.forestrycorporation.com.au/visiting/forests/bondi-state-forest'>Bondi State Forest</a></h3>", "-37.1", "149.2", 2)
      </script>
    `;

    expect(parseForestDirectoryForests(html)).toEqual([
      {
        forestName: "Double Duke State Forest",
        forestUrl: "https://www.forestrycorporation.com.au/visit/forests/double-duke"
      },
      {
        forestName: "Bondi State Forest",
        forestUrl: "https://www.forestrycorporation.com.au/visit/forests/bondi-state-forest"
      }
    ]);
  });
});

describe("parseForestDirectoryForestNames", () => {
  it("extracts state forest names from directory results", () => {
    const html = `
      <ul>
        <li><a href="/visit/forests/awaba-state-forest">Awaba State Forest</a></li>
        <li><a href="/visit/forests/chichester-state-forest-allyn-river">Chichester State Forest (Allyn River)</a></li>
        <li><a href="/visit/forests/chichester-state-forest-corkscrew">Chichester State Forest (Corkscrew)</a></li>
      </ul>
    `;

    expect(parseForestDirectoryForestNames(html)).toEqual([
      "Awaba State Forest",
      "Chichester State Forest (Allyn River)",
      "Chichester State Forest (Corkscrew)"
    ]);
  });

  it("parses relative detail links and ignores generic forest-directory links", () => {
    const html = `
      <a href="https://www.forestrycorporation.com.au/visiting/forests">Look up a State forest</a>
      <div class="mb-4">
        <div>
          <strong><a href="forests/bondi-state-forest">Bondi State Forest</a></strong>
          <a href="#" onclick="showOnMap(1);return false;">show on map</a>
        </div>
        <div>Includes: Bondi Forest Park</div>
      </div>
      <div class="mb-4">
        <strong><a href="/visiting/forests/cowarra-state-forest">Cowarra State Forest</a></strong>
      </div>
    `;

    expect(parseForestDirectoryForestNames(html)).toEqual([
      "Bondi State Forest",
      "Cowarra State Forest"
    ]);
  });

  it("falls back to map marker scripts when anchor tags are unavailable", () => {
    const html = `
      <script type="text/javascript">
        addMarker("<h3><a href='https://www.forestrycorporation.com.au/visiting/forests/double-duke'>Double Duke State Forest</a></h3>", "-29.1", "153.2", 1)
      </script>
      <script type="text/javascript">
        addMarker("<h3><a href='https://www.forestrycorporation.com.au/visiting/forests/bondi-state-forest'>Bondi State Forest</a></h3>", "-37.1", "149.2", 2)
      </script>
    `;

    expect(parseForestDirectoryForestNames(html)).toEqual([
      "Double Duke State Forest",
      "Bondi State Forest"
    ]);
  });

  it("ignores non-forest labels even when they contain 'state forest' text", () => {
    const html = `
      <div>
        <a href="/visiting/forests/glenwood-state-forest">Includes: Mountain Biking in Glenwood State Forest</a>
      </div>
      <div>
        <a href="/visiting/forests/woodburn-state-forest">Includes: Woodburn State Forest MTB Park</a>
      </div>
      <div>
        <a href="/visiting/forests/coolangubra-state-forest">Coolangubra State Forest</a>
      </div>
    `;

    expect(parseForestDirectoryForestNames(html)).toEqual(["Coolangubra State Forest"]);
  });
});
