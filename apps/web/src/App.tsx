import { faCrosshairs } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Tippy from "@tippyjs/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiWebSocketMessage } from "../../../packages/shared/src/websocket.js";
import { FacilityIcon } from "./components/FacilityIcon";
import { MapView } from "./components/MapView";
import { SettingsDialog } from "./components/SettingsDialog";
import { WarningsDialog } from "./components/WarningsDialog";
import {
  fetchForests,
  fetchRefreshTaskStatus,
  type ClosureMatchDiagnostics,
  type ClosureTagDefinition,
  type ForestLoadProgressState,
  type FacilityMatchDiagnostics,
  type ForestApiResponse,
  type RefreshTaskState
} from "./lib/api";
import {
  useForestLoadProgress,
  useForestLoadStatusText,
  useRefreshTaskProgress,
  useRefreshTaskStatusText
} from "./lib/hooks/use-forest-progress";
import { useReconnectingWebSocket } from "./lib/hooks/use-reconnecting-websocket";
import {
  buildForestsQueryKey,
  forestsQueryFn,
  toLoadErrorMessage,
  type UserLocation
} from "./lib/forests-query";
import {
  type BanFilterMode,
  type ClosureFilterMode,
  type FireBanForestSortColumn,
  type SortDirection,
  type TriStateMode,
  type UserPreferences
} from "./lib/app-domain-types";
import {
  ALPHABETICAL_COLLATOR,
  CLOSURES_SOURCE_URL,
  FACILITIES_SOURCE_URL,
  FORESTRY_BASE_URL,
  SOLID_FUEL_FIRE_BAN_SOURCE_URL,
  TOTAL_FIRE_BAN_RULES_URL,
  TOTAL_FIRE_BAN_SOURCE_URL
} from "./lib/app-domain-constants";
import {
  buildFacilitiesForestUrl,
  buildTextHighlightUrl,
  buildTotalFireBanDetailsUrl,
  formatDriveSummary,
  isHttpUrl,
  normalizeForestName,
  sortForestsByDistance
} from "./lib/app-domain-forest";
import {
  getClosureStatusLabel,
  getForestClosureStatus,
  getForestImpactSummary,
  getSolidFuelStatusLabel,
  getStatusClassName,
  getTotalFireBanStatusLabel,
  inferFacilityImpactTarget,
  isImpactWarning,
  matchesBanFilter
} from "./lib/app-domain-status";
import {
  readUserPreferences,
  writeUserPreferences
} from "./lib/app-domain-preferences";
import {
  buildForestsWebSocketUrl,
  buildRefreshWebSocketUrl
} from "./lib/app-domain-websocket";

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
      <a
        href={SOLID_FUEL_FIRE_BAN_SOURCE_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        Solid Fuel Fire Ban
      </a>
      {" pages"}
      {afterFireBanPages}
    </>
  );
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [fireBanForestTableOpen, setFireBanForestTableOpen] = useState(false);
  const [fireBanForestSortColumn, setFireBanForestSortColumn] =
    useState<FireBanForestSortColumn>("forestName");
  const [fireBanForestSortDirection, setFireBanForestSortDirection] =
    useState<SortDirection>("asc");
  const [solidFuelBanFilterMode, setSolidFuelBanFilterMode] = useState<BanFilterMode>(
    () => getInitialPreferences().solidFuelBanFilterMode ?? "ALL"
  );
  const [totalFireBanFilterMode, setTotalFireBanFilterMode] = useState<BanFilterMode>(
    () => getInitialPreferences().totalFireBanFilterMode ?? "ALL"
  );
  const [closureFilterMode, setClosureFilterMode] = useState<ClosureFilterMode>(
    () => getInitialPreferences().closureFilterMode ?? "ALL"
  );
  const [facilityFilterModes, setFacilityFilterModes] = useState<Record<string, TriStateMode>>(
    () => getInitialPreferences().facilityFilterModes ?? {}
  );
  const [closureTagFilterModes, setClosureTagFilterModes] = useState<Record<string, TriStateMode>>(
    () => getInitialPreferences().closureTagFilterModes ?? {}
  );
  const [impactCampingFilterMode, setImpactCampingFilterMode] = useState<TriStateMode>(
    () => getInitialPreferences().impactCampingFilterMode ?? "ANY"
  );
  const [impactAccessFilterMode, setImpactAccessFilterMode] = useState<TriStateMode>(
    () => getInitialPreferences().impactAccessFilterMode ?? "ANY"
  );
  const [userLocation, setUserLocation] = useState<UserLocation | null>(
    () => getInitialPreferences().userLocation ?? null
  );
  const [avoidTolls, setAvoidTolls] = useState<boolean>(
    () => getInitialPreferences().avoidTolls ?? true
  );
  const [refreshTaskState, setRefreshTaskState] = useState<RefreshTaskState | null>(null);
  const [forestLoadProgressState, setForestLoadProgressState] =
    useState<ForestLoadProgressState | null>(null);
  const refreshStatusPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearRefreshStatusPollTimer = () => {
    if (refreshStatusPollTimerRef.current) {
      clearInterval(refreshStatusPollTimerRef.current);
      refreshStatusPollTimerRef.current = null;
    }
  };

  const syncRefreshTaskState = () => {
    void fetchRefreshTaskStatus()
      .then((taskState) => {
        setRefreshTaskState(taskState);
        if (taskState.status !== "RUNNING") {
          clearRefreshStatusPollTimer();
        }
      })
      .catch(() => undefined);
  };

  const startRefreshStatusPolling = () => {
    syncRefreshTaskState();

    if (refreshStatusPollTimerRef.current) {
      return;
    }

    refreshStatusPollTimerRef.current = setInterval(() => {
      syncRefreshTaskState();
    }, 1500);
  };
  const forestsQueryKey = useMemo(
    () => buildForestsQueryKey(userLocation, { avoidTolls }),
    [userLocation?.latitude, userLocation?.longitude, avoidTolls]
  );
  const forestsQuery = useQuery({
    queryKey: forestsQueryKey,
    queryFn: forestsQueryFn(userLocation, { avoidTolls })
  });

  const payload = forestsQuery.data ?? null;
  const loading = forestsQuery.isFetching;
  const queryErrorMessage = toLoadErrorMessage(forestsQuery.error);
  const error = locationError ?? queryErrorMessage;

  const forests = payload?.forests ?? [];
  const availableFacilities = payload?.availableFacilities ?? [];
  const availableClosureTags = payload?.availableClosureTags ?? [];
  const facilitySignature = availableFacilities.map((facility) => facility.key).join("|");
  const closureTagSignature = availableClosureTags.map((tag) => tag.key).join("|");

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
    if (!payload) {
      return;
    }

    setClosureTagFilterModes((current) => {
      const next: Record<string, TriStateMode> = {};
      for (const closureTag of availableClosureTags) {
        next[closureTag.key] = current[closureTag.key] ?? "ANY";
      }
      return next;
    });
  }, [payload, closureTagSignature, availableClosureTags]);

  useEffect(() => {
    writeUserPreferences({
      solidFuelBanFilterMode,
      totalFireBanFilterMode,
      closureFilterMode,
      facilityFilterModes,
      closureTagFilterModes,
      impactCampingFilterMode,
      impactAccessFilterMode,
      userLocation,
      avoidTolls
    });
  }, [
    solidFuelBanFilterMode,
    totalFireBanFilterMode,
    closureFilterMode,
    facilityFilterModes,
    closureTagFilterModes,
    impactCampingFilterMode,
    impactAccessFilterMode,
    userLocation,
    avoidTolls
  ]);

  useEffect(() => {
    if (!payload?.refreshTask) {
      return;
    }

    setRefreshTaskState(payload.refreshTask);
  }, [payload?.refreshTask]);

  useReconnectingWebSocket<ApiWebSocketMessage>({
    webSocketUrl: buildRefreshWebSocketUrl(),
    onMessage: (message) => {
      if (message.type === "refresh-task") {
        setRefreshTaskState(message.task);
      }
    }
  });

  useReconnectingWebSocket<ApiWebSocketMessage>({
    webSocketUrl: buildForestsWebSocketUrl(),
    onMessage: (message) => {
      if (message.type === "forest-load-progress") {
        setForestLoadProgressState(message.load);
      }
    }
  });

  useEffect(() => {
    if (refreshTaskState?.status !== "RUNNING") {
      clearRefreshStatusPollTimer();
      return;
    }

    startRefreshStatusPolling();

    return () => {
      clearRefreshStatusPollTimer();
    };
  }, [refreshTaskState?.status]);

  const refreshTaskStatusText = useRefreshTaskStatusText(refreshTaskState);
  const refreshTaskProgress = useRefreshTaskProgress(refreshTaskState);
  const forestLoadStatusText = useForestLoadStatusText(forestLoadProgressState);
  const forestLoadProgress = useForestLoadProgress(forestLoadProgressState);

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

  const setSingleClosureTagMode = (key: string, mode: TriStateMode) => {
    setClosureTagFilterModes((current) => ({
      ...current,
      [key]: mode
    }));
  };

  const toggleClosureTagMode = (key: string, mode: Exclude<TriStateMode, "ANY">) => {
    setClosureTagFilterModes((current) => ({
      ...current,
      [key]: current[key] === mode ? "ANY" : mode
    }));
  };

  const clearClosureTagModes = () => {
    setClosureTagFilterModes((current) =>
      Object.fromEntries(
        Object.keys(current).map((key) => [key, "ANY"])
      ) as Record<string, TriStateMode>
    );
  };

  const matchingForests = useMemo(() => {
    return forests.filter((forest) => {
      const closureStatus = getForestClosureStatus(forest);
      const impactSummary = getForestImpactSummary(forest);
      const hasCampingImpactWarning = isImpactWarning(impactSummary.campingImpact);
      const hasAccessImpactWarning =
        isImpactWarning(impactSummary.access2wdImpact) ||
        isImpactWarning(impactSummary.access4wdImpact);

      if (!matchesBanFilter(solidFuelBanFilterMode, forest.banStatus)) {
        return false;
      }

      if (!matchesBanFilter(totalFireBanFilterMode, forest.totalFireBanStatus)) {
        return false;
      }

      if (closureFilterMode === "OPEN_ONLY" && closureStatus !== "NONE") {
        return false;
      }

      if (closureFilterMode === "NO_FULL_CLOSURES" && closureStatus === "CLOSED") {
        return false;
      }

      if (closureFilterMode === "HAS_NOTICE" && closureStatus === "NONE") {
        return false;
      }

      for (const closureTag of availableClosureTags) {
        const mode = closureTagFilterModes[closureTag.key] ?? "ANY";
        if (mode === "ANY") {
          continue;
        }

        const value = forest.closureTags?.[closureTag.key] === true;
        if (mode === "INCLUDE" && !value) {
          return false;
        }

        if (mode === "EXCLUDE" && value) {
          return false;
        }
      }

      if (impactCampingFilterMode === "INCLUDE" && !hasCampingImpactWarning) {
        return false;
      }

      if (impactCampingFilterMode === "EXCLUDE" && hasCampingImpactWarning) {
        return false;
      }

      if (impactAccessFilterMode === "INCLUDE" && !hasAccessImpactWarning) {
        return false;
      }

      if (impactAccessFilterMode === "EXCLUDE" && hasAccessImpactWarning) {
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
  }, [
    availableClosureTags,
    availableFacilities,
    closureFilterMode,
    closureTagFilterModes,
    facilityFilterModes,
    forests,
    impactAccessFilterMode,
    impactCampingFilterMode,
    solidFuelBanFilterMode,
    totalFireBanFilterMode
  ]);

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
  const closureDiagnostics = payload?.closureDiagnostics ?? {
    unmatchedNotices: [],
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
  const forestsWithUnknownTotalFireBan = forests
    .filter((forest) => forest.totalFireBanStatus === "UNKNOWN")
    .slice()
    .sort((left, right) => left.forestName.localeCompare(right.forestName));
  const hasUnmappedForestWarning = unmappedForests.length > 0;
  const hasUnknownTotalFireBanWarning = forestsWithUnknownTotalFireBan.length > 0;
  const unmappedForestWarningCount = unmappedForests.length;
  const unknownTotalFireBanWarningCount = forestsWithUnknownTotalFireBan.length;
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
    unknownTotalFireBanWarningCount +
    facilitiesMismatchWarningCount +
    fuzzyMatchesWarningCount +
    closureDiagnostics.unmatchedNotices.length;
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
  const closeSettingsDialog = () => {
    setSettingsOpen(false);
  };
  const openSettingsDialog = () => {
    setSettingsOpen(true);
    setWarningsOpen(false);
    setFireBanForestTableOpen(false);
  };
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
    setRefreshTaskState({
      taskId: null,
      status: "RUNNING",
      phase: "SCRAPE",
      message: "Refresh requested.",
      startedAt: null,
      updatedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
      progress: {
        phase: "SCRAPE",
        message: "Refresh requested.",
        completed: 0,
        total: null
      }
    });
    startRefreshStatusPolling();

    void queryClient
      .cancelQueries({
        queryKey: forestsQueryKey,
        exact: true
      })
      .then(() =>
        fetchForests(userLocation ?? undefined, {
          refresh: true,
          avoidTolls
        })
      )
      .then((response) => {
        queryClient.setQueryData(forestsQueryKey, response);
        if (response.refreshTask) {
          setRefreshTaskState(response.refreshTask);
        }
      })
      .then(() => syncRefreshTaskState())
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
          queryKey: buildForestsQueryKey(location, { avoidTolls }),
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
          NSW forestry checker combining Solid Fuel Fire Ban data (Forestry Corporation NSW)
          and Total Fire Ban data (NSW Rural Fire Service).
        </p>

        <div className="controls">
          <button type="button" onClick={refreshFromSource}>
            Refresh from source
          </button>
          <button
            type="button"
            className="settings-btn"
            data-testid="settings-btn"
            onClick={openSettingsDialog}
          >
            Settings
          </button>
          <button
            type="button"
            className="warnings-btn"
            data-testid="warnings-btn"
            aria-label={`Warnings (${warningCount})`}
            onClick={() => {
              setSettingsOpen(false);
              setWarningsOpen(true);
              setFireBanForestTableOpen(false);
            }}
            disabled={warningCount === 0}
          >
            <span aria-hidden="true">⚠</span>
            <span className="warnings-btn-count">{warningCount}</span>
          </button>
        </div>
        {refreshTaskStatusText ? (
          <p className="muted refresh-task-status" data-testid="refresh-task-status">
            {refreshTaskStatusText}
          </p>
        ) : null}
        {refreshTaskProgress ? (
          <div className="refresh-progress" data-testid="refresh-progress">
            <div className="refresh-progress-meta">
              <span>{refreshTaskProgress.phase.replaceAll("_", " ")}</span>
              {typeof refreshTaskProgress.percentage === "number" ? (
                <span>{refreshTaskProgress.percentage}%</span>
              ) : (
                <span>In progress</span>
              )}
            </div>
            {typeof refreshTaskProgress.percentage === "number" ? (
              <progress
                className="refresh-progress-bar"
                data-testid="refresh-progress-bar"
                value={refreshTaskProgress.completed}
                max={refreshTaskProgress.total ?? 1}
              />
            ) : (
              <progress
                className="refresh-progress-bar"
                data-testid="refresh-progress-bar"
              />
            )}
          </div>
        ) : null}
        {forestLoadStatusText ? (
          <p className="muted refresh-task-status" data-testid="forest-load-status">
            {forestLoadStatusText}
          </p>
        ) : null}
        {forestLoadProgress ? (
          <div className="refresh-progress" data-testid="forest-load-progress">
            <div className="refresh-progress-meta">
              <span>{forestLoadProgress.phase.replaceAll("_", " ")}</span>
              {typeof forestLoadProgress.percentage === "number" ? (
                <span>{forestLoadProgress.percentage}%</span>
              ) : (
                <span>In progress</span>
              )}
            </div>
            {typeof forestLoadProgress.percentage === "number" ? (
              <progress
                className="refresh-progress-bar"
                data-testid="forest-load-progress-bar"
                value={forestLoadProgress.completed}
                max={forestLoadProgress.total ?? 1}
              />
            ) : (
              <progress
                className="refresh-progress-bar"
                data-testid="forest-load-progress-bar"
              />
            )}
          </div>
        ) : null}
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
            {payload.nearestLegalSpot.areaName} (
            {formatDriveSummary(
              payload.nearestLegalSpot.distanceKm,
              payload.nearestLegalSpot.travelDurationMinutes
            )}
            )
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

      <SettingsDialog
        isOpen={settingsOpen}
        avoidTolls={avoidTolls}
        onClose={closeSettingsDialog}
        setAvoidTolls={setAvoidTolls}
      />

      <WarningsDialog
        isOpen={warningsOpen}
        warningCount={warningCount}
        closeWarningsDialog={closeWarningsDialog}
        warningSections={{
          hasUnmappedForestWarning,
          unmappedForests,
          getUnmappedForestLink,
          hasUnknownTotalFireBanWarning,
          forestsWithUnknownTotalFireBan,
          buildTotalFireBanDetailsUrl,
          generalWarnings,
          hasFacilitiesMismatchWarning,
          matchDiagnostics,
          facilitiesMismatchWarningSummary,
          renderFacilitiesMismatchWarningSummary,
          openFireBanForestTable,
          buildFacilitiesForestUrl,
          hasFuzzyMatchesWarning,
          fuzzyMatchesWarningText,
          getFireBanAreaUrl,
          closureDiagnostics
        }}
        fireBanForestTable={{
          fireBanForestTableOpen,
          closeFireBanForestTable,
          fireBanPageForests,
          sortedFireBanPageForests,
          fireBanForestSortColumn,
          fireBanForestTableSortLabel,
          toggleFireBanForestSort
        }}
      />
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
                  href={SOLID_FUEL_FIRE_BAN_SOURCE_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Solid Fuel Fire Ban
                </a>
              </h3>
              <div className="tri-toggle-group">
                <button
                  type="button"
                  className={solidFuelBanFilterMode === "ALL" ? "is-active" : ""}
                  onClick={() => setSolidFuelBanFilterMode("ALL")}
                  data-testid="ban-filter-all"
                >
                  All
                </button>
                <button
                  type="button"
                  className={solidFuelBanFilterMode === "NOT_BANNED" ? "is-active" : ""}
                  onClick={() => setSolidFuelBanFilterMode("NOT_BANNED")}
                  data-testid="ban-filter-allowed"
                >
                  Not banned
                </button>
                <button
                  type="button"
                  className={solidFuelBanFilterMode === "BANNED" ? "is-active" : ""}
                  onClick={() => setSolidFuelBanFilterMode("BANNED")}
                  data-testid="ban-filter-not-allowed"
                >
                  Banned
                </button>
                <button
                  type="button"
                  className={solidFuelBanFilterMode === "UNKNOWN" ? "is-active" : ""}
                  onClick={() => setSolidFuelBanFilterMode("UNKNOWN")}
                  data-testid="ban-filter-unknown"
                >
                  Unknown
                </button>
              </div>
            </section>

            <section className="filter-section">
              <h3>
                <a
                  className="source-link"
                  href={TOTAL_FIRE_BAN_SOURCE_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Total Fire Ban
                </a>
              </h3>
              <p className="muted filter-subnote">
                <a className="source-link" href={TOTAL_FIRE_BAN_RULES_URL} target="_blank" rel="noreferrer">
                  Rules
                </a>{" "}
                apply to all outdoor fire use during a declared Total Fire Ban.
              </p>
              <div className="tri-toggle-group">
                <button
                  type="button"
                  className={totalFireBanFilterMode === "ALL" ? "is-active" : ""}
                  onClick={() => setTotalFireBanFilterMode("ALL")}
                  data-testid="total-fire-ban-filter-all"
                >
                  All
                </button>
                <button
                  type="button"
                  className={totalFireBanFilterMode === "NOT_BANNED" ? "is-active" : ""}
                  onClick={() => setTotalFireBanFilterMode("NOT_BANNED")}
                  data-testid="total-fire-ban-filter-not-banned"
                >
                  No ban
                </button>
                <button
                  type="button"
                  className={totalFireBanFilterMode === "BANNED" ? "is-active" : ""}
                  onClick={() => setTotalFireBanFilterMode("BANNED")}
                  data-testid="total-fire-ban-filter-banned"
                >
                  Banned
                </button>
                <button
                  type="button"
                  className={totalFireBanFilterMode === "UNKNOWN" ? "is-active" : ""}
                  onClick={() => setTotalFireBanFilterMode("UNKNOWN")}
                  data-testid="total-fire-ban-filter-unknown"
                >
                  Unknown
                </button>
              </div>
            </section>

            <section className="filter-section">
              <h3>
                <a
                  className="source-link"
                  href={CLOSURES_SOURCE_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Closures & Notices
                </a>
              </h3>
              <div className="tri-toggle-group closure-filter-group">
                <button
                  type="button"
                  className={closureFilterMode === "ALL" ? "is-active" : ""}
                  onClick={() => setClosureFilterMode("ALL")}
                >
                  All
                </button>
                <button
                  type="button"
                  className={closureFilterMode === "OPEN_ONLY" ? "is-active" : ""}
                  onClick={() => setClosureFilterMode("OPEN_ONLY")}
                  data-testid="closure-filter-open-only"
                >
                  Open only
                </button>
                <button
                  type="button"
                  className={closureFilterMode === "NO_FULL_CLOSURES" ? "is-active" : ""}
                  onClick={() => setClosureFilterMode("NO_FULL_CLOSURES")}
                  data-testid="closure-filter-no-full"
                >
                  No full closures
                </button>
                <button
                  type="button"
                  className={closureFilterMode === "HAS_NOTICE" ? "is-active" : ""}
                  onClick={() => setClosureFilterMode("HAS_NOTICE")}
                  data-testid="closure-filter-has-notice"
                >
                  Has notices
                </button>
              </div>
            </section>

            {availableClosureTags.length ? (
              <section className="filter-section">
                <div className="filter-section-header">
                  <h3>Closure tags</h3>
                  <button type="button" className="text-btn" onClick={clearClosureTagModes}>
                    Clear
                  </button>
                </div>
                <ul className="facility-filter-list">
                  {availableClosureTags.map((closureTag: ClosureTagDefinition) => {
                    const mode = closureTagFilterModes[closureTag.key] ?? "ANY";
                    return (
                      <li key={closureTag.key} className="facility-filter-row">
                        <span className="facility-filter-label">
                          <span>{closureTag.label}</span>
                        </span>
                        <span className="tri-toggle" role="group" aria-label={`${closureTag.label} filter`}>
                          <button
                            type="button"
                            className={mode === "INCLUDE" ? "is-active include" : ""}
                            onClick={() => toggleClosureTagMode(closureTag.key, "INCLUDE")}
                            data-testid={`closure-tag-filter-${closureTag.key}-include`}
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            className={mode === "EXCLUDE" ? "is-active exclude" : ""}
                            onClick={() => toggleClosureTagMode(closureTag.key, "EXCLUDE")}
                            data-testid={`closure-tag-filter-${closureTag.key}-exclude`}
                          >
                            ✕
                          </button>
                          <button
                            type="button"
                            className={mode === "ANY" ? "is-active neutral" : ""}
                            onClick={() => setSingleClosureTagMode(closureTag.key, "ANY")}
                            data-testid={`closure-tag-filter-${closureTag.key}-any`}
                          >
                            ?
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            <section className="filter-section">
              <h3>Planning impact warnings</h3>
              <p className="muted closure-filter-meta">
                Highlight forests where notices suggest camping or access restrictions.
              </p>
              <div className="facility-filter-list">
                <div className="facility-filter-row">
                  <span className="facility-filter-label">
                    <span>Camping</span>
                  </span>
                  <span className="tri-toggle" role="group" aria-label="Camping impact filter">
                    <button
                      type="button"
                      className={impactCampingFilterMode === "INCLUDE" ? "is-active include" : ""}
                      onClick={() =>
                        setImpactCampingFilterMode((current) =>
                          current === "INCLUDE" ? "ANY" : "INCLUDE"
                        )
                      }
                      data-testid="impact-filter-camping-include"
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className={impactCampingFilterMode === "EXCLUDE" ? "is-active exclude" : ""}
                      onClick={() =>
                        setImpactCampingFilterMode((current) =>
                          current === "EXCLUDE" ? "ANY" : "EXCLUDE"
                        )
                      }
                      data-testid="impact-filter-camping-exclude"
                    >
                      ✕
                    </button>
                    <button
                      type="button"
                      className={impactCampingFilterMode === "ANY" ? "is-active neutral" : ""}
                      onClick={() => setImpactCampingFilterMode("ANY")}
                      data-testid="impact-filter-camping-any"
                    >
                      ?
                    </button>
                  </span>
                </div>
                <div className="facility-filter-row">
                  <span className="facility-filter-label">
                    <span>2WD/4WD access</span>
                  </span>
                  <span className="tri-toggle" role="group" aria-label="Access impact filter">
                    <button
                      type="button"
                      className={impactAccessFilterMode === "INCLUDE" ? "is-active include" : ""}
                      onClick={() =>
                        setImpactAccessFilterMode((current) =>
                          current === "INCLUDE" ? "ANY" : "INCLUDE"
                        )
                      }
                      data-testid="impact-filter-access-include"
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className={impactAccessFilterMode === "EXCLUDE" ? "is-active exclude" : ""}
                      onClick={() =>
                        setImpactAccessFilterMode((current) =>
                          current === "EXCLUDE" ? "ANY" : "EXCLUDE"
                        )
                      }
                      data-testid="impact-filter-access-exclude"
                    >
                      ✕
                    </button>
                    <button
                      type="button"
                      className={impactAccessFilterMode === "ANY" ? "is-active neutral" : ""}
                      onClick={() => setImpactAccessFilterMode("ANY")}
                      data-testid="impact-filter-access-any"
                    >
                      ?
                    </button>
                  </span>
                </div>
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
                      <div className="status-pill-row">
                      <span
                        className={`status-pill ${getStatusClassName(forest.banStatus)}`}
                      >
                        {getSolidFuelStatusLabel(forest.banStatus)}
                      </span>
                      <a
                        href={buildTotalFireBanDetailsUrl(forest)}
                        target="_blank"
                        rel="noreferrer"
                        className={`status-pill ${getStatusClassName(forest.totalFireBanStatus)}`}
                      >
                        {getTotalFireBanStatusLabel(forest.totalFireBanStatus)}
                      </a>
                      {getForestClosureStatus(forest) !== "NONE" ? (
                        <span
                          className={`status-pill ${getForestClosureStatus(forest) === "CLOSED" ? "banned" : "unknown"}`}
                        >
                          {getClosureStatusLabel(getForestClosureStatus(forest))}
                        </span>
                      ) : null}
                      </div>
                      <small className="muted" data-testid="distance-text">
                        {forest.distanceKm !== null
                          ? formatDriveSummary(
                              forest.distanceKm,
                              forest.travelDurationMinutes
                            )
                          : "Drive distance unavailable"}
                      </small>
                    </div>
                  </div>
                  {availableFacilities.length ? (
                    <div className="facility-row" data-testid="facility-row">
                      {availableFacilities.map((facility) => {
                        const impactSummary = getForestImpactSummary(forest);
                        const facilityImpactTarget = inferFacilityImpactTarget(facility);
                        const hasWarning =
                          facilityImpactTarget === "CAMPING"
                            ? isImpactWarning(impactSummary.campingImpact)
                            : facilityImpactTarget === "ACCESS_2WD"
                              ? isImpactWarning(impactSummary.access2wdImpact)
                              : facilityImpactTarget === "ACCESS_4WD"
                                ? isImpactWarning(impactSummary.access4wdImpact)
                                : false;
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
                            <span
                              className={`facility-indicator ${stateClass}`}
                              data-facility-key={facility.key}
                              data-warning={hasWarning ? "true" : "false"}
                            >
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
