import { describe, it, expect } from "vitest";
import { matchesSolidFuelBanFilter } from "../../apps/web/src/lib/app-domain-status";
import type { BanStatus, SolidFuelBanScope } from "../../packages/shared/src/contracts";
import type { BanFilterMode, BanScopeFilterMode } from "../../apps/web/src/lib/app-domain-types";

/**
 * Truth table for scope-aware solid fuel ban filtering.
 *
 * | banStatus   | banScope        | fire in camps? | fire outside camps? |
 * |-------------|-----------------|----------------|---------------------|
 * | NOT_BANNED  | ALL             | allowed        | allowed             |
 * | BANNED      | ALL             | banned         | banned              |
 * | BANNED      | OUTSIDE_CAMPS   | allowed        | banned              |
 * | BANNED      | INCLUDING_CAMPS | banned         | banned              |
 */

const check = (
  banMode: BanFilterMode,
  scopeMode: BanScopeFilterMode,
  banStatus: BanStatus,
  banScope: SolidFuelBanScope
): boolean => matchesSolidFuelBanFilter(banMode, scopeMode, banStatus, banScope);

describe("matchesSolidFuelBanFilter", () => {
  describe("primary filter ALL (ignores scope)", () => {
    it("matches everything regardless of status and scope", () => {
      expect(check("ALL", "ANYWHERE", "NOT_BANNED", "ALL")).toBe(true);
      expect(check("ALL", "ANYWHERE", "BANNED", "ALL")).toBe(true);
      expect(check("ALL", "ANYWHERE", "BANNED", "OUTSIDE_CAMPS")).toBe(true);
      expect(check("ALL", "ANYWHERE", "BANNED", "INCLUDING_CAMPS")).toBe(true);
      expect(check("ALL", "ANYWHERE", "UNKNOWN", "ALL")).toBe(true);
      expect(check("ALL", "CAMPS", "BANNED", "ALL")).toBe(true);
      expect(check("ALL", "NOT_CAMPS", "BANNED", "ALL")).toBe(true);
    });
  });

  describe("primary filter UNKNOWN", () => {
    it("matches only UNKNOWN status", () => {
      expect(check("UNKNOWN", "ANYWHERE", "UNKNOWN", "ALL")).toBe(true);
      expect(check("UNKNOWN", "ANYWHERE", "BANNED", "ALL")).toBe(false);
      expect(check("UNKNOWN", "ANYWHERE", "NOT_BANNED", "ALL")).toBe(false);
    });
  });

  describe("ANYWHERE scope (standard behaviour)", () => {
    it("NOT_BANNED matches only NOT_BANNED forests", () => {
      expect(check("NOT_BANNED", "ANYWHERE", "NOT_BANNED", "ALL")).toBe(true);
      expect(check("NOT_BANNED", "ANYWHERE", "BANNED", "ALL")).toBe(false);
      expect(check("NOT_BANNED", "ANYWHERE", "BANNED", "OUTSIDE_CAMPS")).toBe(false);
    });

    it("BANNED matches only BANNED forests", () => {
      expect(check("BANNED", "ANYWHERE", "BANNED", "ALL")).toBe(true);
      expect(check("BANNED", "ANYWHERE", "BANNED", "OUTSIDE_CAMPS")).toBe(true);
      expect(check("BANNED", "ANYWHERE", "NOT_BANNED", "ALL")).toBe(false);
    });
  });

  describe("NOT_BANNED + CAMPS (fire allowed in camps)", () => {
    it("matches NOT_BANNED with any scope (fire allowed everywhere)", () => {
      expect(check("NOT_BANNED", "CAMPS", "NOT_BANNED", "ALL")).toBe(true);
    });

    it("matches BANNED OUTSIDE_CAMPS (fire allowed in camps)", () => {
      expect(check("NOT_BANNED", "CAMPS", "BANNED", "OUTSIDE_CAMPS")).toBe(true);
    });

    it("rejects BANNED ALL (fire banned in camps too)", () => {
      expect(check("NOT_BANNED", "CAMPS", "BANNED", "ALL")).toBe(false);
    });

    it("rejects BANNED INCLUDING_CAMPS (fire banned in camps)", () => {
      expect(check("NOT_BANNED", "CAMPS", "BANNED", "INCLUDING_CAMPS")).toBe(false);
    });
  });

  describe("NOT_BANNED + NOT_CAMPS (fire allowed outside camps)", () => {
    it("matches NOT_BANNED with any scope", () => {
      expect(check("NOT_BANNED", "NOT_CAMPS", "NOT_BANNED", "ALL")).toBe(true);
    });

    it("rejects BANNED OUTSIDE_CAMPS (fire banned outside camps)", () => {
      expect(check("NOT_BANNED", "NOT_CAMPS", "BANNED", "OUTSIDE_CAMPS")).toBe(false);
    });

    it("rejects BANNED ALL (fire banned outside camps)", () => {
      expect(check("NOT_BANNED", "NOT_CAMPS", "BANNED", "ALL")).toBe(false);
    });

    it("rejects BANNED INCLUDING_CAMPS (fire banned outside camps)", () => {
      expect(check("NOT_BANNED", "NOT_CAMPS", "BANNED", "INCLUDING_CAMPS")).toBe(false);
    });
  });

  describe("BANNED + CAMPS (fire banned in camps)", () => {
    it("matches BANNED ALL (fire banned everywhere including camps)", () => {
      expect(check("BANNED", "CAMPS", "BANNED", "ALL")).toBe(true);
    });

    it("matches BANNED INCLUDING_CAMPS (fire banned in camps)", () => {
      expect(check("BANNED", "CAMPS", "BANNED", "INCLUDING_CAMPS")).toBe(true);
    });

    it("rejects BANNED OUTSIDE_CAMPS (fire allowed in camps)", () => {
      expect(check("BANNED", "CAMPS", "BANNED", "OUTSIDE_CAMPS")).toBe(false);
    });

    it("rejects NOT_BANNED (fire not banned anywhere)", () => {
      expect(check("BANNED", "CAMPS", "NOT_BANNED", "ALL")).toBe(false);
    });
  });

  describe("BANNED + NOT_CAMPS (fire banned outside camps)", () => {
    it("matches BANNED ALL (fire banned everywhere including outside)", () => {
      expect(check("BANNED", "NOT_CAMPS", "BANNED", "ALL")).toBe(true);
    });

    it("matches BANNED OUTSIDE_CAMPS (fire banned outside camps)", () => {
      expect(check("BANNED", "NOT_CAMPS", "BANNED", "OUTSIDE_CAMPS")).toBe(true);
    });

    it("matches BANNED INCLUDING_CAMPS (fire banned everywhere)", () => {
      expect(check("BANNED", "NOT_CAMPS", "BANNED", "INCLUDING_CAMPS")).toBe(true);
    });

    it("rejects NOT_BANNED (fire not banned anywhere)", () => {
      expect(check("BANNED", "NOT_CAMPS", "NOT_BANNED", "ALL")).toBe(false);
    });
  });

  describe("UNKNOWN status ignores scope", () => {
    it("UNKNOWN status only matches UNKNOWN primary filter", () => {
      expect(check("NOT_BANNED", "CAMPS", "UNKNOWN", "ALL")).toBe(false);
      expect(check("BANNED", "CAMPS", "UNKNOWN", "ALL")).toBe(false);
      expect(check("UNKNOWN", "CAMPS", "UNKNOWN", "ALL")).toBe(true);
    });
  });
});
