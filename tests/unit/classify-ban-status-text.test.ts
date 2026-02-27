import { describe, it, expect } from "vitest";
import { classifyBanStatusText } from "../../apps/api/src/services/forestry-parser";
import type { BanStatusClassification } from "../../apps/api/src/services/forestry-parser";

describe("classifyBanStatusText", () => {
  describe("KNOWN full-match patterns", () => {
    it("classifies 'No ban' as NOT_BANNED / ALL", () => {
      const result = classifyBanStatusText("No ban");
      expect(result).toEqual<BanStatusClassification>({
        status: "NOT_BANNED",
        banScope: "ALL",
        confidence: "KNOWN"
      });
    });

    it("classifies 'no solid fuel fire ban' (case-insensitive)", () => {
      const result = classifyBanStatusText("No Solid Fuel Fire Ban");
      expect(result).toEqual<BanStatusClassification>({
        status: "NOT_BANNED",
        banScope: "ALL",
        confidence: "KNOWN"
      });
    });

    it("classifies 'Solid fuel fires banned' as BANNED / ALL", () => {
      const result = classifyBanStatusText("Solid fuel fires banned");
      expect(result).toEqual<BanStatusClassification>({
        status: "BANNED",
        banScope: "ALL",
        confidence: "KNOWN"
      });
    });

    it("classifies 'Solid Fuel Fires banned' (mixed case)", () => {
      const result = classifyBanStatusText("Solid Fuel Fires banned");
      expect(result).toEqual<BanStatusClassification>({
        status: "BANNED",
        banScope: "ALL",
        confidence: "KNOWN"
      });
    });

    it("classifies 'Solid Fuel Fire Ban' as BANNED / ALL", () => {
      const result = classifyBanStatusText("Solid Fuel Fire Ban");
      expect(result).toEqual<BanStatusClassification>({
        status: "BANNED",
        banScope: "ALL",
        confidence: "KNOWN"
      });
    });

    it("classifies OUTSIDE_CAMPS when banned outside designated campgrounds", () => {
      const result = classifyBanStatusText(
        "Solid fuel fires are banned outside designated campgrounds. " +
        "Solid fuel fires are permitted inside designated campgrounds."
      );
      expect(result).toEqual<BanStatusClassification>({
        status: "BANNED",
        banScope: "OUTSIDE_CAMPS",
        confidence: "KNOWN"
      });
    });

    it("classifies OUTSIDE_CAMPS for shorter form", () => {
      const result = classifyBanStatusText(
        "Solid fuel fires are banned outside designated campgrounds."
      );
      expect(result).toEqual<BanStatusClassification>({
        status: "BANNED",
        banScope: "OUTSIDE_CAMPS",
        confidence: "KNOWN"
      });
    });

    it("classifies INCLUDING_CAMPS when banned including camping areas", () => {
      const result = classifyBanStatusText(
        "Solid Fuel Fires banned in all plantation areas, including camping areas on the western foreshore of Blowering dam, Bago State Forest."
      );
      expect(result).toEqual<BanStatusClassification>({
        status: "BANNED",
        banScope: "INCLUDING_CAMPS",
        confidence: "KNOWN"
      });
    });
  });

  describe("whitespace tolerance", () => {
    it("normalises extra whitespace", () => {
      const result = classifyBanStatusText("  Solid   fuel  fires   banned  ");
      expect(result.status).toBe("BANNED");
      expect(result.banScope).toBe("ALL");
      expect(result.confidence).toBe("KNOWN");
    });
  });

  describe("empty and unknown inputs", () => {
    it("returns UNKNOWN for empty string", () => {
      const result = classifyBanStatusText("");
      expect(result).toEqual<BanStatusClassification>({
        status: "UNKNOWN",
        banScope: "ALL",
        confidence: "KNOWN"
      });
    });

    it("returns UNKNOWN for whitespace-only", () => {
      const result = classifyBanStatusText("   ");
      expect(result).toEqual<BanStatusClassification>({
        status: "UNKNOWN",
        banScope: "ALL",
        confidence: "KNOWN"
      });
    });

    it("returns UNKNOWN for unrecognized text", () => {
      const result = classifyBanStatusText("Some completely unknown status");
      expect(result).toEqual<BanStatusClassification>({
        status: "UNKNOWN",
        banScope: "ALL",
        confidence: "KNOWN"
      });
    });
  });

  describe("prefix matching and QUESTIONABLE confidence", () => {
    it("returns QUESTIONABLE when prefix matches but remainder has trigger words", () => {
      const result = classifyBanStatusText(
        "Solid fuel fires banned with exceptions for designated campground areas only"
      );
      expect(result.confidence).toBe("QUESTIONABLE");
      expect(result.status).toBe("BANNED");
    });

    it("returns KNOWN when prefix matches and no trigger words in remainder", () => {
      const result = classifyBanStatusText(
        "Solid fuel fires banned until further notice"
      );
      expect(result.status).toBe("BANNED");
      expect(result.banScope).toBe("ALL");
      expect(result.confidence).toBe("KNOWN");
    });
  });
});
