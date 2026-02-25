// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { useState } from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderToStaticMarkupWithMantine, renderWithMantine } from "../test-utils";
import { ForestCardContent } from "../../apps/web/src/components/ForestCardContent";
import type { ForestApiResponse } from "../../apps/web/src/lib/api";

afterEach(() => {
  cleanup();
});

const buildForest = (overrides?: Partial<ForestApiResponse["forests"][number]>): ForestApiResponse["forests"][number] => ({
  id: "forest-a",
  source: "Forestry Corporation NSW",
  areas: [{ areaName: "Area 1", areaUrl: "https://example.com/area-1", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
  forestName: "Forest A",
  forestUrl: "https://example.com/forest-a",
  totalFireBanStatus: "NOT_BANNED",
  totalFireBanStatusText: "No Total Fire Ban",
  latitude: -33.9,
  longitude: 151.1,
  geocodeName: "Forest A, NSW",
  geocodeConfidence: 0.85,
  facilities: {},
  closureStatus: "PARTIAL",
  closureNotices: [
    {
      id: "notice-1",
      title: "Road access restrictions in Forest A",
      detailUrl: "https://example.com/notices/forest-a/road-access",
      listedAt: null,
      listedAtText: null,
      untilAt: null,
      untilText: null,
      forestNameHint: "Forest A",
      status: "PARTIAL",
      tags: ["ROAD_ACCESS"]
    },
    {
      id: "notice-2",
      title: "Campground works in Forest A",
      detailUrl: "https://example.com/notices/forest-a/campground-works",
      listedAt: null,
      listedAtText: null,
      untilAt: null,
      untilText: null,
      forestNameHint: "Forest A",
      status: "NOTICE",
      tags: ["CAMPING"]
    }
  ],
  distanceKm: 14.2,
  travelDurationMinutes: 20,
  ...overrides
});

describe("ForestCardContent", () => {
  it("renders all closure notices with links", () => {
    const forest = buildForest();

    const html = renderToStaticMarkupWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={true} />
    );

    expect(html).toContain('data-testid="forest-notice-list"');
    expect(html).toContain("Road access restrictions in Forest A");
    expect(html).toContain("Campground works in Forest A");
    expect(html).toContain("https://example.com/notices/forest-a/road-access");
    expect(html).toContain("https://example.com/notices/forest-a/campground-works");
  });

  it("strips forest name prefix and capitalizes notice titles", () => {
    const forest = buildForest({
      forestName: "Kerewong State Forest",
      closureStatus: "PARTIAL",
      closureNotices: [
        {
          id: "notice-colon-prefix",
          title: "Kerewong State Forest: Temporary closure of Blackbutt Road",
          detailUrl: "https://example.com/notices/blackbutt",
          listedAt: null,
          listedAtText: null,
          untilAt: null,
          untilText: null,
          forestNameHint: "Kerewong State Forest",
          status: "PARTIAL",
          tags: ["ROAD_ACCESS"]
        },
        {
          id: "notice-space-prefix",
          title: "Kerewong State Forest road works",
          detailUrl: "https://example.com/notices/road-works",
          listedAt: null,
          listedAtText: null,
          untilAt: null,
          untilText: null,
          forestNameHint: "Kerewong State Forest",
          status: "NOTICE",
          tags: ["ROAD_ACCESS"]
        }
      ]
    });

    const html = renderToStaticMarkupWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={true} />
    );

    expect(html).toContain("Temporary closure of Blackbutt Road");
    expect(html).toContain("Road works");
    expect(html).not.toContain("Kerewong State Forest:");
    expect(html).not.toContain("Kerewong State Forest road");
  });

  it("closure badge links to the primary closure notice", () => {
    const forest = buildForest({
      closureStatus: "CLOSED",
      closureNotices: [
        {
          id: "notice-closed",
          title: "Forest A: Closed",
          detailUrl: "https://example.com/notices/closed",
          listedAt: null,
          listedAtText: null,
          untilAt: null,
          untilText: null,
          forestNameHint: "Forest A",
          status: "CLOSED",
          tags: []
        }
      ]
    });

    const html = renderToStaticMarkupWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={true} />
    );

    expect(html).toContain('data-testid="closure-badge"');
    expect(html).toContain('href="https://example.com/notices/closed"');
    expect(html).toContain(">Closed</");
  });

  it("hides badge-redundant 'Closed' notice from list; only badge + landslip shown", () => {
    const forest = buildForest({
      forestName: "Barrington Tops State Forest",
      closureStatus: "CLOSED",
      closureNotices: [
        {
          id: "notice-closed",
          title: "Barrington Tops State Forest: Closed",
          detailUrl: "https://example.com/notices/closed",
          listedAt: null,
          listedAtText: null,
          untilAt: null,
          untilText: null,
          forestNameHint: "Barrington Tops State Forest",
          status: "CLOSED",
          tags: []
        },
        {
          id: "notice-landslip",
          title: "Barrington Tops State Forest: Landslip on Barrington Tops Forest Road",
          detailUrl: "https://example.com/notices/landslip",
          listedAt: null,
          listedAtText: null,
          untilAt: null,
          untilText: null,
          forestNameHint: "Barrington Tops State Forest",
          status: "PARTIAL",
          tags: ["ROAD_ACCESS"]
        }
      ]
    });

    const html = renderToStaticMarkupWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={true} />
    );

    expect(html).toContain('data-testid="closure-badge"');
    expect(html).toContain('href="https://example.com/notices/closed"');
    expect(html).toContain('data-testid="forest-notice-list"');
    expect(html).toContain("Landslip on Barrington Tops Forest Road");
    // The "Closed" notice should not appear in the notice list (only as the badge)
    expect(html).not.toContain('class="forest-notice-link" target="_blank" rel="noreferrer">Closed</a>');
  });

  it("hides notices list entirely when single 'Closed' notice is badge-redundant", () => {
    const forest = buildForest({
      closureStatus: "CLOSED",
      closureNotices: [
        {
          id: "notice-closed",
          title: "Forest A: Closed",
          detailUrl: "https://example.com/notices/closed",
          listedAt: null,
          listedAtText: null,
          untilAt: null,
          untilText: null,
          forestNameHint: "Forest A",
          status: "CLOSED",
          tags: []
        }
      ]
    });

    const html = renderToStaticMarkupWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={true} />
    );

    expect(html).toContain('data-testid="closure-badge"');
    expect(html).not.toContain('data-testid="forest-notice-list"');
  });

  it("shows all specific notices for partly closed forest with road closures", () => {
    const forest = buildForest({
      forestName: "Kerewong State Forest",
      closureStatus: "PARTIAL",
      closureNotices: [
        {
          id: "notice-road-1",
          title: "Temporary closure of Blackbutt Road",
          detailUrl: "https://example.com/notices/blackbutt",
          listedAt: null,
          listedAtText: null,
          untilAt: null,
          untilText: null,
          forestNameHint: "Kerewong State Forest",
          status: "PARTIAL",
          tags: ["ROAD_ACCESS"]
        },
        {
          id: "notice-road-2",
          title: "Temporary closure of Kerewong Road",
          detailUrl: "https://example.com/notices/kerewong-road",
          listedAt: null,
          listedAtText: null,
          untilAt: null,
          untilText: null,
          forestNameHint: "Kerewong State Forest",
          status: "PARTIAL",
          tags: ["ROAD_ACCESS"]
        }
      ]
    });

    const html = renderToStaticMarkupWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={true} />
    );

    expect(html).toContain('data-testid="closure-badge"');
    expect(html).toContain("Partly closed");
    expect(html).toContain('data-testid="forest-notice-list"');
    expect(html).toContain("Temporary closure of Blackbutt Road");
    expect(html).toContain("Temporary closure of Kerewong Road");
  });

  it("does not show closure badge for forests with NONE closure status", () => {
    const forest = buildForest({
      closureStatus: "NONE",
      closureNotices: []
    });

    const html = renderToStaticMarkupWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={true} />
    );

    expect(html).not.toContain('data-testid="closure-badge"');
    expect(html).not.toContain('data-testid="forest-notice-list"');
  });

  it("calls onHoveredAreaNameChange on area name mouseenter and mouseleave", () => {
    const onHoveredAreaNameChange = vi.fn<(hoveredAreaName: string | null) => void>();
    const forest = buildForest();

    renderWithMantine(
      <ForestCardContent
        forest={forest}
        availableFacilities={[]}
        avoidTolls={true}
        onHoveredAreaNameChange={onHoveredAreaNameChange}
      />
    );

    const areaLink = screen.getByTestId("forest-area-link");
    expect(areaLink).toBeTruthy();

    fireEvent.mouseEnter(areaLink);
    expect(onHoveredAreaNameChange).toHaveBeenCalledWith("Area 1");

    fireEvent.mouseLeave(areaLink);
    expect(onHoveredAreaNameChange).toHaveBeenCalledWith(null);
  });

  it("renders status badges with light variant", () => {
    const forest = buildForest({ areas: [{ areaName: "Area 1", areaUrl: "https://example.com/area-1", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }], totalFireBanStatus: "BANNED" });

    const html = renderToStaticMarkupWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={true} />
    );

    expect(html).toContain("data-variant=\"light\"");
    expect(html).not.toContain("data-variant=\"filled\"");
  });

  it("shortens forest name by removing 'State Forest' suffix and shows full name in title", () => {
    const forest = buildForest({
      forestName: "Kerewong State Forest",
      forestUrl: "https://example.com/kerewong"
    });

    const html = renderToStaticMarkupWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={true} />
    );

    expect(html).toContain(">Kerewong</a>");
    expect(html).not.toContain(">Kerewong State Forest</a>");
    expect(html).toContain('title="Kerewong State Forest"');
  });

  it("renders area name with descriptive title attribute", () => {
    const forest = buildForest({
      areas: [{ areaName: "Manning", areaUrl: "https://example.com/area-1", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }]
    });

    const html = renderToStaticMarkupWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={true} />
    );

    expect(html).toContain('title="Forest region (FCNSW management area): Manning"');
  });

  it("renders multiple areas for a multi-area forest", () => {
    const forest = buildForest({
      areas: [
        { areaName: "Pine Forests of Tumut", areaUrl: "https://example.com/pine-tumut", banStatus: "BANNED", banStatusText: "Banned" },
        { areaName: "Native Forests of Bago", areaUrl: "https://example.com/native-bago", banStatus: "NOT_BANNED", banStatusText: "No ban" }
      ]
    });

    const html = renderToStaticMarkupWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={true} />
    );

    expect(html).toContain("Pine Forests of Tumut");
    expect(html).toContain("Native Forests of Bago");
    expect(html).toContain("https://example.com/pine-tumut");
    expect(html).toContain("https://example.com/native-bago");
  });

  it("fires hover callback with correct area name for each area in multi-area forest", () => {
    const onHoveredAreaNameChange = vi.fn();
    const forest = buildForest({
      areas: [
        { areaName: "Alpha Area", areaUrl: "https://example.com/alpha", banStatus: "NOT_BANNED", banStatusText: "No ban" },
        { areaName: "Beta Area", areaUrl: "https://example.com/beta", banStatus: "BANNED", banStatusText: "Banned" }
      ]
    });

    renderWithMantine(
      <ForestCardContent
        forest={forest}
        availableFacilities={[]}
        onHoveredAreaNameChange={onHoveredAreaNameChange}
        avoidTolls={true}
      />
    );

    const alphaLink = screen.getByText("Alpha Area");
    const betaLink = screen.getByText("Beta Area");

    fireEvent.mouseEnter(alphaLink);
    expect(onHoveredAreaNameChange).toHaveBeenCalledWith("Alpha Area");

    fireEvent.mouseLeave(alphaLink);
    expect(onHoveredAreaNameChange).toHaveBeenCalledWith(null);

    fireEvent.mouseEnter(betaLink);
    expect(onHoveredAreaNameChange).toHaveBeenCalledWith("Beta Area");

    fireEvent.mouseLeave(betaLink);
    expect(onHoveredAreaNameChange).toHaveBeenCalledWith(null);
  });

  it("updates real React state correctly when hovering each area of a multi-area forest", () => {
    const forest = buildForest({
      areas: [
        { areaName: "Alpha Area", areaUrl: "https://example.com/alpha", banStatus: "NOT_BANNED", banStatusText: "No ban" },
        { areaName: "Beta Area", areaUrl: "https://example.com/beta", banStatus: "BANNED", banStatusText: "Banned" }
      ]
    });

    function StatefulTestHarness() {
      const [hoveredAreaName, setHoveredAreaName] = useState<string | null>(null);

      return (
        <>
          <ForestCardContent
            forest={forest}
            availableFacilities={[]}
            avoidTolls={true}
            onHoveredAreaNameChange={setHoveredAreaName}
          />
          <div data-testid="current-hovered-area">{hoveredAreaName ?? "none"}</div>
        </>
      );
    }

    renderWithMantine(<StatefulTestHarness />);

    const indicator = screen.getByTestId("current-hovered-area");
    expect(indicator.textContent).toBe("none");

    const alphaLink = screen.getByText("Alpha Area");
    const betaLink = screen.getByText("Beta Area");

    // Hover Alpha
    fireEvent.mouseEnter(alphaLink);
    expect(indicator.textContent).toBe("Alpha Area");

    fireEvent.mouseLeave(alphaLink);
    expect(indicator.textContent).toBe("none");

    // Hover Beta
    fireEvent.mouseEnter(betaLink);
    expect(indicator.textContent).toBe("Beta Area");

    fireEvent.mouseLeave(betaLink);
    expect(indicator.textContent).toBe("none");

    // Direct transition: Alpha → Beta (leave Alpha, then enter Beta)
    fireEvent.mouseEnter(alphaLink);
    expect(indicator.textContent).toBe("Alpha Area");

    fireEvent.mouseLeave(alphaLink);
    fireEvent.mouseEnter(betaLink);
    expect(indicator.textContent).toBe("Beta Area");

    fireEvent.mouseLeave(betaLink);
    expect(indicator.textContent).toBe("none");
  });
});