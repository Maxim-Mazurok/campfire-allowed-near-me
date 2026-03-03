// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { useState } from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderToStaticMarkupWithMantine, renderWithMantine } from "../test-utils";
import { ForestCardContent } from "../../web/src/components/ForestCardContent";
import { buildForestCardFixture } from "./forest-card-test-fixtures";

afterEach(() => {
  cleanup();
});

describe("ForestCardContent rendering", () => {
  it("calls onHoveredAreaNameChange on area name mouseenter and mouseleave", () => {
    const onHoveredAreaNameChange = vi.fn<(hoveredAreaName: string | null) => void>();
    const forest = buildForestCardFixture();

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
    const forest = buildForestCardFixture({ areas: [{ areaName: "Area 1", areaUrl: "https://example.com/area-1", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban", banScope: "ALL" as const }], totalFireBanStatus: "BANNED" });

    const html = renderToStaticMarkupWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={true} />
    );

    expect(html).toContain("data-variant=\"light\"");
    expect(html).not.toContain("data-variant=\"filled\"");
  });

  it("shortens forest name by removing 'State Forest' suffix and shows full name in title", () => {
    const forest = buildForestCardFixture({
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
    const forest = buildForestCardFixture({
      areas: [{ areaName: "Manning", areaUrl: "https://example.com/area-1", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban", banScope: "ALL" }]
    });

    const html = renderToStaticMarkupWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={true} />
    );

    expect(html).toContain('title="Forest region (FCNSW management area): Manning"');
  });

  it("renders multiple areas for a multi-area forest", () => {
    const forest = buildForestCardFixture({
      areas: [
        { areaName: "Pine Forests of Tumut", areaUrl: "https://example.com/pine-tumut", banStatus: "BANNED", banStatusText: "Banned", banScope: "ALL" },
        { areaName: "Native Forests of Bago", areaUrl: "https://example.com/native-bago", banStatus: "NOT_BANNED", banStatusText: "No ban", banScope: "ALL" }
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
    const forest = buildForestCardFixture({
      areas: [
        { areaName: "Alpha Area", areaUrl: "https://example.com/alpha", banStatus: "NOT_BANNED", banStatusText: "No ban", banScope: "ALL" },
        { areaName: "Beta Area", areaUrl: "https://example.com/beta", banStatus: "BANNED", banStatusText: "Banned", banScope: "ALL" }
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
    const forest = buildForestCardFixture({
      areas: [
        { areaName: "Alpha Area", areaUrl: "https://example.com/alpha", banStatus: "NOT_BANNED", banStatusText: "No ban", banScope: "ALL" },
        { areaName: "Beta Area", areaUrl: "https://example.com/beta", banStatus: "BANNED", banStatusText: "Banned", banScope: "ALL" }
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

describe("ForestCardContent distance display", () => {
  it("shows driving distance with Google Maps tooltip when forest has driving route", () => {
    const forest = buildForestCardFixture({ distanceKm: 14.2, travelDurationMinutes: 20, directDistanceKm: 10 });

    const html = renderToStaticMarkupWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={true} />
    );

    expect(html).toContain("14.2 km");
    expect(html).toContain("20m");
    expect(html).not.toContain("straight-line");
  });

  it("shows straight-line distance when forest has no driving route but has coordinates and direct distance", () => {
    const forest = buildForestCardFixture({ distanceKm: null, travelDurationMinutes: null, directDistanceKm: 42.5 });

    const html = renderToStaticMarkupWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={false} />
    );

    expect(html).toContain("~42.5 km straight-line");
    expect(html).not.toContain("14.2 km");
  });

  it("shows nothing for distance when forest has coordinates but neither driving nor direct distance", () => {
    const forest = buildForestCardFixture({ distanceKm: null, travelDurationMinutes: null, directDistanceKm: null });

    const html = renderToStaticMarkupWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={false} />
    );

    expect(html).not.toContain("km");
    expect(html).not.toContain("straight-line");
    expect(html).not.toContain("Location not found");
  });

  it("shows 'Location not found' when forest has no coordinates", () => {
    const forest = buildForestCardFixture({ latitude: null, longitude: null, distanceKm: null, travelDurationMinutes: null, directDistanceKm: null });

    const html = renderToStaticMarkupWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={false} />
    );

    expect(html).toContain("Location not found");
  });
});