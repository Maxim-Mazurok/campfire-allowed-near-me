// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithMantine } from "../test-utils";
import { SettingsDialog } from "../../apps/web/src/components/SettingsDialog";

afterEach(() => {
  cleanup();
});

describe("SettingsDialog", () => {
  it("renders color theme segmented control with light, dark, and system options", () => {
    renderWithMantine(
      <SettingsDialog
        isOpen={true}
        avoidTolls={true}
        onClose={() => {}}
        setAvoidTolls={() => {}}
      />
    );

    expect(screen.getByText("Color theme")).toBeTruthy();
    expect(screen.getByText("Light")).toBeTruthy();
    expect(screen.getByText("Dark")).toBeTruthy();
    expect(screen.getByText("System")).toBeTruthy();
  });

  it("renders toll roads radio group", () => {
    renderWithMantine(
      <SettingsDialog
        isOpen={true}
        avoidTolls={true}
        onClose={() => {}}
        setAvoidTolls={() => {}}
      />
    );

    expect(screen.getByText("Toll roads")).toBeTruthy();
    expect(screen.getByTestId("settings-tolls-avoid")).toBeTruthy();
    expect(screen.getByTestId("settings-tolls-allow")).toBeTruthy();
  });

  it("has title 'Settings'", () => {
    renderWithMantine(
      <SettingsDialog
        isOpen={true}
        avoidTolls={false}
        onClose={() => {}}
        setAvoidTolls={() => {}}
      />
    );

    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("calls setAvoidTolls when toll radio changes", () => {
    const setAvoidTolls = vi.fn<(value: boolean) => void>();

    renderWithMantine(
      <SettingsDialog
        isOpen={true}
        avoidTolls={true}
        onClose={() => {}}
        setAvoidTolls={setAvoidTolls}
      />
    );

    fireEvent.click(screen.getByTestId("settings-tolls-allow"));
    expect(setAvoidTolls).toHaveBeenCalledWith(false);
  });

  it("renders color-scheme-control test id", () => {
    renderWithMantine(
      <SettingsDialog
        isOpen={true}
        avoidTolls={true}
        onClose={() => {}}
        setAvoidTolls={() => {}}
      />
    );

    expect(screen.getByTestId("color-scheme-control")).toBeTruthy();
  });

  it("does not render content when closed", () => {
    renderWithMantine(
      <SettingsDialog
        isOpen={false}
        avoidTolls={true}
        onClose={() => {}}
        setAvoidTolls={() => {}}
      />
    );

    expect(screen.queryByText("Color theme")).toBeNull();
    expect(screen.queryByText("Toll roads")).toBeNull();
  });
});
