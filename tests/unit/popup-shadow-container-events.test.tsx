// @vitest-environment jsdom
import React, { useCallback, useRef } from "react";
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { PopupShadowContainer } from "../../apps/web/src/components/PopupShadowContainer";
import { ForestCardContent } from "../../apps/web/src/components/ForestCardContent";
import { campfireTheme } from "../../apps/web/src/theme";
import type { ForestApiResponse } from "../../apps/web/src/lib/api";

afterEach(() => {
  cleanup();
});

const buildForest = (): ForestApiResponse["forests"][number] => ({
  id: "forest-a",
  source: "Forestry Corporation NSW",
  areas: [{ areaName: "Hunter Area", areaUrl: "https://example.com/hunter-area", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
  forestName: "Forest A",
  forestUrl: "https://example.com/forest-a",
  totalFireBanStatus: "NOT_BANNED",
  totalFireBanStatusText: "No Total Fire Ban",
  latitude: -33.9,
  longitude: 151.1,
  geocodeName: "Forest A, NSW",
  geocodeConfidence: 0.85,
  facilities: {},
  distanceKm: 14.2,
  travelDurationMinutes: 20
});

const queryInsideShadowRoot = (testId: string): Element => {
  const hostElement = document.querySelector("[style*='display: contents']");
  if (!hostElement) {
    throw new Error("Shadow host not found");
  }
  const shadowRoot = hostElement.shadowRoot;
  if (!shadowRoot) {
    throw new Error("Shadow root not found");
  }
  const element = shadowRoot.querySelector(`[data-testid='${testId}']`);
  if (!element) {
    throw new Error(`Element with data-testid="${testId}" not found in shadow root`);
  }
  return element;
};

const CallbackRefHoverTarget = ({
  onHover
}: {
  onHover: (hovered: boolean) => void;
}) => {
  const cleanupReference = useRef<(() => void) | null>(null);

  const hoverReference = useCallback((element: HTMLDivElement | null) => {
    if (cleanupReference.current) {
      cleanupReference.current();
      cleanupReference.current = null;
    }
    if (!element) {
      return;
    }

    const handleMouseEnter = () => onHover(true);
    const handleMouseLeave = () => onHover(false);

    element.addEventListener("mouseenter", handleMouseEnter);
    element.addEventListener("mouseleave", handleMouseLeave);

    cleanupReference.current = () => {
      element.removeEventListener("mouseenter", handleMouseEnter);
      element.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [onHover]);

  return <div ref={hoverReference} data-testid="hover-target">Hover me</div>;
};

describe("PopupShadowContainer event handling", () => {
  it("fires callback-ref listeners on children inside shadow DOM", async () => {
    const onHover = vi.fn<(hovered: boolean) => void>();

    render(
      <PopupShadowContainer>
        <CallbackRefHoverTarget onHover={onHover} />
      </PopupShadowContainer>
    );

    await vi.waitFor(() => {
      queryInsideShadowRoot("hover-target");
    });

    const hoverTarget = queryInsideShadowRoot("hover-target");

    fireEvent.mouseEnter(hoverTarget);
    expect(onHover).toHaveBeenCalledWith(true);

    fireEvent.mouseLeave(hoverTarget);
    expect(onHover).toHaveBeenCalledWith(false);
  });

  it("fires ForestCardContent area hover events inside shadow DOM", async () => {
    const onHoveredAreaNameChange = vi.fn<(hoveredAreaName: string | null) => void>();
    const forest = buildForest();

    render(
      <MantineProvider theme={campfireTheme}>
        <PopupShadowContainer>
          <ForestCardContent
            forest={forest}
            availableFacilities={[]}
            avoidTolls={true}
            onHoveredAreaNameChange={onHoveredAreaNameChange}
          />
        </PopupShadowContainer>
      </MantineProvider>
    );

    await vi.waitFor(() => {
      queryInsideShadowRoot("forest-area-link");
    });

    const areaLink = queryInsideShadowRoot("forest-area-link");

    fireEvent.mouseEnter(areaLink);
    expect(onHoveredAreaNameChange).toHaveBeenCalledWith("Hunter Area");

    fireEvent.mouseLeave(areaLink);
    expect(onHoveredAreaNameChange).toHaveBeenCalledWith(null);
  });
});
