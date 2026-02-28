import { describe, expect, it } from "vitest";
import {
  TotalFireBanService,
  UNKNOWN_TOTAL_FIRE_BAN_STATUS_TEXT
} from "../../pipeline/services/total-fire-ban-service.js";

describe("TotalFireBanService", () => {
  it("maps coordinates to current total fire ban status", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);

      if (url.includes("fire-danger-ratings-v2")) {
        return new Response(
          JSON.stringify({
            fireWeatherAreaRatings: [
              {
                areaId: "1",
                areaName: "Test Fire Area",
                tobanToday: "Yes"
              }
            ],
            lastUpdatedIso: "2026-02-22T10:00:00+11:00"
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }

      if (url.includes("fire-danger-ratings-geojson")) {
        return new Response(
          JSON.stringify({
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {
                  FIREAREAID: 1,
                  FIREAREA: "Test Fire Area"
                },
                geometry: {
                  type: "Polygon",
                  coordinates: [
                    [
                      [150, -34],
                      [151, -34],
                      [151, -33],
                      [150, -33],
                      [150, -34]
                    ]
                  ]
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const service = new TotalFireBanService({ fetchImpl });
    const snapshot = await service.fetchCurrentSnapshot();

    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.areaStatuses).toHaveLength(1);

    const inside = service.lookupStatusByCoordinates(snapshot, -33.5, 150.5);
    expect(inside).toMatchObject({
      status: "BANNED",
      statusText: "Total Fire Ban",
      fireWeatherAreaName: "Test Fire Area",
      lookupCode: "MATCHED"
    });

    const outside = service.lookupStatusByCoordinates(snapshot, -30.1, 149.2);
    expect(outside).toMatchObject({
      status: "UNKNOWN",
      statusText: UNKNOWN_TOTAL_FIRE_BAN_STATUS_TEXT,
      lookupCode: "NO_AREA_MATCH"
    });
  });

  it("returns warnings and unknown status when feeds are unavailable", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("network unavailable");
    };

    const service = new TotalFireBanService({ fetchImpl });
    const snapshot = await service.fetchCurrentSnapshot();

    expect(snapshot.areaStatuses).toHaveLength(0);
    expect(snapshot.geoAreas).toHaveLength(0);
    expect(snapshot.warnings.length).toBeGreaterThanOrEqual(2);

    const lookup = service.lookupStatusByCoordinates(snapshot, -33.8, 151.2);
    expect(lookup).toMatchObject({
      status: "UNKNOWN",
      statusText: UNKNOWN_TOTAL_FIRE_BAN_STATUS_TEXT,
      lookupCode: "DATA_UNAVAILABLE"
    });
  });
});
