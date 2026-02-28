/**
 * REST transport bridge for `@googlemaps/routing` proto types.
 *
 * The SDK types model the protobuf wire format, but we call the REST API
 * directly via `fetch()` (the SDK's runtime client depends on protobufjs
 * which uses `new Function()` — blocked by Cloudflare Workers).
 *
 * This module:
 *  - Re-exports SDK proto types that are REST-compatible as-is (request types).
 *  - Provides a REST-specific response type that overrides `duration` fields
 *    (proto: `{ seconds, nanos }` → REST: string like `"1234s"`).
 *  - Contains the API URL and header builder.
 */

import type { protos } from "@googlemaps/routing";

// ---------------------------------------------------------------------------
// Request types (proto shape == REST JSON shape for these)
// ---------------------------------------------------------------------------

export type ComputeRouteMatrixRequest =
  protos.google.maps.routing.v2.IComputeRouteMatrixRequest;
export type RouteMatrixOrigin =
  protos.google.maps.routing.v2.IRouteMatrixOrigin;
export type RouteMatrixDestination =
  protos.google.maps.routing.v2.IRouteMatrixDestination;
export type RouteModifiers = protos.google.maps.routing.v2.IRouteModifiers;
export type Waypoint = protos.google.maps.routing.v2.IWaypoint;
export type Location = protos.google.maps.routing.v2.ILocation;

// ---------------------------------------------------------------------------
// Response types (REST overrides)
// ---------------------------------------------------------------------------

/**
 * REST representation of a route matrix element.
 *
 * Identical to the proto `IRouteMatrixElement` except:
 *  - `duration` and `staticDuration` are REST duration strings (`"1234s"`)
 *    instead of proto `IDuration` objects (`{ seconds, nanos }`).
 *  - `condition` arrives as a string enum name (e.g. `"ROUTE_NOT_FOUND"`),
 *    which matches `keyof typeof RouteMatrixElementCondition`.
 */
export type RouteMatrixElement = Omit<
  protos.google.maps.routing.v2.IRouteMatrixElement,
  "duration" | "staticDuration"
> & {
  /** Duration string in `"<seconds>s"` format (e.g. `"1234.5s"`). */
  duration?: string;
  /** Static (no-traffic) duration in `"<seconds>s"` format. */
  staticDuration?: string;
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export const ROUTES_API_URL =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

/**
 * Build the headers required for a Routes REST API call.
 *
 * `X-Goog-Api-Key` authenticates with a Maps Platform API key.
 * `X-Goog-FieldMask` controls which response fields are returned (and billed).
 */
export const buildRoutesApiHeaders = (
  apiKey: string,
  fieldMask: string
): Record<string, string> => ({
  "Content-Type": "application/json",
  "X-Goog-Api-Key": apiKey,
  "X-Goog-FieldMask": fieldMask
});
