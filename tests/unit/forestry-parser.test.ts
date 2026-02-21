import { describe, expect, it } from "vitest";
import {
  parseAreaForestNames,
  parseBanStatus,
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
});
