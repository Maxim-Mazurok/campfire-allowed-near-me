// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkupWithMantine, renderWithMantine } from "../test-utils";
import { ForestCardContent } from "../../web/src/components/ForestCardContent";
import { buildForestCardFixture } from "./forest-card-test-fixtures";

afterEach(() => {
  cleanup();
});

describe("ForestCardContent closures", () => {
  it("renders all closure notices with links", () => {
    const forest = buildForestCardFixture();

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
    const forest = buildForestCardFixture({
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
    const forest = buildForestCardFixture({
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
    const forest = buildForestCardFixture({
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
    const forest = buildForestCardFixture({
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

  it("filters 'Partially closed' notice title as redundant badge label", () => {
    const forest = buildForestCardFixture({
      forestName: "Nowendoc State Forest",
      closureStatus: "PARTIAL",
      closureNotices: [
        {
          id: "notice-partial",
          title: "Nowendoc State Forest: Partially closed",
          detailUrl: "https://example.com/notices/nowendoc",
          listedAt: null,
          listedAtText: null,
          untilAt: null,
          untilText: null,
          forestNameHint: "Nowendoc State Forest",
          status: "PARTIAL",
          tags: []
        }
      ]
    });

    const html = renderToStaticMarkupWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={true} />
    );

    expect(html).toContain('data-testid="closure-badge"');
    expect(html).toContain("Partly closed");
    expect(html).not.toContain('data-testid="forest-notice-list"');
  });

  it("shows all specific notices for partly closed forest with road closures", () => {
    const forest = buildForestCardFixture({
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
    const forest = buildForestCardFixture({
      closureStatus: "NONE",
      closureNotices: []
    });

    const html = renderToStaticMarkupWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={true} />
    );

    expect(html).not.toContain('data-testid="closure-badge"');
    expect(html).not.toContain('data-testid="forest-notice-list"');
  });

  it("shows detailText in tooltip when hovering closure badge", async () => {
    const forest = buildForestCardFixture({
      closureStatus: "CLOSED",
      closureNotices: [
        {
          id: "notice-closed",
          title: "Test Forest: Closed for hazard reduction",
          detailUrl: "https://example.com/notices/closed",
          listedAt: null,
          listedAtText: null,
          untilAt: null,
          untilText: null,
          forestNameHint: "Test Forest",
          status: "CLOSED",
          tags: ["EVENT"],
          detailText: "This forest is closed until further notice due to hazard reduction burning."
        }
      ]
    });

    renderWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={true} />
    );

    const badge = screen.getByTestId("closure-badge");
    await userEvent.hover(badge);

    await waitFor(() => {
      expect(screen.getByRole("tooltip").textContent).toContain(
        "This forest is closed until further notice due to hazard reduction burning."
      );
    });
  });

  it("falls back to notice title in tooltip when detailText is absent", async () => {
    const forest = buildForestCardFixture({
      closureStatus: "PARTIAL",
      closureNotices: [
        {
          id: "notice-partial",
          title: "Test Forest: Partial road closure",
          detailUrl: "https://example.com/notices/partial",
          listedAt: null,
          listedAtText: null,
          untilAt: null,
          untilText: null,
          forestNameHint: "Test Forest",
          status: "PARTIAL",
          tags: ["ROAD_ACCESS"]
        }
      ]
    });

    renderWithMantine(
      <ForestCardContent forest={forest} availableFacilities={[]} avoidTolls={true} />
    );

    const badge = screen.getByTestId("closure-badge");
    await userEvent.hover(badge);

    await waitFor(() => {
      expect(screen.getByRole("tooltip").textContent).toContain(
        "Test Forest: Partial road closure"
      );
    });
  });
});
