import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

/**
 * Tests for the routes-proxy Worker handler.
 *
 * We import the Worker's default export and call its fetch() directly,
 * mocking the global fetch() to intercept Google Routes API calls.
 */

// Mock the global fetch before importing the worker module
const originalFetch = globalThis.fetch;
let mockFetch: Mock;

beforeEach(() => {
  mockFetch = vi.fn();
  globalThis.fetch = mockFetch;
});

// Restore after all tests
import { afterAll } from "vitest";
afterAll(() => {
  globalThis.fetch = originalFetch;
});

// Import the worker handler (default export)
type WorkerHandler = { fetch: (request: Request, environment: { GOOGLE_MAPS_API_KEY: string }) => Promise<Response> };
let worker: WorkerHandler;

beforeEach(async () => {
  // The worker uses `export default { fetch }` which vitest puts on .default
  const module = await import("../../workers/routes-proxy/src/index.js");
  worker = (module.default ?? module) as WorkerHandler;
});

const TEST_ENVIRONMENT = {
  GOOGLE_MAPS_API_KEY: "test-api-key"
};

const VALID_ORIGIN = { latitude: -33.8688, longitude: 151.2093 };

const VALID_DESTINATIONS = [
  { id: "forest-1", latitude: -33.3, longitude: 151.3 },
  { id: "forest-2", latitude: -34.0, longitude: 150.5 }
];

const makeRequest = (
  method: string,
  path: string,
  body?: unknown
): Request => {
  const url = `https://worker.test${path}`;
  const options: RequestInit = { method };
  if (body !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  return new Request(url, options);
};

const parseJsonResponse = async (
  response: Response
): Promise<unknown> => {
  return JSON.parse(await response.text());
};

describe("routes-proxy Worker handler", () => {
  describe("CORS", () => {
    it("returns 204 with CORS headers for OPTIONS request", async () => {
      const request = makeRequest("OPTIONS", "/api/routes");
      const response = await worker.fetch(request, TEST_ENVIRONMENT);

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
      expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
    });

    it("includes CORS headers in error responses", async () => {
      const request = makeRequest("GET", "/api/routes");
      const response = await worker.fetch(request, TEST_ENVIRONMENT);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("includes CORS headers in success responses", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify([
          { originIndex: 0, destinationIndex: 0, distanceMeters: 50_000, duration: "3600s" }
        ]))
      );

      const request = makeRequest("POST", "/api/routes", {
        origin: VALID_ORIGIN,
        destinations: [VALID_DESTINATIONS[0]]
      });
      const response = await worker.fetch(request, TEST_ENVIRONMENT);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  describe("routing", () => {
    it("returns 404 for unknown paths", async () => {
      const request = makeRequest("POST", "/unknown");
      const response = await worker.fetch(request, TEST_ENVIRONMENT);

      expect(response.status).toBe(404);
      const body = await parseJsonResponse(response);
      expect(body).toEqual({ error: "Not found" });
    });

    it("returns 404 for GET to /api/routes", async () => {
      const request = makeRequest("GET", "/api/routes");
      const response = await worker.fetch(request, TEST_ENVIRONMENT);

      expect(response.status).toBe(404);
    });
  });

  describe("request validation", () => {
    it("rejects invalid JSON body", async () => {
      const request = new Request("https://worker.test/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json"
      });
      const response = await worker.fetch(request, TEST_ENVIRONMENT);

      expect(response.status).toBe(400);
      const body = await parseJsonResponse(response);
      expect(body).toEqual({ error: "Invalid JSON body" });
    });

    it("rejects missing origin", async () => {
      const request = makeRequest("POST", "/api/routes", {
        destinations: VALID_DESTINATIONS
      });
      const response = await worker.fetch(request, TEST_ENVIRONMENT);

      expect(response.status).toBe(400);
      const body = await parseJsonResponse(response);
      expect(body).toEqual({ error: "Missing or invalid origin coordinates" });
    });

    it("rejects origin with non-numeric latitude", async () => {
      const request = makeRequest("POST", "/api/routes", {
        origin: { latitude: "bad", longitude: 151.0 },
        destinations: VALID_DESTINATIONS
      });
      const response = await worker.fetch(request, TEST_ENVIRONMENT);

      expect(response.status).toBe(400);
      const body = await parseJsonResponse(response);
      expect(body).toEqual({ error: "Missing or invalid origin coordinates" });
    });

    it("rejects empty destinations array", async () => {
      const request = makeRequest("POST", "/api/routes", {
        origin: VALID_ORIGIN,
        destinations: []
      });
      const response = await worker.fetch(request, TEST_ENVIRONMENT);

      expect(response.status).toBe(400);
      const body = await parseJsonResponse(response);
      expect(body).toEqual({ error: "destinations must be a non-empty array" });
    });

    it("rejects missing destinations field", async () => {
      const request = makeRequest("POST", "/api/routes", {
        origin: VALID_ORIGIN
      });
      const response = await worker.fetch(request, TEST_ENVIRONMENT);

      expect(response.status).toBe(400);
      const body = await parseJsonResponse(response);
      expect(body).toEqual({ error: "destinations must be a non-empty array" });
    });

    it("rejects more than 25 destinations", async () => {
      const tooManyDestinations = Array.from({ length: 26 }, (_, index) => ({
        id: `forest-${index}`,
        latitude: -33.0 + index * 0.1,
        longitude: 151.0
      }));

      const request = makeRequest("POST", "/api/routes", {
        origin: VALID_ORIGIN,
        destinations: tooManyDestinations
      });
      const response = await worker.fetch(request, TEST_ENVIRONMENT);

      expect(response.status).toBe(400);
      const body = await parseJsonResponse(response);
      expect(body).toEqual({ error: "Maximum 25 destinations per request" });
    });

    it("rejects destination missing id", async () => {
      const request = makeRequest("POST", "/api/routes", {
        origin: VALID_ORIGIN,
        destinations: [{ latitude: -33.3, longitude: 151.3 }]
      });
      const response = await worker.fetch(request, TEST_ENVIRONMENT);

      expect(response.status).toBe(400);
      const body = await parseJsonResponse(response);
      expect(body).toEqual({
        error: "Each destination must have id, latitude, and longitude"
      });
    });

    it("rejects destination with non-numeric latitude", async () => {
      const request = makeRequest("POST", "/api/routes", {
        origin: VALID_ORIGIN,
        destinations: [{ id: "forest-1", latitude: "bad", longitude: 151.3 }]
      });
      const response = await worker.fetch(request, TEST_ENVIRONMENT);

      expect(response.status).toBe(400);
      const body = await parseJsonResponse(response);
      expect(body).toEqual({
        error: "Each destination must have id, latitude, and longitude"
      });
    });

    it("accepts exactly 25 destinations", async () => {
      const maxDestinations = Array.from({ length: 25 }, (_, index) => ({
        id: `forest-${index}`,
        latitude: -33.0 + index * 0.1,
        longitude: 151.0
      }));

      const mockMatrixResponse = maxDestinations.map((_, index) => ({
        originIndex: 0,
        destinationIndex: index,
        distanceMeters: 10_000 * (index + 1),
        duration: `${600 * (index + 1)}s`
      }));

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockMatrixResponse))
      );

      const request = makeRequest("POST", "/api/routes", {
        origin: VALID_ORIGIN,
        destinations: maxDestinations
      });
      const response = await worker.fetch(request, TEST_ENVIRONMENT);

      expect(response.status).toBe(200);
    });
  });

  describe("successful route computation", () => {
    it("returns routes for valid request", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify([
          {
            originIndex: 0,
            destinationIndex: 0,
            distanceMeters: 65_000,
            duration: "3600s"
          },
          {
            originIndex: 0,
            destinationIndex: 1,
            distanceMeters: 120_000,
            duration: "5400.5s"
          }
        ]))
      );

      const request = makeRequest("POST", "/api/routes", {
        origin: VALID_ORIGIN,
        destinations: VALID_DESTINATIONS
      });
      const response = await worker.fetch(request, TEST_ENVIRONMENT);

      expect(response.status).toBe(200);
      const body = await parseJsonResponse(response) as {
        routes: Record<string, { distanceKm: number; durationMinutes: number }>;
        warnings: string[];
      };

      expect(body.routes["forest-1"]).toEqual({
        distanceKm: 65,
        durationMinutes: 60
      });
      expect(body.routes["forest-2"]).toEqual({
        distanceKm: 120,
        durationMinutes: 90.00833333333334
      });
      expect(body.warnings).toEqual([]);
    });

    it("defaults avoidTolls to true", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify([
          { originIndex: 0, destinationIndex: 0, distanceMeters: 50_000, duration: "3000s" }
        ]))
      );

      const request = makeRequest("POST", "/api/routes", {
        origin: VALID_ORIGIN,
        destinations: [VALID_DESTINATIONS[0]]
      });
      await worker.fetch(request, TEST_ENVIRONMENT);

      const googleApiCall = mockFetch.mock.calls[0];
      const googleRequestBody = JSON.parse(googleApiCall[1].body as string);
      expect(googleRequestBody.origins[0].routeModifiers.avoidTolls).toBe(true);
    });

    it("passes avoidTolls=false when specified", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify([
          { originIndex: 0, destinationIndex: 0, distanceMeters: 50_000, duration: "3000s" }
        ]))
      );

      const request = makeRequest("POST", "/api/routes", {
        origin: VALID_ORIGIN,
        destinations: [VALID_DESTINATIONS[0]],
        avoidTolls: false
      });
      await worker.fetch(request, TEST_ENVIRONMENT);

      const googleApiCall = mockFetch.mock.calls[0];
      const googleRequestBody = JSON.parse(googleApiCall[1].body as string);
      expect(googleRequestBody.origins[0].routeModifiers.avoidTolls).toBe(false);
    });

    it("sends correct destination coordinates to Google Routes API", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify([
          { originIndex: 0, destinationIndex: 0, distanceMeters: 50_000, duration: "3000s" }
        ]))
      );

      const request = makeRequest("POST", "/api/routes", {
        origin: VALID_ORIGIN,
        destinations: [{ id: "forest-test", latitude: -33.5, longitude: 151.0 }]
      });
      await worker.fetch(request, TEST_ENVIRONMENT);

      const googleApiCall = mockFetch.mock.calls[0];
      const googleRequestBody = JSON.parse(googleApiCall[1].body as string);
      expect(googleRequestBody.destinations[0].waypoint.location.latLng).toEqual({
        latitude: -33.5,
        longitude: 151.0
      });
    });
  });

  describe("route warnings", () => {
    it("adds warning for ROUTE_NOT_FOUND condition", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify([
          {
            originIndex: 0,
            destinationIndex: 0,
            condition: "ROUTE_NOT_FOUND"
          }
        ]))
      );

      const request = makeRequest("POST", "/api/routes", {
        origin: VALID_ORIGIN,
        destinations: [VALID_DESTINATIONS[0]]
      });
      const response = await worker.fetch(request, TEST_ENVIRONMENT);
      const body = await parseJsonResponse(response) as {
        routes: Record<string, unknown>;
        warnings: string[];
      };

      expect(body.routes).toEqual({});
      expect(body.warnings).toEqual(["No route found for forest forest-1"]);
    });

    it("adds warning when distanceMeters is missing", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify([
          {
            originIndex: 0,
            destinationIndex: 0,
            duration: "3000s"
            // no distanceMeters
          }
        ]))
      );

      const request = makeRequest("POST", "/api/routes", {
        origin: VALID_ORIGIN,
        destinations: [VALID_DESTINATIONS[0]]
      });
      const response = await worker.fetch(request, TEST_ENVIRONMENT);
      const body = await parseJsonResponse(response) as {
        routes: Record<string, unknown>;
        warnings: string[];
      };

      expect(body.routes).toEqual({});
      expect(body.warnings).toHaveLength(1);
      expect(body.warnings[0]).toContain("forest-1");
    });
  });

  describe("Google Routes API error handling", () => {
    it("returns 500 when Google API returns an error", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response("API quota exceeded", { status: 429 })
      );

      const request = makeRequest("POST", "/api/routes", {
        origin: VALID_ORIGIN,
        destinations: [VALID_DESTINATIONS[0]]
      });
      const response = await worker.fetch(request, TEST_ENVIRONMENT);

      expect(response.status).toBe(500);
      const body = await parseJsonResponse(response) as { error: string };
      expect(body.error).toContain("Google Routes API error");
      expect(body.error).toContain("429");
    });
  });
});
