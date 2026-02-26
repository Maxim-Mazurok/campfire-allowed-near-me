import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { FilterPanel } from "./components/FilterPanel";
import { ForestListPanel } from "./components/ForestListPanel";
import { LocationStatusPanels } from "./components/LocationStatusPanels";
import { MapView } from "./components/MapView";
import { SettingsDialog } from "./components/SettingsDialog";
import { WarningsDialog } from "./components/WarningsDialog";
import { useLocation } from "./lib/hooks/use-refresh-and-location";
import {
  buildForestsQueryKey,
  forestsQueryFn,
  toLoadErrorMessage,
  type UserLocation
} from "./lib/forests-query";
import {
  type BanFilterMode,
  type ClosureStatusFilterMode,
  type FireBanForestSortColumn,
  type ForestListSortOption,
  type SortDirection,
  type TriStateMode,
  type UserPreferences
} from "./lib/app-domain-types";
import {
  buildFacilitiesForestUrl,
  buildTotalFireBanDetailsUrl
} from "./lib/app-domain-forest";
import { getForestBanStatus } from "./lib/api";
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
  const [closureStatusFilterMode, setClosureStatusFilterMode] = useState<ClosureStatusFilterMode>(
    () => getInitialPreferences().closureStatusFilterMode ?? "ALL"
  );
  const [hasNoticesFilterMode, setHasNoticesFilterMode] = useState<TriStateMode>(
    () => getInitialPreferences().hasNoticesFilterMode ?? "ANY"
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
  const [impactAccess2wdFilterMode, setImpactAccess2wdFilterMode] = useState<TriStateMode>(
    () => getInitialPreferences().impactAccess2wdFilterMode ?? "ANY"
  );
  const [impactAccess4wdFilterMode, setImpactAccess4wdFilterMode] = useState<TriStateMode>(
    () => getInitialPreferences().impactAccess4wdFilterMode ?? "ANY"
  );
  const [userLocation, setUserLocation] = useState<UserLocation | null>(
    () => getInitialPreferences().userLocation ?? null
  );
  const [avoidTolls, setAvoidTolls] = useState<boolean>(
    () => getInitialPreferences().avoidTolls ?? true
  );
  const [hoveredForestId, setHoveredForestId] = useState<string | null>(null);
  const [hoveredAreaName, setHoveredAreaName] = useState<string | null>(null);
  const [forestListSortOption, setForestListSortOption] = useState<ForestListSortOption>(
    () => getInitialPreferences().forestListSortOption ?? "DRIVING_TIME_ASC"
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
  const {
    locationError,
    requestLocation
  } = useLocation({
    userLocation,
    setUserLocation
  });
  const queryErrorMessage = toLoadErrorMessage(forestsQuery.error);
  const error = locationError ?? queryErrorMessage;

  const forests = payload?.forests ?? [];
  const availableFacilities = useMemo(() => payload?.availableFacilities ?? [], [payload]);
  const availableClosureTags = useMemo(() => payload?.availableClosureTags ?? [], [payload]);
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
  }, [payload, facilitySignature]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [payload, closureTagSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    writeUserPreferences({
      solidFuelBanFilterMode,
      totalFireBanFilterMode,
      closureStatusFilterMode,
      hasNoticesFilterMode,
      facilityFilterModes,
      closureTagFilterModes,
      impactCampingFilterMode,
      impactAccess2wdFilterMode,
      impactAccess4wdFilterMode,
      userLocation,
      avoidTolls,
      forestListSortOption
    });
  }, [
    solidFuelBanFilterMode,
    totalFireBanFilterMode,
    closureStatusFilterMode,
    hasNoticesFilterMode,
    facilityFilterModes,
    closureTagFilterModes,
    impactCampingFilterMode,
    impactAccess2wdFilterMode,
    impactAccess4wdFilterMode,
    userLocation,
    avoidTolls,
    forestListSortOption
  ]);

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
      const hasAccess2wdImpactWarning = isImpactWarning(impactSummary.access2wdImpact);
      const hasAccess4wdImpactWarning = isImpactWarning(impactSummary.access4wdImpact);
      const hasNotices = (forest.closureNotices ?? []).length > 0;

      if (!matchesBanFilter(solidFuelBanFilterMode, getForestBanStatus(forest.areas))) {
        return false;
      }

      if (!matchesBanFilter(totalFireBanFilterMode, forest.totalFireBanStatus)) {
        return false;
      }

      if (closureStatusFilterMode === "OPEN" && closureStatus !== "NONE") {
        return false;
      }

      if (closureStatusFilterMode === "PARTIAL" && closureStatus !== "PARTIAL" && closureStatus !== "NOTICE") {
        return false;
      }

      if (closureStatusFilterMode === "CLOSED" && closureStatus !== "CLOSED") {
        return false;
      }

      if (hasNoticesFilterMode === "INCLUDE" && !hasNotices) {
        return false;
      }

      if (hasNoticesFilterMode === "EXCLUDE" && hasNotices) {
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

      if (impactAccess2wdFilterMode === "INCLUDE" && !hasAccess2wdImpactWarning) {
        return false;
      }

      if (impactAccess2wdFilterMode === "EXCLUDE" && hasAccess2wdImpactWarning) {
        return false;
      }

      if (impactAccess4wdFilterMode === "INCLUDE" && !hasAccess4wdImpactWarning) {
        return false;
      }

      if (impactAccess4wdFilterMode === "EXCLUDE" && hasAccess4wdImpactWarning) {
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
    closureStatusFilterMode,
    hasNoticesFilterMode,
    closureTagFilterModes,
    facilityFilterModes,
    forests,
    impactAccess2wdFilterMode,
    impactAccess4wdFilterMode,
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
        onOpenSettings={openSettingsDialog}
        onOpenWarnings={openWarningsDialog}
        snapshotFetchedAt={payload?.fetchedAt ?? null}
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
          closureStatusFilterMode={closureStatusFilterMode}
          setClosureStatusFilterMode={setClosureStatusFilterMode}
          hasNoticesFilterMode={hasNoticesFilterMode}
          setHasNoticesFilterMode={setHasNoticesFilterMode}
          availableClosureTags={availableClosureTags}
          closureTagFilterModes={closureTagFilterModes}
          clearClosureTagModes={clearClosureTagModes}
          toggleClosureTagMode={toggleClosureTagMode}
          setSingleClosureTagMode={setSingleClosureTagMode}
          impactCampingFilterMode={impactCampingFilterMode}
          setImpactCampingFilterMode={setImpactCampingFilterMode}
          impactAccess2wdFilterMode={impactAccess2wdFilterMode}
          setImpactAccess2wdFilterMode={setImpactAccess2wdFilterMode}
          impactAccess4wdFilterMode={impactAccess4wdFilterMode}
          setImpactAccess4wdFilterMode={setImpactAccess4wdFilterMode}
          availableFacilities={availableFacilities}
          facilityFilterModes={facilityFilterModes}
          clearFacilityModes={clearFacilityModes}
          toggleFacilityMode={toggleFacilityMode}
          setSingleFacilityMode={setSingleFacilityMode}
        />

        <section
          className="panel map-panel"
          data-testid="map-panel"
          data-hovered-forest-id={hoveredForestId ?? ""}
        >
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
              availableFacilities={availableFacilities}
              avoidTolls={avoidTolls}
              hoveredForestId={hoveredForestId}
              hoveredAreaName={hoveredAreaName}
              onHoveredAreaNameChange={setHoveredAreaName}
            />
          ) : null}
        </section>

        <ForestListPanel
          matchingForests={matchingForests}
          availableFacilities={availableFacilities}
          payload={payload}
          avoidTolls={avoidTolls}
          hoveredForestId={hoveredForestId}
          onHoveredForestIdChange={setHoveredForestId}
          hoveredAreaName={hoveredAreaName}
          onHoveredAreaNameChange={setHoveredAreaName}
          forestListSortOption={forestListSortOption}
          onForestListSortOptionChange={setForestListSortOption}
        />
      </section>
    </main>
  );
};
