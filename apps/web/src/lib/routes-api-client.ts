export interface RouteResult {
  distanceKm: number;
  durationMinutes: number;
}

export interface RoutesApiResponse {
  routes: Record<string, RouteResult>;
  warnings: string[];
}

export interface RoutesApiRequest {
  origin: { latitude: number; longitude: number };
  forestIds: string[];
  avoidTolls?: boolean;
}

const ROUTES_API_URL =
  import.meta.env.VITE_ROUTES_API_URL ?? "/api/routes";

export const fetchDrivingRoutes = async (
  request: RoutesApiRequest,
  signal?: AbortSignal
): Promise<RoutesApiResponse> => {
  const response = await fetch(ROUTES_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Routes API error (HTTP ${response.status}): ${body || response.statusText}`
    );
  }

  return (await response.json()) as RoutesApiResponse;
};
