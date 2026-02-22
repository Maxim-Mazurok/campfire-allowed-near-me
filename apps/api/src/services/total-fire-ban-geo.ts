export type Point = {
  latitude: number;
  longitude: number;
};

export type Ring = Point[];
export type Polygon = Ring[];
export type MultiPolygon = Polygon[];

export interface GeoBounds {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

export interface TotalFireBanGeoArea {
  areaId: string;
  areaName: string;
  geometryType: "Polygon" | "MultiPolygon";
  coordinates: Polygon | MultiPolygon;
  bounds: GeoBounds;
}

export const parseCoordinatePoint = (value: unknown): Point | null => {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const longitude = value[0];
  const latitude = value[1];

  if (
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    typeof latitude !== "number" ||
    !Number.isFinite(latitude)
  ) {
    return null;
  }

  return {
    latitude,
    longitude
  };
};

export const computeBoundsForCoordinates = (
  coordinates: Polygon | MultiPolygon,
  geometryType: "Polygon" | "MultiPolygon"
): GeoBounds | null => {
  const bounds: GeoBounds = {
    minLatitude: Number.POSITIVE_INFINITY,
    maxLatitude: Number.NEGATIVE_INFINITY,
    minLongitude: Number.POSITIVE_INFINITY,
    maxLongitude: Number.NEGATIVE_INFINITY
  };

  const includePoint = (point: Point) => {
    bounds.minLatitude = Math.min(bounds.minLatitude, point.latitude);
    bounds.maxLatitude = Math.max(bounds.maxLatitude, point.latitude);
    bounds.minLongitude = Math.min(bounds.minLongitude, point.longitude);
    bounds.maxLongitude = Math.max(bounds.maxLongitude, point.longitude);
  };

  if (geometryType === "Polygon") {
    for (const ring of coordinates as Polygon) {
      for (const point of ring) {
        includePoint(point);
      }
    }
  } else {
    for (const polygon of coordinates as MultiPolygon) {
      for (const ring of polygon) {
        for (const point of ring) {
          includePoint(point);
        }
      }
    }
  }

  if (
    !Number.isFinite(bounds.minLatitude) ||
    !Number.isFinite(bounds.maxLatitude) ||
    !Number.isFinite(bounds.minLongitude) ||
    !Number.isFinite(bounds.maxLongitude)
  ) {
    return null;
  }

  return bounds;
};

export const parsePolygon = (value: unknown): Polygon | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const polygon: Polygon = [];

  for (const rawRing of value) {
    if (!Array.isArray(rawRing)) {
      continue;
    }

    const ring: Ring = rawRing
      .map((entry) => parseCoordinatePoint(entry))
      .filter((entry): entry is Point => entry !== null);

    if (ring.length < 4) {
      continue;
    }

    polygon.push(ring);
  }

  return polygon.length ? polygon : null;
};

export const parseMultiPolygon = (value: unknown): MultiPolygon | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const multipolygon: MultiPolygon = [];

  for (const rawPolygon of value) {
    const polygon = parsePolygon(rawPolygon);
    if (!polygon) {
      continue;
    }

    multipolygon.push(polygon);
  }

  return multipolygon.length ? multipolygon : null;
};

const isPointOnSegment = (point: Point, start: Point, end: Point): boolean => {
  const crossProduct =
    (point.latitude - start.latitude) * (end.longitude - start.longitude) -
    (point.longitude - start.longitude) * (end.latitude - start.latitude);

  if (Math.abs(crossProduct) > 1e-12) {
    return false;
  }

  const dotProduct =
    (point.longitude - start.longitude) * (end.longitude - start.longitude) +
    (point.latitude - start.latitude) * (end.latitude - start.latitude);

  if (dotProduct < 0) {
    return false;
  }

  const segmentLengthSquared =
    (end.longitude - start.longitude) ** 2 +
    (end.latitude - start.latitude) ** 2;

  if (dotProduct > segmentLengthSquared) {
    return false;
  }

  return true;
};

const isPointInRing = (point: Point, ring: Ring): boolean => {
  let inside = false;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index]!;
    const previousPoint = ring[previous]!;

    if (isPointOnSegment(point, previousPoint, currentPoint)) {
      return true;
    }

    const intersects =
      (currentPoint.latitude > point.latitude) !==
        (previousPoint.latitude > point.latitude) &&
      point.longitude <
        ((previousPoint.longitude - currentPoint.longitude) *
          (point.latitude - currentPoint.latitude)) /
          (previousPoint.latitude - currentPoint.latitude) +
          currentPoint.longitude;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
};

const isPointInPolygon = (point: Point, polygon: Polygon): boolean => {
  if (!polygon.length) {
    return false;
  }

  const outerRing = polygon[0]!;
  if (!isPointInRing(point, outerRing)) {
    return false;
  }

  for (let index = 1; index < polygon.length; index += 1) {
    if (isPointInRing(point, polygon[index]!)) {
      return false;
    }
  }

  return true;
};

export const isPointInGeometry = (
  point: Point,
  geometryType: "Polygon" | "MultiPolygon",
  coordinates: Polygon | MultiPolygon
): boolean => {
  if (geometryType === "Polygon") {
    return isPointInPolygon(point, coordinates as Polygon);
  }

  return (coordinates as MultiPolygon).some((polygon) => isPointInPolygon(point, polygon));
};

export const isWithinBounds = (point: Point, bounds: GeoBounds): boolean =>
  point.latitude >= bounds.minLatitude &&
  point.latitude <= bounds.maxLatitude &&
  point.longitude >= bounds.minLongitude &&
  point.longitude <= bounds.maxLongitude;
