// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { renderWithMantine } from "../test-utils";
import { WarningsSections } from "../../web/src/components/warnings/WarningsSections";
import type { WarningSectionProps } from "../../web/src/components/warnings/WarningsTypes";

afterEach(() => {
  cleanup();
});

const emptyDiagnostics: WarningSectionProps["matchDiagnostics"] = {
  unmatchedFacilitiesForests: [],
  fuzzyMatches: []
};

const emptyClosureDiagnostics: WarningSectionProps["closureDiagnostics"] = {
  unmatchedNotices: [],
  fuzzyMatches: []
};

const baseProperties: WarningSectionProps = {
  hasUnmappedForestWarning: false,
  unmappedForests: [],
  getUnmappedForestLink: () => ({ href: "#", label: "link" }),
  hasUnknownTotalFireBanWarning: false,
  forestsWithUnknownTotalFireBan: [],
  buildTotalFireBanDetailsUrl: () => "#",
  runtimeErrors: [],
  generalWarnings: [],
  hasFacilitiesMismatchWarning: false,
  matchDiagnostics: emptyDiagnostics,
  facilitiesMismatchWarningSummary: "",
  renderFacilitiesMismatchWarningSummary: (text: string) => text,
  openFireBanForestTable: vi.fn(),
  buildFacilitiesForestUrl: () => "#",
  hasFuzzyMatchesWarning: false,
  fuzzyMatchesWarningText: "",
  getFireBanAreaUrl: () => "#",
  closureDiagnostics: emptyClosureDiagnostics
};

describe("WarningsSections", () => {
  it("renders nothing when all sections are empty", () => {
    const { container } = renderWithMantine(
      <WarningsSections {...baseProperties} />
    );

    expect(container.querySelector("[data-testid='warnings-accordion']")).toBeNull();
  });

  it("renders Runtime Errors section when runtimeErrors is non-empty", () => {
    renderWithMantine(
      <WarningsSections
        {...baseProperties}
        runtimeErrors={["Driving routes unavailable — showing straight-line distances instead."]}
      />
    );

    const section = screen.getByTestId("warnings-runtime-errors-section");
    expect(section).toBeTruthy();
    expect(screen.getByText("Runtime Errors")).toBeTruthy();
    expect(within(section).getByText("Driving routes unavailable — showing straight-line distances instead.")).toBeTruthy();
  });

  it("does not render Runtime Errors section when runtimeErrors is empty", () => {
    renderWithMantine(
      <WarningsSections
        {...baseProperties}
        generalWarnings={["Some general warning"]}
      />
    );

    expect(screen.queryByTestId("warnings-runtime-errors-section")).toBeNull();
    expect(screen.getByText("General")).toBeTruthy();
  });

  it("renders both Runtime Errors and General sections simultaneously", () => {
    renderWithMantine(
      <WarningsSections
        {...baseProperties}
        runtimeErrors={["Route API timeout"]}
        generalWarnings={["Stale snapshot"]}
      />
    );

    expect(screen.getByTestId("warnings-runtime-errors-section")).toBeTruthy();
    expect(screen.getByText("Runtime Errors")).toBeTruthy();
    expect(screen.getByText("Route API timeout")).toBeTruthy();
    expect(screen.getByText("General")).toBeTruthy();
    expect(screen.getByText("Stale snapshot")).toBeTruthy();
  });

  it("renders multiple runtime errors as separate list items", () => {
    renderWithMantine(
      <WarningsSections
        {...baseProperties}
        runtimeErrors={[
          "Driving routes unavailable — timeout",
          "Geocoding service degraded"
        ]}
      />
    );

    const section = screen.getByTestId("warnings-runtime-errors-section");
    const listItems = within(section).getAllByRole("listitem");
    expect(listItems).toHaveLength(2);
    expect(listItems[0]?.textContent).toBe("Driving routes unavailable — timeout");
    expect(listItems[1]?.textContent).toBe("Geocoding service degraded");
  });

  it("renders General section with correct aria-label and badge count", () => {
    renderWithMantine(
      <WarningsSections
        {...baseProperties}
        generalWarnings={["Warning A", "Warning B"]}
      />
    );

    const control = screen.getByRole("button", { name: /General Warnings — 2/i });
    expect(control).toBeTruthy();
  });

  it("renders Runtime Errors section with correct aria-label and badge count", () => {
    renderWithMantine(
      <WarningsSections
        {...baseProperties}
        runtimeErrors={["Error 1", "Error 2", "Error 3"]}
      />
    );

    const control = screen.getByRole("button", { name: /Runtime Errors — 3/i });
    expect(control).toBeTruthy();
  });
});
