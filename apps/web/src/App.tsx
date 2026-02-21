import { useEffect, useMemo, useState } from "react";
import { MapView } from "./components/MapView";
import { fetchForests, type ForestApiResponse } from "./lib/api";

type FilterMode = "ALL" | "ONLY_BANNED" | "ONLY_ALLOWED";

export const App = () => {
  const [payload, setPayload] = useState<ForestApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>("ALL");
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  const loadData = async (options?: {
    location?: { latitude: number; longitude: number };
    refresh?: boolean;
  }) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchForests(options?.location ?? userLocation ?? undefined, options?.refresh ?? false);
      setPayload(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unknown load error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const forests = payload?.forests ?? [];

  const filteredForests = useMemo(() => {
    if (filterMode === "ONLY_BANNED") {
      return forests.filter((forest) => forest.banStatus === "BANNED");
    }

    if (filterMode === "ONLY_ALLOWED") {
      return forests.filter((forest) => forest.banStatus === "NOT_BANNED");
    }

    return forests;
  }, [filterMode, forests]);
  const mappableForestCount = filteredForests.filter(
    (forest) => forest.latitude !== null && forest.longitude !== null
  ).length;

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by this browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };

        setUserLocation(location);
        void loadData({ location });
      },
      (geoError) => {
        setError(`Unable to read your location: ${geoError.message}`);
      }
    );
  };

  return (
    <main className="app-shell">
      <header className="panel header">
        <h1>Campfire Allowed Near Me</h1>
        <p>
          NSW forestry checker for solid fuel fire bans. Data source: Forestry
          Corporation NSW.
        </p>

        <div className="controls">
          <label htmlFor="filterMode">Filter</label>
          <select
            id="filterMode"
            value={filterMode}
            onChange={(event) => setFilterMode(event.target.value as FilterMode)}
            data-testid="filter-select"
          >
            <option value="ALL">Show all forests</option>
            <option value="ONLY_BANNED">Only banned</option>
            <option value="ONLY_ALLOWED">Only allowed</option>
          </select>

          <button type="button" onClick={requestLocation} data-testid="locate-btn">
            Use my current location
          </button>
          <button type="button" onClick={() => void loadData({ refresh: true })}>
            Refresh from source
          </button>
        </div>
      </header>

      {payload?.nearestLegalSpot ? (
        <section className="panel nearest" data-testid="nearest-spot">
          Closest legal campfire spot: <strong>{payload.nearestLegalSpot.forestName}</strong> in{" "}
          {payload.nearestLegalSpot.areaName} ({payload.nearestLegalSpot.distanceKm.toFixed(1)} km)
        </section>
      ) : null}
      {!loading && userLocation && payload && !payload.nearestLegalSpot ? (
        <section className="panel warning" data-testid="nearest-empty">
          No legal campfire spot could be determined from currently mapped forests.
        </section>
      ) : null}

      {payload?.warnings.length ? (
        <section className="panel warning" data-testid="warning-banner">
          {payload.warnings.join(" ")}
        </section>
      ) : null}

      <section className="layout">
        <section className="panel map-panel">
          <p className="meta map-meta" data-testid="mapped-count">
            Showing {mappableForestCount} mapped forests out of {filteredForests.length}.
          </p>
          {loading ? <p>Loading forests...</p> : null}
          {error ? <p className="error">{error}</p> : null}
          {!loading && !error && mappableForestCount === 0 ? (
            <p className="warning-inline">
              Forests are loaded, but map coordinates are unavailable right now.
              This can happen temporarily due to geocoding limits.
            </p>
          ) : null}
          {!loading && !error ? (
            <MapView forests={filteredForests} userLocation={userLocation} />
          ) : null}
        </section>

        <aside className="panel list-panel">
          <h2>Forests ({filteredForests.length})</h2>
          <p className="meta">
            Last fetched: {payload ? new Date(payload.fetchedAt).toLocaleString() : "-"}
            {payload?.stale ? " (stale cache)" : ""}
          </p>

          <ul className="forest-list" data-testid="forest-list">
            {filteredForests
              .slice()
              .sort((a, b) => {
                if (a.distanceKm === null && b.distanceKm === null) {
                  return a.forestName.localeCompare(b.forestName);
                }

                if (a.distanceKm === null) {
                  return 1;
                }

                if (b.distanceKm === null) {
                  return -1;
                }

                return a.distanceKm - b.distanceKm;
              })
              .map((forest) => (
                <li key={forest.id} className="forest-row" data-testid="forest-row">
                  <div>
                    <strong>{forest.forestName}</strong>
                    <div className="muted">{forest.areaName}</div>
                  </div>
                  <div className="status-block">
                    <span
                      className={`status-pill ${forest.banStatus === "NOT_BANNED" ? "allowed" : forest.banStatus === "BANNED" ? "banned" : "unknown"}`}
                    >
                      {forest.banStatus === "NOT_BANNED"
                        ? "No ban"
                        : forest.banStatus === "BANNED"
                          ? "Banned"
                          : "Unknown"}
                    </span>
                    <small className="muted" data-testid="distance-text">
                      {forest.distanceKm !== null
                        ? `${forest.distanceKm.toFixed(1)} km`
                        : "Distance unavailable"}
                    </small>
                  </div>
                </li>
              ))}
          </ul>
        </aside>
      </section>
    </main>
  );
};
