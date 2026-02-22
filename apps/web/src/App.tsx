import Tippy from "@tippyjs/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FacilityIcon } from "./components/FacilityIcon";
import { MapView } from "./components/MapView";
import { fetchForests, type ForestApiResponse } from "./lib/api";

type BanFilterMode = "ALL" | "ALLOWED" | "NOT_ALLOWED";
type TriStateMode = "ANY" | "INCLUDE" | "EXCLUDE";

const sortForestsByDistance = (
  left: ForestApiResponse["forests"][number],
  right: ForestApiResponse["forests"][number]
): number => {
  if (left.distanceKm === null && right.distanceKm === null) {
    return left.forestName.localeCompare(right.forestName);
  }

  if (left.distanceKm === null) {
    return 1;
  }

  if (right.distanceKm === null) {
    return -1;
  }

  return left.distanceKm - right.distanceKm;
};

export const App = () => {
  const [payload, setPayload] = useState<ForestApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banFilterMode, setBanFilterMode] = useState<BanFilterMode>("ALL");
  const [facilityFilterModes, setFacilityFilterModes] = useState<Record<string, TriStateMode>>(
    {}
  );
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const autoLocateRequestedRef = useRef(false);

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
  const availableFacilities = payload?.availableFacilities ?? [];
  const facilitySignature = availableFacilities.map((facility) => facility.key).join("|");

  useEffect(() => {
    setFacilityFilterModes((current) => {
      const next: Record<string, TriStateMode> = {};
      for (const facility of availableFacilities) {
        next[facility.key] = current[facility.key] ?? "ANY";
      }
      return next;
    });
  }, [facilitySignature, availableFacilities]);

  const setSingleFacilityMode = (key: string, mode: TriStateMode) => {
    setFacilityFilterModes((current) => ({
      ...current,
      [key]: mode
    }));
  };

  const toggleFacilityMode = (key: string, mode: Exclude<TriStateMode, "ANY">) => {
    setFacilityFilterModes((current) => ({
      ...current,
      [key]: current[key] === mode ? "ANY" : mode
    }));
  };

  const clearFacilityModes = () => {
    setFacilityFilterModes((current) =>
      Object.fromEntries(
        Object.keys(current).map((key) => [key, "ANY"])
      ) as Record<string, TriStateMode>
    );
  };

  const matchingForests = useMemo(() => {
    return forests.filter((forest) => {
      if (banFilterMode === "ALLOWED" && forest.banStatus !== "NOT_BANNED") {
        return false;
      }

      if (banFilterMode === "NOT_ALLOWED" && forest.banStatus !== "BANNED") {
        return false;
      }

      for (const facility of availableFacilities) {
        const mode = facilityFilterModes[facility.key] ?? "ANY";
        if (mode === "ANY") {
          continue;
        }

        const value = forest.facilities[facility.key];
        if (mode === "INCLUDE" && value !== true) {
          return false;
        }

        if (mode === "EXCLUDE" && value !== false) {
          return false;
        }
      }

      return true;
    });
  }, [availableFacilities, banFilterMode, facilityFilterModes, forests]);

  const matchingForestIds = useMemo(
    () => new Set(matchingForests.map((forest) => forest.id)),
    [matchingForests]
  );

  const mappableMatchingForestCount = matchingForests.filter(
    (forest) => forest.latitude !== null && forest.longitude !== null
  ).length;
  const mappableForestCount = forests.filter(
    (forest) => forest.latitude !== null && forest.longitude !== null
  ).length;
  const matchDiagnostics = payload?.matchDiagnostics ?? {
    unmatchedFacilitiesForests: [],
    fuzzyMatches: []
  };
  const baseWarnings = (payload?.warnings ?? []).filter(
    (warning) => !/Facilities data could not be matched for/i.test(warning)
  );
  const warningLines = [...baseWarnings];

  if (
    matchDiagnostics.unmatchedFacilitiesForests.length > 0 &&
    !warningLines.some((warning) => /not present on the Solid Fuel Fire Ban pages/i.test(warning))
  ) {
    warningLines.push(
      `Facilities page includes ${matchDiagnostics.unmatchedFacilitiesForests.length} forest(s) not present on the Solid Fuel Fire Ban pages.`
    );
  }

  if (
    matchDiagnostics.fuzzyMatches.length > 0 &&
    !warningLines.some((warning) => /Applied fuzzy facilities matching/i.test(warning))
  ) {
    warningLines.push(
      `Applied fuzzy facilities matching for ${matchDiagnostics.fuzzyMatches.length} forest name(s) with minor naming differences.`
    );
  }

  const requestLocation = (options?: { silent?: boolean }) => {
    if (!navigator.geolocation) {
      if (!options?.silent) {
        setError("Geolocation is not supported by this browser.");
      }
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
        if (!options?.silent) {
          setError(`Unable to read your location: ${geoError.message}`);
        }
      }
    );
  };

  useEffect(() => {
    if (autoLocateRequestedRef.current) {
      return;
    }

    autoLocateRequestedRef.current = true;
    requestLocation({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="app-shell">
      <header className="panel header">
        <h1>Campfire Allowed Near Me</h1>
        <p>
          NSW forestry checker for solid fuel fire bans. Data source: Forestry
          Corporation NSW.
        </p>

        <div className="controls">
          <button type="button" onClick={() => requestLocation()} data-testid="locate-btn">
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

      {warningLines.length ? (
        <section className="panel warning" data-testid="warning-banner">
          <ul className="warning-list">
            {warningLines.map((warning) => (
              <li key={warning}>
                {warning}
                {/Applied fuzzy facilities matching/i.test(warning) &&
                matchDiagnostics.fuzzyMatches.length > 0 ? (
                  <Tippy
                    interactive
                    maxWidth={540}
                    content={
                      <div className="warning-popover">
                        <strong>Fuzzy Match Details</strong>
                        <ul className="warning-popover-list">
                          {matchDiagnostics.fuzzyMatches.map((match) => (
                            <li key={`${match.facilitiesForestName}:${match.fireBanForestName}`}>
                              Facilities: <strong>{match.facilitiesForestName}</strong> {"->"} Fire ban:{" "}
                              <strong>{match.fireBanForestName}</strong> ({match.score.toFixed(2)})
                            </li>
                          ))}
                        </ul>
                      </div>
                    }
                    delay={[0, 0]}
                    duration={[0, 0]}
                    placement="bottom-start"
                  >
                    <button type="button" className="inline-popover-btn">
                      details
                    </button>
                  </Tippy>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="layout">
        <aside className="panel filter-panel">
          <h2>Filters</h2>
          <p className="meta">
            Matching {matchingForests.length} of {forests.length} forests.
          </p>
          <div className="filter-panel-scroll">
            <section className="filter-section">
              <h3>Fire Ban</h3>
              <div className="tri-toggle-group">
                <button
                  type="button"
                  className={banFilterMode === "ALL" ? "is-active" : ""}
                  onClick={() => setBanFilterMode("ALL")}
                  data-testid="ban-filter-all"
                >
                  All
                </button>
                <button
                  type="button"
                  className={banFilterMode === "ALLOWED" ? "is-active" : ""}
                  onClick={() => setBanFilterMode("ALLOWED")}
                  data-testid="ban-filter-allowed"
                >
                  Allowed
                </button>
                <button
                  type="button"
                  className={banFilterMode === "NOT_ALLOWED" ? "is-active" : ""}
                  onClick={() => setBanFilterMode("NOT_ALLOWED")}
                  data-testid="ban-filter-not-allowed"
                >
                  Not allowed
                </button>
              </div>
            </section>

            <section className="filter-section">
              <div className="filter-section-header">
                <h3>Facilities</h3>
                <button type="button" className="text-btn" onClick={clearFacilityModes}>
                  Clear
                </button>
              </div>
              {availableFacilities.length ? (
                <ul className="facility-filter-list" data-testid="facility-filter-list">
                  {availableFacilities.map((facility) => {
                    const mode = facilityFilterModes[facility.key] ?? "ANY";
                    return (
                      <li key={facility.key} className="facility-filter-row">
                        <span className="facility-filter-label">
                          <FacilityIcon facility={facility} />
                          <span>{facility.label}</span>
                        </span>
                        <span className="tri-toggle" role="group" aria-label={`${facility.label} filter`}>
                          <button
                            type="button"
                            className={mode === "INCLUDE" ? "is-active include" : ""}
                            onClick={() => toggleFacilityMode(facility.key, "INCLUDE")}
                            aria-label={`Only show forests with ${facility.label.toLowerCase()}`}
                            data-testid={`facility-filter-${facility.key}-include`}
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            className={mode === "EXCLUDE" ? "is-active exclude" : ""}
                            onClick={() => toggleFacilityMode(facility.key, "EXCLUDE")}
                            aria-label={`Only show forests without ${facility.label.toLowerCase()}`}
                            data-testid={`facility-filter-${facility.key}-exclude`}
                          >
                            ✕
                          </button>
                          <button
                            type="button"
                            className={mode === "ANY" ? "is-active neutral" : ""}
                            onClick={() => setSingleFacilityMode(facility.key, "ANY")}
                            aria-label={`${facility.label} does not matter`}
                            data-testid={`facility-filter-${facility.key}-any`}
                          >
                            ?
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="muted">Facilities data is unavailable right now.</p>
              )}
            </section>
          </div>
        </aside>

        <section className="panel map-panel">
          <p className="meta map-meta" data-testid="mapped-count">
            Showing {mappableMatchingForestCount} matching mapped forests out of{" "}
            {mappableForestCount} mapped forests.
          </p>
          {loading ? <p>Loading forests...</p> : null}
          {error ? <p className="error">{error}</p> : null}
          {!loading && !error && mappableMatchingForestCount === 0 ? (
            <p className="warning-inline">
              No mapped forests match your current filters.
            </p>
          ) : null}
          {!loading && !error ? (
            <MapView
              forests={forests}
              matchedForestIds={matchingForestIds}
              userLocation={userLocation}
            />
          ) : null}
        </section>

        <aside className="panel list-panel">
          <h2>Forests ({matchingForests.length})</h2>
          <p className="meta">
            Last fetched: {payload ? new Date(payload.fetchedAt).toLocaleString() : "-"}
            {payload?.stale ? " (stale cache)" : ""}
          </p>

          <ul className="forest-list" data-testid="forest-list">
            {matchingForests
              .slice()
              .sort(sortForestsByDistance)
              .map((forest) => (
                <li key={forest.id} className="forest-row" data-testid="forest-row">
                  <div className="forest-main-row">
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
                  </div>
                  {availableFacilities.length ? (
                    <div className="facility-row" data-testid="facility-row">
                      {availableFacilities.map((facility) => {
                        const value = forest.facilities[facility.key];
                        const stateClass =
                          value === true ? "present" : value === false ? "absent" : "unknown";

                        const statusText =
                          value === true ? "Yes" : value === false ? "No" : "Unknown";

                        return (
                          <Tippy
                            key={`${forest.id}:${facility.key}`}
                            content={`${facility.label}: ${statusText}`}
                            delay={[0, 0]}
                            duration={[0, 0]}
                            placement="top"
                          >
                            <span className={`facility-indicator ${stateClass}`}>
                              <FacilityIcon facility={facility} />
                            </span>
                          </Tippy>
                        );
                      })}
                    </div>
                  ) : null}
                </li>
              ))}
          </ul>
        </aside>
      </section>
    </main>
  );
};
