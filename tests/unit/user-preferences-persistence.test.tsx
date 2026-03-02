// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  readUserPreferences,
  writeUserPreferences
} from "../../web/src/lib/app-domain-preferences";

const STORAGE_KEY = "campfire-user-preferences";

/**
 * Node 22 provides a non-functional built-in `localStorage` global that
 * shadows jsdom's proper implementation. Polyfill a working in-memory
 * Storage on `window` so the read/write helpers work in tests.
 */
beforeAll(() => {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() { return store.size; },
    clear() { store.clear(); },
    getItem(key: string) { return store.get(key) ?? null; },
    key(index: number) { return [...store.keys()][index] ?? null; },
    removeItem(key: string) { store.delete(key); },
    setItem(key: string, value: string) { store.set(key, value); }
  };
  Object.defineProperty(window, "localStorage", { value: storage, writable: true });
});

afterEach(() => {
  window.localStorage.removeItem(STORAGE_KEY);
});

describe("user preferences persistence", () => {
  describe("locationSource", () => {
    it("persists and restores MAP_PIN locationSource", () => {
      const location = { latitude: -33.5, longitude: 151.0 };
      writeUserPreferences({
        userLocation: location,
        locationSource: "MAP_PIN"
      });

      const restored = readUserPreferences();
      expect(restored.locationSource).toBe("MAP_PIN");
      expect(restored.userLocation).toEqual(location);
    });

    it("persists and restores GEOLOCATION locationSource", () => {
      const location = { latitude: -33.8, longitude: 151.2 };
      writeUserPreferences({
        userLocation: location,
        locationSource: "GEOLOCATION"
      });

      const restored = readUserPreferences();
      expect(restored.locationSource).toBe("GEOLOCATION");
    });

    it("persists and restores DEFAULT_SYDNEY locationSource", () => {
      writeUserPreferences({
        userLocation: null,
        locationSource: "DEFAULT_SYDNEY"
      });

      const restored = readUserPreferences();
      expect(restored.locationSource).toBe("DEFAULT_SYDNEY");
    });

    it("returns undefined locationSource when not stored", () => {
      writeUserPreferences({ userLocation: null });

      const restored = readUserPreferences();
      expect(restored.locationSource).toBeUndefined();
    });

    it("ignores invalid locationSource values", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ locationSource: "INVALID_SOURCE" })
      );

      const restored = readUserPreferences();
      expect(restored.locationSource).toBeUndefined();
    });
  });

  describe("forestListSortOption", () => {
    it("persists and restores DIRECT_DISTANCE_ASC", () => {
      writeUserPreferences({ forestListSortOption: "DIRECT_DISTANCE_ASC" });

      const restored = readUserPreferences();
      expect(restored.forestListSortOption).toBe("DIRECT_DISTANCE_ASC");
    });

    it("persists and restores DIRECT_DISTANCE_DESC", () => {
      writeUserPreferences({ forestListSortOption: "DIRECT_DISTANCE_DESC" });

      const restored = readUserPreferences();
      expect(restored.forestListSortOption).toBe("DIRECT_DISTANCE_DESC");
    });

    it("persists and restores DRIVING_DISTANCE_ASC", () => {
      writeUserPreferences({ forestListSortOption: "DRIVING_DISTANCE_ASC" });

      const restored = readUserPreferences();
      expect(restored.forestListSortOption).toBe("DRIVING_DISTANCE_ASC");
    });

    it("persists and restores DRIVING_TIME_DESC", () => {
      writeUserPreferences({ forestListSortOption: "DRIVING_TIME_DESC" });

      const restored = readUserPreferences();
      expect(restored.forestListSortOption).toBe("DRIVING_TIME_DESC");
    });

    it("ignores invalid sort option values", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ forestListSortOption: "INVALID_SORT" })
      );

      const restored = readUserPreferences();
      expect(restored.forestListSortOption).toBeUndefined();
    });
  });
});
