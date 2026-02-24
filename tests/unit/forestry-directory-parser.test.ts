import { describe, expect, it } from "vitest";
import {
  parseForestDirectoryFilters,
  parseForestDirectoryForests,
  parseForestDirectoryForestNames,
  parseForestDirectoryWithFacilities
} from "../../apps/api/src/services/forestry-directory-parser.js";

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

describe("parseForestDirectoryWithFacilities", () => {
  it("extracts forests with facilities from tooltip icons on a single page", () => {
    const html = `
      <div class="mb-4">
        <strong><a href="/visit/forests/awaba-state-forest">Awaba State Forest</a></strong>
        <i data-toggle="tooltip" data-original-title="Camping" data-placement="bottom" class="g-color-primary fcicon-camping"></i>
        <i data-toggle="tooltip" data-original-title="Walking track" data-placement="bottom" class="g-color-primary fcicon-walking"></i>
        <i data-toggle="tooltip" data-original-title="4WD tracks" data-placement="bottom" class="g-color-grey fcicon-4wd"></i>
        <i data-toggle="tooltip" data-original-title="Designated mountain bike track" data-placement="bottom" class="g-color-grey fcicon-cycling"></i>
        <i data-toggle="tooltip" data-original-title="Fireplace" data-placement="bottom" class="g-color-primary fcicon-fireplace"></i>
      </div>
      <div class="mb-4">
        <strong><a href="/visit/forests/belanglo-state-forest">Belanglo State Forest</a></strong>
        <i data-toggle="tooltip" data-original-title="Camping" data-placement="bottom" class="g-color-grey fcicon-camping"></i>
        <i data-toggle="tooltip" data-original-title="Walking track" data-placement="bottom" class="g-color-primary fcicon-walking"></i>
        <i data-toggle="tooltip" data-original-title="4WD tracks" data-placement="bottom" class="g-color-primary fcicon-4wd"></i>
        <i data-toggle="tooltip" data-original-title="Designated mountain bike track" data-placement="bottom" class="g-color-primary fcicon-cycling"></i>
        <i data-toggle="tooltip" data-original-title="Fireplace" data-placement="bottom" class="g-color-grey fcicon-fireplace"></i>
      </div>
    `;

    const result = parseForestDirectoryWithFacilities(html);

    expect(result.warnings).toEqual([]);
    expect(result.filters).toHaveLength(5);
    expect(result.filters.map((filter) => filter.label)).toEqual([
      "Camping",
      "Walking track",
      "4WD tracks",
      "Designated mountain bike track",
      "Fireplace"
    ]);

    expect(result.forests).toHaveLength(2);

    const awaba = result.forests.find((forest) => forest.forestName === "Awaba State Forest");
    expect(awaba).toBeDefined();
    expect(awaba!.forestUrl).toBe("https://www.forestrycorporation.com.au/visit/forests/awaba-state-forest");
    expect(awaba!.facilities).toMatchObject({
      camping: true,
      walking_track: true,
      "4wd_tracks": false,
      designated_mountain_bike_track: false,
      fireplace: true
    });

    const belanglo = result.forests.find((forest) => forest.forestName === "Belanglo State Forest");
    expect(belanglo).toBeDefined();
    expect(belanglo!.facilities).toMatchObject({
      camping: false,
      walking_track: true,
      "4wd_tracks": true,
      designated_mountain_bike_track: true,
      fireplace: false
    });
  });

  it("uses g-color-primary for available and g-color-grey for unavailable", () => {
    const html = `
      <div class="mb-4">
        <a href="/visit/forests/bago-state-forest">Bago State Forest</a>
        <i data-toggle="tooltip" data-original-title="Camping" data-placement="bottom" class="g-color-primary fcicon-20181217-web-icons-01 "></i>
        <i data-toggle="tooltip" data-original-title="4WD tracks" data-placement="bottom" class="g-color-grey fcicon-20181217-web-icons-03 "></i>
      </div>
    `;

    const result = parseForestDirectoryWithFacilities(html);
    expect(result.forests).toHaveLength(1);
    expect(result.forests[0]!.facilities.camping).toBe(true);
    expect(result.forests[0]!.facilities["4wd_tracks"]).toBe(false);
  });

  it("sorts forests alphabetically", () => {
    const html = `
      <div class="mb-4">
        <a href="/visit/forests/zig-zag-state-forest">Zig Zag State Forest</a>
        <i data-original-title="Camping" class="g-color-primary"></i>
      </div>
      <div class="mb-4">
        <a href="/visit/forests/awaba-state-forest">Awaba State Forest</a>
        <i data-original-title="Camping" class="g-color-grey"></i>
      </div>
    `;

    const result = parseForestDirectoryWithFacilities(html);
    expect(result.forests.map((forest) => forest.forestName)).toEqual([
      "Awaba State Forest",
      "Zig Zag State Forest"
    ]);
  });

  it("assigns correct icon keys from tooltip labels", () => {
    const html = `
      <div class="mb-4">
        <a href="/visit/forests/test-state-forest">Test State Forest</a>
        <i data-original-title="Camping" class="g-color-primary"></i>
        <i data-original-title="Walking track" class="g-color-primary"></i>
        <i data-original-title="4WD tracks" class="g-color-grey"></i>
        <i data-original-title="Designated mountain bike track" class="g-color-primary"></i>
        <i data-original-title="Designated horse riding track" class="g-color-grey"></i>
        <i data-original-title="Canoeing/kayaking" class="g-color-grey"></i>
        <i data-original-title="Fishing" class="g-color-primary"></i>
        <i data-original-title="Fireplace" class="g-color-primary"></i>
        <i data-original-title="Toilets" class="g-color-grey"></i>
        <i data-original-title="Wheelchair access" class="g-color-grey"></i>
      </div>
    `;

    const result = parseForestDirectoryWithFacilities(html);
    const iconKeyMap = Object.fromEntries(
      result.filters.map((filter) => [filter.label, filter.iconKey])
    );

    expect(iconKeyMap["Camping"]).toBe("camping");
    expect(iconKeyMap["Walking track"]).toBe("walking");
    expect(iconKeyMap["4WD tracks"]).toBe("four-wheel-drive");
    expect(iconKeyMap["Designated mountain bike track"]).toBe("cycling");
    expect(iconKeyMap["Designated horse riding track"]).toBe("horse-riding");
    expect(iconKeyMap["Canoeing/kayaking"]).toBe("canoeing");
    expect(iconKeyMap["Fishing"]).toBe("fishing");
    expect(iconKeyMap["Fireplace"]).toBe("fireplace");
    expect(iconKeyMap["Toilets"]).toBe("toilets");
    expect(iconKeyMap["Wheelchair access"]).toBe("wheelchair");
  });

  it("deduplicates forests by normalized name", () => {
    const html = `
      <div class="mb-4">
        <a href="/visit/forests/awaba-state-forest">Awaba State Forest</a>
        <i data-original-title="Camping" class="g-color-primary"></i>
      </div>
      <div class="mb-4">
        <a href="/visiting/forests/awaba-state-forest">Awaba State Forest</a>
        <i data-original-title="Camping" class="g-color-grey"></i>
      </div>
    `;

    const result = parseForestDirectoryWithFacilities(html);
    expect(result.forests).toHaveLength(1);
    expect(result.forests[0]!.forestName).toBe("Awaba State Forest");
    // First occurrence wins
    expect(result.forests[0]!.facilities.camping).toBe(true);
  });

  it("falls back when no tooltip icons are present but filters form exists", () => {
    const html = `
      <form>
        <h3>Facilities</h3>
        <label for="camping">Camping</label>
        <input id="camping" type="checkbox" name="camping" value="Yes" />
      </form>
      <a href="/visit/forests/awaba-state-forest">Awaba State Forest</a>
    `;

    const result = parseForestDirectoryWithFacilities(html);
    expect(result.forests).toHaveLength(1);
    expect(result.forests[0]!.forestName).toBe("Awaba State Forest");
    // Fallback: all facilities set to false
    expect(result.forests[0]!.facilities.camping).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns empty snapshot for pages with no forests and no icons", () => {
    const html = `<html><body><p>No content here</p></body></html>`;
    const result = parseForestDirectoryWithFacilities(html);
    expect(result.forests).toEqual([]);
    expect(result.filters).toEqual([]);
  });

  it("handles forest containers using alternative parent structures", () => {
    const html = `
      <div class="forest-result">
        <a href="/visit/forests/barrington-state-forest">Barrington State Forest</a>
        <i data-original-title="Camping" class="g-color-primary"></i>
        <i data-original-title="Walking track" class="g-color-grey"></i>
      </div>
      <div class="forest-result">
        <a href="/visit/forests/coolah-state-forest">Coolah State Forest</a>
        <i data-original-title="Camping" class="g-color-grey"></i>
        <i data-original-title="Walking track" class="g-color-primary"></i>
      </div>
    `;

    const result = parseForestDirectoryWithFacilities(html);
    expect(result.forests).toHaveLength(2);

    const barrington = result.forests.find((forest) => forest.forestName === "Barrington State Forest");
    expect(barrington!.facilities.camping).toBe(true);
    expect(barrington!.facilities.walking_track).toBe(false);

    const coolah = result.forests.find((forest) => forest.forestName === "Coolah State Forest");
    expect(coolah!.facilities.camping).toBe(false);
    expect(coolah!.facilities.walking_track).toBe(true);
  });
});
