import { faCrosshairs } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Tippy from "@tippyjs/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FacilityIcon } from "./components/FacilityIcon";
import { MapView } from "./components/MapView";
import type { ForestApiResponse } from "./lib/api";
import {
  buildForestsQueryKey,
  forestsQueryFn,
  toLoadErrorMessage,
  type UserLocation
} from "./lib/forests-query";

type BanFilterMode = "ALL" | "ALLOWED" | "NOT_ALLOWED";
type TriStateMode = "ANY" | "INCLUDE" | "EXCLUDE";
type FireBanForestSortColumn = "forestName" | "areaName";
type SortDirection = "asc" | "desc";
type UserPreferences = {
  banFilterMode?: BanFilterMode;
  facilityFilterModes?: Record<string, TriStateMode>;
  userLocation?: UserLocation | null;
};

const FIRE_BAN_SOURCE_URL =
  "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans";
const FACILITIES_SOURCE_URL = "https://www.forestrycorporation.com.au/visit/forests";
const USER_PREFERENCES_STORAGE_KEY = "campfire-user-preferences";
const ALPHABETICAL_COLLATOR = new Intl.Collator("en-AU", {
  sensitivity: "base",
  numeric: true
});

const isHttpUrl = (value?: string | null): value is string =>
  typeof value === "string" && /^https?:\/\//i.test(value);

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

const FORESTRY_BASE_URL = "https://www.forestrycorporation.com.au";

const slugifyPathSegment = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-");

const buildFacilitiesForestUrl = (forestName: string): string =>
  `${FORESTRY_BASE_URL}/visit/forests/${slugifyPathSegment(forestName)}`;

const normalizeForestName = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");

const buildTextHighlightUrl = (baseUrl: string, textToHighlight: string): string => {
  const normalizedTextToHighlight = textToHighlight.trim();
  if (!normalizedTextToHighlight) {
    return baseUrl;
  }

  const encodedTextToHighlight = encodeURIComponent(normalizedTextToHighlight);
  if (baseUrl.includes(":~:text=")) {
    return baseUrl;
  }

  if (baseUrl.includes("#")) {
    return `${baseUrl}:~:text=${encodedTextToHighlight}`;
  }

  return `${baseUrl}#:~:text=${encodedTextToHighlight}`;
};

const renderFacilitiesMismatchWarningSummary = (summaryText: string) => {
  const facilitiesPageLabel = "Facilities page";
  const fireBanPagesLabel = "Solid Fuel Fire Ban pages";
  const summaryPartsAfterFacilitiesPage = summaryText.split(facilitiesPageLabel);
  const beforeFacilitiesPage = summaryPartsAfterFacilitiesPage[0];
  const afterFacilitiesPage = summaryPartsAfterFacilitiesPage[1];
  if (beforeFacilitiesPage === undefined || afterFacilitiesPage === undefined) {
    return summaryText;
  }

  const summaryPartsAfterFireBanPages = afterFacilitiesPage.split(fireBanPagesLabel);
  const betweenLinks = summaryPartsAfterFireBanPages[0];
  const afterFireBanPages = summaryPartsAfterFireBanPages[1];
  if (betweenLinks === undefined || afterFireBanPages === undefined) {
    return summaryText;
  }

  return (
    <>
      {beforeFacilitiesPage}
      <a href={FACILITIES_SOURCE_URL} target="_blank" rel="noopener noreferrer">
        {facilitiesPageLabel}
      </a>
      {betweenLinks}
      <a href={FIRE_BAN_SOURCE_URL} target="_blank" rel="noopener noreferrer">
        Solid Fuel Fire Ban
      </a>
      {" pages"}
      {afterFireBanPages}
    </>
  );
};

const isBanFilterMode = (value: unknown): value is BanFilterMode =>
  value === "ALL" || value === "ALLOWED" || value === "NOT_ALLOWED";

const isTriStateMode = (value: unknown): value is TriStateMode =>
  value === "ANY" || value === "INCLUDE" || value === "EXCLUDE";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const parseUserPreferences = (value: string | null): UserPreferences => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }

    const rawPreferences = parsed as Record<string, unknown>;
    const preferences: UserPreferences = {};

    if (isBanFilterMode(rawPreferences.banFilterMode)) {
      preferences.banFilterMode = rawPreferences.banFilterMode;
    }

    if (
      typeof rawPreferences.facilityFilterModes === "object" &&
      rawPreferences.facilityFilterModes !== null
    ) {
      const nextFacilityFilterModes: Record<string, TriStateMode> = {};
      for (const [key, mode] of Object.entries(rawPreferences.facilityFilterModes)) {
        if (isTriStateMode(mode)) {
          nextFacilityFilterModes[key] = mode;
        }
      }
      preferences.facilityFilterModes = nextFacilityFilterModes;
    }

    if (rawPreferences.userLocation === null) {
      preferences.userLocation = null;
    } else if (
      typeof rawPreferences.userLocation === "object" &&
      rawPreferences.userLocation !== null
    ) {
      const rawLocation = rawPreferences.userLocation as Record<string, unknown>;
      if (isFiniteNumber(rawLocation.latitude) && isFiniteNumber(rawLocation.longitude)) {
        preferences.userLocation = {
          latitude: rawLocation.latitude,
          longitude: rawLocation.longitude
        };
      }
    }

    return preferences;
  } catch {
    return {};
  }
};

const readUserPreferences = (): UserPreferences => {
  try {
    return parseUserPreferences(window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY));
  } catch {
    return {};
  }
};

const writeUserPreferences = (preferences: UserPreferences) => {
  try {
    window.localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    return;
  }
};

export const App = () => {
  const initialPreferencesRef = useRef<UserPreferences | null>(null);
  const getInitialPreferences = (): UserPreferences => {
    if (initialPreferencesRef.current !== null) {
      return initialPreferencesRef.current;
    }

    const preferences = readUserPreferences();
    initialPreferencesRef.current = preferences;
    return preferences;
  };

  const queryClient = useQueryClient();
  const [locationError, setLocationError] = useState<string | null>(null);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [fireBanForestTableOpen, setFireBanForestTableOpen] = useState(false);
  const [fireBanForestSortColumn, setFireBanForestSortColumn] =
    useState<FireBanForestSortColumn>("forestName");
  const [fireBanForestSortDirection, setFireBanForestSortDirection] =
    useState<SortDirection>("asc");
  const [banFilterMode, setBanFilterMode] = useState<BanFilterMode>(
    () => getInitialPreferences().banFilterMode ?? "ALL"
  );
  const [facilityFilterModes, setFacilityFilterModes] = useState<Record<string, TriStateMode>>(
    () => getInitialPreferences().facilityFilterModes ?? {}
  );
  const [userLocation, setUserLocation] = useState<UserLocation | null>(
    () => getInitialPreferences().userLocation ?? null
  );
  const forestsQueryKey = useMemo(
    () => buildForestsQueryKey(userLocation),
    [userLocation?.latitude, userLocation?.longitude]
  );
  const forestsQuery = useQuery({
    queryKey: forestsQueryKey,
    queryFn: forestsQueryFn(userLocation)
  });

  const payload = forestsQuery.data ?? null;
  const loading = forestsQuery.isFetching;
  const queryErrorMessage = toLoadErrorMessage(forestsQuery.error);
  const error = locationError ?? queryErrorMessage;

  const forests = payload?.forests ?? [];
  const availableFacilities = payload?.availableFacilities ?? [];
  const facilitySignature = availableFacilities.map((facility) => facility.key).join("|");

  useEffect(() => {
    if (!payload) {
      return;
    }

    setFacilityFilterModes((current) => {
      const next: Record<string, TriStateMode> = {};
      for (const facility of availableFacilities) {
        next[facility.key] = current[facility.key] ?? "ANY";
      }
      return next;
    });
  }, [payload, facilitySignature, availableFacilities]);

  useEffect(() => {
    writeUserPreferences({
      banFilterMode,
      facilityFilterModes,
      userLocation
    });
  }, [banFilterMode, facilityFilterModes, userLocation]);

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
  const hasFacilitiesMismatchWarning = baseWarnings.some((warning) =>
    /not present on the Solid Fuel Fire Ban pages/i.test(warning)
  );
  const hasFuzzyMatchesWarning = baseWarnings.some((warning) =>
    /Applied fuzzy facilities matching/i.test(warning)
  );
  const generalWarnings = baseWarnings.filter(
    (warning) =>
      !/not present on the Solid Fuel Fire Ban pages/i.test(warning) &&
      !/Applied fuzzy facilities matching/i.test(warning)
  );
  const facilitiesMismatchWarningText =
    matchDiagnostics.unmatchedFacilitiesForests.length > 0
      ? `Facilities page includes ${matchDiagnostics.unmatchedFacilitiesForests.length} forest(s) not present on the Solid Fuel Fire Ban pages.`
      :
          baseWarnings.find((warning) => /not present on the Solid Fuel Fire Ban pages/i.test(warning)) ??
          `Facilities page includes ${matchDiagnostics.unmatchedFacilitiesForests.length} forest(s) not present on the Solid Fuel Fire Ban pages.`;
  const facilitiesMismatchWarningSummary = facilitiesMismatchWarningText.replace(
    /(not present on the Solid Fuel Fire Ban pages)\s*:.*$/i,
    "$1."
  );
  const fuzzyMatchesWarningText =
    matchDiagnostics.fuzzyMatches.length > 0
      ? `Applied fuzzy facilities matching for ${matchDiagnostics.fuzzyMatches.length} forest name(s) with minor naming differences.`
      :
          baseWarnings.find((warning) => /Applied fuzzy facilities matching/i.test(warning)) ??
          `Applied fuzzy facilities matching for ${matchDiagnostics.fuzzyMatches.length} forest name(s) with minor naming differences.`;
  const unmappedForests = forests
    .filter((forest) => forest.latitude === null || forest.longitude === null)
    .slice()
    .sort((left, right) => left.forestName.localeCompare(right.forestName));
  const hasUnmappedForestWarning = unmappedForests.length > 0;
  const unmappedForestWarningCount = unmappedForests.length;
  const facilitiesMismatchWarningCount =
    matchDiagnostics.unmatchedFacilitiesForests.length > 0
      ? matchDiagnostics.unmatchedFacilitiesForests.length
      : hasFacilitiesMismatchWarning
        ? 1
        : 0;
  const fuzzyMatchesWarningCount =
    matchDiagnostics.fuzzyMatches.length > 0
      ? matchDiagnostics.fuzzyMatches.length
      : hasFuzzyMatchesWarning
        ? 1
        : 0;
  const warningCount =
    generalWarnings.length +
    unmappedForestWarningCount +
    facilitiesMismatchWarningCount +
    fuzzyMatchesWarningCount;
  const unmatchedFacilitiesForestNames = useMemo(
    () => new Set(matchDiagnostics.unmatchedFacilitiesForests.map(normalizeForestName)),
    [matchDiagnostics.unmatchedFacilitiesForests]
  );
  const fireBanPageForests = useMemo(
    () =>
      forests.filter(
        (forest) => !unmatchedFacilitiesForestNames.has(normalizeForestName(forest.forestName))
      ),
    [forests, unmatchedFacilitiesForestNames]
  );
  const sortedFireBanPageForests = useMemo(() => {
    const getSortValue = (
      forest: ForestApiResponse["forests"][number],
      sortColumn: FireBanForestSortColumn
    ): string => (sortColumn === "forestName" ? forest.forestName : forest.areaName);

    return [...fireBanPageForests].sort((left, right) => {
      const primaryResult = ALPHABETICAL_COLLATOR.compare(
        getSortValue(left, fireBanForestSortColumn),
        getSortValue(right, fireBanForestSortColumn)
      );
      const normalizedPrimaryResult =
        fireBanForestSortDirection === "asc" ? primaryResult : -primaryResult;

      if (normalizedPrimaryResult !== 0) {
        return normalizedPrimaryResult;
      }

      const secondaryColumn = fireBanForestSortColumn === "forestName" ? "areaName" : "forestName";
      const secondaryResult = ALPHABETICAL_COLLATOR.compare(
        getSortValue(left, secondaryColumn),
        getSortValue(right, secondaryColumn)
      );

      if (secondaryResult !== 0) {
        return secondaryResult;
      }

      return left.id.localeCompare(right.id);
    });
  }, [fireBanPageForests, fireBanForestSortColumn, fireBanForestSortDirection]);
  const fireBanAreaUrlByForestName = useMemo(() => {
    const byForestName = new Map<string, string>();
    for (const forest of forests) {
      const normalizedForestName = normalizeForestName(forest.forestName);
      if (!byForestName.has(normalizedForestName)) {
        byForestName.set(normalizedForestName, forest.areaUrl);
      }
    }
    return byForestName;
  }, [forests]);
  const getFireBanAreaUrl = (forestName: string): string =>
    buildTextHighlightUrl(
      fireBanAreaUrlByForestName.get(normalizeForestName(forestName)) ??
        `${FORESTRY_BASE_URL}/visit/solid-fuel-fire-bans`,
      forestName
    );
  const closeWarningsDialog = () => {
    setWarningsOpen(false);
    setFireBanForestTableOpen(false);
  };
  const openFireBanForestTable = () => {
    setFireBanForestTableOpen(true);
  };
  const closeFireBanForestTable = () => {
    setFireBanForestTableOpen(false);
  };
  const toggleFireBanForestSort = (column: FireBanForestSortColumn) => {
    if (fireBanForestSortColumn === column) {
      setFireBanForestSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setFireBanForestSortColumn(column);
    setFireBanForestSortDirection("asc");
  };
  const fireBanForestTableSortLabel =
    fireBanForestSortDirection === "asc" ? "A-Z" : "Z-A";
  const getUnmappedForestLink = (
    forest: ForestApiResponse["forests"][number]
  ): { href: string; label: string } => {
    if (isHttpUrl(forest.forestUrl)) {
      return {
        href: forest.forestUrl,
        label: "Facilities page"
      };
    }

    const areaTarget = isHttpUrl(forest.areaUrl)
      ? forest.areaUrl
      : `${FORESTRY_BASE_URL}/visit/solid-fuel-fire-bans`;

    return {
      href: buildTextHighlightUrl(areaTarget, forest.forestName),
      label: `${forest.areaName} region`
    };
  };

  const refreshFromSource = () => {
    setLocationError(null);
    void queryClient
      .fetchQuery({
        queryKey: forestsQueryKey,
        queryFn: forestsQueryFn(userLocation, true)
      })
      .catch(() => undefined);
  };

  const requestLocation = (options?: { silent?: boolean }) => {
    if (!navigator.geolocation) {
      if (!options?.silent) {
        setLocationError("Geolocation is not supported by this browser.");
      }
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };

        setLocationError(null);
        setUserLocation(location);
        void queryClient.invalidateQueries({
          queryKey: buildForestsQueryKey(location),
          exact: true
        });
      },
      (geoError) => {
        if (!options?.silent) {
          setLocationError(`Unable to read your location: ${geoError.message}`);
        }
      }
    );
  };

  const locationButtonLabel = userLocation
    ? "Refresh current location"
    : "Enable current location";

  const renderLocationButton = () => (
    <button
      type="button"
      className="location-action-btn"
      onClick={() => requestLocation()}
      data-testid="locate-btn"
      aria-label={locationButtonLabel}
      title={locationButtonLabel}
    >
      <FontAwesomeIcon icon={faCrosshairs} fixedWidth />
    </button>
  );

  const requestLocationIfPermissionGranted = async () => {
    if (!("permissions" in navigator)) {
      return;
    }

    try {
      const permissionStatus = await navigator.permissions.query({
        name: "geolocation"
      });

      if (permissionStatus.state === "granted") {
        requestLocation({ silent: true });
      }
    } catch {
      return;
    }
  };

  useEffect(() => {
    void requestLocationIfPermissionGranted();
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
          <button type="button" onClick={refreshFromSource}>
            Refresh from source
          </button>
          <button
            type="button"
            className="warnings-btn"
            data-testid="warnings-btn"
            aria-label={`Warnings (${warningCount})`}
            onClick={() => {
              setWarningsOpen(true);
              setFireBanForestTableOpen(false);
            }}
            disabled={warningCount === 0}
          >
            <span aria-hidden="true">⚠</span>
            <span className="warnings-btn-count">{warningCount}</span>
          </button>
        </div>
      </header>

      {!loading && payload && !userLocation ? (
        <section className="panel warning" data-testid="location-required">
          <p className="location-inline-row">
            {renderLocationButton()}
            <span>Enable location to find the closest legal campfire spot near you.</span>
          </p>
        </section>
      ) : null}
      {payload?.nearestLegalSpot && userLocation ? (
        <section className="panel nearest" data-testid="nearest-spot">
          <p className="location-inline-row">
            {renderLocationButton()}
            <span>Using your current location. Click to refresh if you move.</span>
          </p>
          <p className="nearest-copy">
            Closest legal campfire spot: <strong>{payload.nearestLegalSpot.forestName}</strong> in{" "}
            {payload.nearestLegalSpot.areaName} ({payload.nearestLegalSpot.distanceKm.toFixed(1)} km)
          </p>
        </section>
      ) : null}
      {!loading && userLocation && payload && !payload.nearestLegalSpot ? (
        <section className="panel warning" data-testid="nearest-empty">
          <p className="location-inline-row">
            {renderLocationButton()}
            <span>Using your current location. Click to refresh if you move.</span>
          </p>
          <p className="nearest-copy">
            No legal campfire spot could be determined from currently mapped forests.
          </p>
        </section>
      ) : null}

      {warningsOpen ? (
        <>
          <div
            className="warnings-overlay"
            data-testid="warnings-overlay"
            role="presentation"
            onClick={closeWarningsDialog}
          >
            <section
              className="panel warnings-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="warnings-title"
              data-testid="warnings-dialog"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="warnings-dialog-header">
                <h2 id="warnings-title">Warnings ({warningCount})</h2>
                <button type="button" onClick={closeWarningsDialog}>
                  Close
                </button>
              </div>

              {warningCount === 0 ? <p className="muted">No warnings right now.</p> : null}
              {warningCount === 0 ? <p className="muted">No warnings right now.</p> : null}

              {hasUnmappedForestWarning ? (
                <section className="warnings-section" data-testid="warnings-unmapped-section">
                  <h3>Unmapped Forests (Distance Unavailable)</h3>
                  <p className="muted">
                    {unmappedForests.length} forest(s) could not be mapped to coordinates.
                  </p>
                  <ul className="warning-list warning-list-detailed">
                    {unmappedForests.map((forest) => {
                      const debugEntries =
                        forest.geocodeDiagnostics?.debug?.length
                          ? forest.geocodeDiagnostics.debug
                          : ["No geocoding attempt diagnostics were captured in this snapshot."];
                      const failureReason =
                        forest.geocodeDiagnostics?.reason ??
                        "Coordinates were unavailable after forest and area geocoding.";
                      const linkTarget = getUnmappedForestLink(forest);

                      return (
                        <li key={forest.id} className="warning-list-item-detailed">
                          <div>
                            <a href={linkTarget.href} target="_blank" rel="noopener noreferrer">
                              <mark className="warning-forest-highlight">{forest.forestName}</mark>
                            </a>{" "}
                            <span className="muted">({linkTarget.label})</span>
                          </div>
                          <div className="muted">Reason: {failureReason}</div>
                          <details className="warning-debug">
                            <summary>Debug info</summary>
                            <ul className="warning-debug-list">
                              {debugEntries.map((entry, index) => (
                                <li key={`${forest.id}:debug:${index}`}>{entry}</li>
                              ))}
                            </ul>
                          </details>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}

              {generalWarnings.length > 0 ? (
                <section className="warnings-section">
                  <h3>General</h3>
                  <ul className="warning-list">
                    {generalWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {hasFacilitiesMismatchWarning || matchDiagnostics.unmatchedFacilitiesForests.length > 0 ? (
                <section className="warnings-section">
                  <h3>Facilities Missing From Fire-Ban Pages</h3>
                  <p className="muted">
                    {renderFacilitiesMismatchWarningSummary(facilitiesMismatchWarningSummary)}
                    {" "}
                    <button
                      type="button"
                      className="text-btn"
                      onClick={openFireBanForestTable}
                      data-testid="open-fire-ban-forest-table-btn"
                    >
                      (see full list)
                    </button>
                  </p>
                  {matchDiagnostics.unmatchedFacilitiesForests.length > 0 ? (
                    <ul className="warning-list">
                      {matchDiagnostics.unmatchedFacilitiesForests.map((forestName) => (
                        <li key={forestName}>
                          <a
                            href={buildFacilitiesForestUrl(forestName)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {forestName}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ) : null}

              {hasFuzzyMatchesWarning || matchDiagnostics.fuzzyMatches.length > 0 ? (
                <section className="warnings-section">
                  <h3>Fuzzy Facilities Matching</h3>
                  <p className="muted">{fuzzyMatchesWarningText}</p>
                  {matchDiagnostics.fuzzyMatches.length > 0 ? (
                    <ul className="warning-list">
                      {matchDiagnostics.fuzzyMatches.map((match) => (
                        <li key={`${match.facilitiesForestName}:${match.fireBanForestName}`}>
                          Facilities:{" "}
                          <a
                            href={buildFacilitiesForestUrl(match.facilitiesForestName)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {match.facilitiesForestName}
                          </a>{" "}
                          {"->"} Fire ban:{" "}
                          <a
                            href={getFireBanAreaUrl(match.fireBanForestName)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {match.fireBanForestName}
                          </a>{" "}
                          ({match.score.toFixed(2)})
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ) : null}
            </section>
          </div>
          {fireBanForestTableOpen ? (
            <div
              className="warnings-overlay fire-ban-forest-table-overlay"
              data-testid="fire-ban-forest-table-overlay"
              role="presentation"
              onClick={closeFireBanForestTable}
            >
              <section
                className="panel warnings-dialog fire-ban-forest-table-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="fire-ban-forest-table-title"
                data-testid="fire-ban-forest-table-dialog"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="warnings-dialog-header">
                  <h2 id="fire-ban-forest-table-title">
                    Solid Fuel Fire Ban Forests ({fireBanPageForests.length})
                  </h2>
                  <button type="button" onClick={closeFireBanForestTable}>
                    Close
                  </button>
                </div>
                <p className="muted fire-ban-forest-table-hint">
                  Sort columns alphabetically by clicking the table headers.
                </p>
                <div className="fire-ban-forest-table-wrap">
                  <table className="fire-ban-forest-table" data-testid="fire-ban-forest-table">
                    <thead>
                      <tr>
                        <th scope="col">
                          <button
                            type="button"
                            className={`fire-ban-forest-sort-btn ${fireBanForestSortColumn === "forestName" ? "is-active" : ""}`}
                            data-testid="fire-ban-forest-table-forest-sort"
                            onClick={() => toggleFireBanForestSort("forestName")}
                          >
                            Forest name{" "}
                            {fireBanForestSortColumn === "forestName"
                              ? `(${fireBanForestTableSortLabel})`
                              : ""}
                          </button>
                        </th>
                        <th scope="col">
                          <button
                            type="button"
                            className={`fire-ban-forest-sort-btn ${fireBanForestSortColumn === "areaName" ? "is-active" : ""}`}
                            data-testid="fire-ban-forest-table-region-sort"
                            onClick={() => toggleFireBanForestSort("areaName")}
                          >
                            Region name{" "}
                            {fireBanForestSortColumn === "areaName"
                              ? `(${fireBanForestTableSortLabel})`
                              : ""}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedFireBanPageForests.length > 0 ? (
                        sortedFireBanPageForests.map((forest) => (
                          <tr key={`${forest.id}:fire-ban-table`} data-testid="fire-ban-forest-table-row">
                            <td>{forest.forestName}</td>
                            <td>{forest.areaName}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={2}>No forests are currently available from fire-ban pages.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : null}
        </>
      ) : null}
      <section className="layout">
        <aside className="panel filter-panel">
          <h2>Filters</h2>
          <p className="meta">
            Matching {matchingForests.length} of {forests.length} forests.
          </p>
          <div className="filter-panel-scroll">
            <section className="filter-section">
              <h3>
                <a
                  className="source-link"
                  href={FIRE_BAN_SOURCE_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Fire Ban
                </a>
              </h3>
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
                <h3>
                  <a
                    className="source-link"
                    href={FACILITIES_SOURCE_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Facilities
                  </a>
                </h3>
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
                    <div className="forest-title-block">
                      <strong>
                        {isHttpUrl(forest.forestUrl) ? (
                          <a
                            href={forest.forestUrl}
                            className="forest-name-link"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {forest.forestName}
                          </a>
                        ) : (
                          forest.forestName
                        )}
                      </strong>
                      {isHttpUrl(forest.areaUrl) ? (
                        <a
                          href={buildTextHighlightUrl(forest.areaUrl, forest.forestName)}
                          className="muted forest-region-link"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {forest.areaName}
                        </a>
                      ) : (
                        <div className="muted forest-region-link">{forest.areaName}</div>
                      )}
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
