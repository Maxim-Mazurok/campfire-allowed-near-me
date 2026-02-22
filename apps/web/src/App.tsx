import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { FilterPanel } from "./components/FilterPanel";
import { ForestListPanel } from "./components/ForestListPanel";
import { LocationStatusPanels } from "./components/LocationStatusPanels";
import { MapView } from "./components/MapView";
import { SettingsDialog } from "./components/SettingsDialog";
import { WarningsDialog } from "./components/WarningsDialog";
import {
  useForestLoadProgress,
  useForestLoadStatusText,
  useRefreshTaskProgress,
  useRefreshTaskStatusText
} from "./lib/hooks/use-forest-progress";
import { useRefreshAndLocation } from "./lib/hooks/use-refresh-and-location";
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
  buildFacilitiesForestUrl,
  buildTotalFireBanDetailsUrl
} from "./lib/app-domain-forest";
import {
  getForestClosureStatus,
  getForestImpactSummary,
  isImpactWarning,
  matchesBanFilter
} from "./lib/app-domain-status";
import {
  readUserPreferences,
  writeUserPreferences
} from "./lib/app-domain-preferences";
import {
  renderFacilitiesMismatchWarningSummary,
  useWarningDialogData
} from "./lib/hooks/use-warning-dialog-data";


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
  const {
    locationError,
    refreshTaskState,
    forestLoadProgressState,
    refreshFromSource,
    requestLocation
  } = useRefreshAndLocation({
    queryClient,
    forestsQueryKey,
    userLocation,
    setUserLocation,
    avoidTolls,
    payloadRefreshTask: payload?.refreshTask ?? undefined
  });
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

  const mappableMatchingForestCount = matchingForests.filter((forest) => forest.latitude !== null && forest.longitude !== null).length;
  const mappableForestCount = forests.filter((forest) => forest.latitude !== null && forest.longitude !== null).length;
  const {
    warningCount,
    hasUnmappedForestWarning,
    unmappedForests,
    hasUnknownTotalFireBanWarning,
    forestsWithUnknownTotalFireBan,
    generalWarnings,
    hasFacilitiesMismatchWarning,
    matchDiagnostics,
    facilitiesMismatchWarningSummary,
    hasFuzzyMatchesWarning,
    fuzzyMatchesWarningText,
    getFireBanAreaUrl,
    closureDiagnostics,
    fireBanPageForests,
    sortedFireBanPageForests,
    getUnmappedForestLink
  } = useWarningDialogData({
    forests,
    payload,
    fireBanForestSortColumn,
    fireBanForestSortDirection
  });
  const closeSettingsDialog = () => { setSettingsOpen(false); };
  const openSettingsDialog = () => {
    setSettingsOpen(true);
    setWarningsOpen(false);
    setFireBanForestTableOpen(false);
  };
  const openWarningsDialog = () => {
    setSettingsOpen(false);
    setWarningsOpen(true);
    setFireBanForestTableOpen(false);
  };
  const closeWarningsDialog = () => {
    setWarningsOpen(false);
    setFireBanForestTableOpen(false);
  };
  const openFireBanForestTable = () => { setFireBanForestTableOpen(true); };
  const closeFireBanForestTable = () => { setFireBanForestTableOpen(false); };
  const toggleFireBanForestSort = (column: FireBanForestSortColumn) => {
    if (fireBanForestSortColumn === column) {
      setFireBanForestSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setFireBanForestSortColumn(column);
    setFireBanForestSortDirection("asc");
  };
  const fireBanForestTableSortLabel = fireBanForestSortDirection === "asc" ? "A-Z" : "Z-A";

  return (
    <main className="app-shell">
      <AppHeader
        warningCount={warningCount}
        onRefreshFromSource={refreshFromSource}
        onOpenSettings={openSettingsDialog}
        onOpenWarnings={openWarningsDialog}
        refreshTaskStatusText={refreshTaskStatusText}
        refreshTaskProgress={refreshTaskProgress}
        forestLoadStatusText={forestLoadStatusText}
        forestLoadProgress={forestLoadProgress}
      />

      <LocationStatusPanels
        loading={loading}
        payload={payload}
        userLocation={userLocation}
        onRequestLocation={requestLocation}
      />

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
        <FilterPanel
          matchingForestsCount={matchingForests.length}
          forestsCount={forests.length}
          solidFuelBanFilterMode={solidFuelBanFilterMode}
          setSolidFuelBanFilterMode={setSolidFuelBanFilterMode}
          totalFireBanFilterMode={totalFireBanFilterMode}
          setTotalFireBanFilterMode={setTotalFireBanFilterMode}
          closureFilterMode={closureFilterMode}
          setClosureFilterMode={setClosureFilterMode}
          availableClosureTags={availableClosureTags}
          closureTagFilterModes={closureTagFilterModes}
          clearClosureTagModes={clearClosureTagModes}
          toggleClosureTagMode={toggleClosureTagMode}
          setSingleClosureTagMode={setSingleClosureTagMode}
          impactCampingFilterMode={impactCampingFilterMode}
          setImpactCampingFilterMode={setImpactCampingFilterMode}
          impactAccessFilterMode={impactAccessFilterMode}
          setImpactAccessFilterMode={setImpactAccessFilterMode}
          availableFacilities={availableFacilities}
          facilityFilterModes={facilityFilterModes}
          clearFacilityModes={clearFacilityModes}
          toggleFacilityMode={toggleFacilityMode}
          setSingleFacilityMode={setSingleFacilityMode}
        />

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

        <ForestListPanel
          matchingForests={matchingForests}
          availableFacilities={availableFacilities}
          payload={payload}
        />
      </section>
    </main>
  );
};
