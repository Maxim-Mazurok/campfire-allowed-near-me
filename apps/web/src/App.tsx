import { faCrosshairs } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Tippy from "@tippyjs/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FacilityIcon } from "./components/FacilityIcon";
import { MapView } from "./components/MapView";
import {
  fetchForests,
  fetchRefreshTaskStatus,
  type ClosureImpactLevel,
  type ClosureTagDefinition,
  type ForestLoadProgressState,
  type ForestApiResponse,
  type RefreshTaskState
} from "./lib/api";
import {
  buildForestsQueryKey,
  forestsQueryFn,
  toLoadErrorMessage,
  type UserLocation
} from "./lib/forests-query";

type BanFilterMode = "ALL" | "NOT_BANNED" | "BANNED" | "UNKNOWN";
type LegacyBanFilterMode = "ALL" | "ALLOWED" | "NOT_ALLOWED";
type ClosureFilterMode = "ALL" | "OPEN_ONLY" | "NO_FULL_CLOSURES" | "HAS_NOTICE";
type TriStateMode = "ANY" | "INCLUDE" | "EXCLUDE";
type FireBanForestSortColumn = "forestName" | "areaName";
type SortDirection = "asc" | "desc";
type UserPreferences = {
  solidFuelBanFilterMode?: BanFilterMode;
  totalFireBanFilterMode?: BanFilterMode;
  closureFilterMode?: ClosureFilterMode;
  // Legacy key from older builds.
  banFilterMode?: LegacyBanFilterMode;
  facilityFilterModes?: Record<string, TriStateMode>;
  closureTagFilterModes?: Record<string, TriStateMode>;
  impactCampingFilterMode?: TriStateMode;
  impactAccessFilterMode?: TriStateMode;
  userLocation?: UserLocation | null;
  avoidTolls?: boolean;
};

const SOLID_FUEL_FIRE_BAN_SOURCE_URL =
  "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans";
const TOTAL_FIRE_BAN_SOURCE_URL =
  "https://www.rfs.nsw.gov.au/fire-information/fdr-and-tobans";
const TOTAL_FIRE_BAN_RULES_URL =
  "https://www.rfs.nsw.gov.au/fire-information/fdr-and-tobans/total-fire-ban-rules";
const FACILITIES_SOURCE_URL = "https://www.forestrycorporation.com.au/visit/forests";
const CLOSURES_SOURCE_URL = "https://forestclosure.fcnsw.net";
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

const formatDriveDuration = (durationMinutes: number | null): string => {
  if (durationMinutes === null || !Number.isFinite(durationMinutes)) {
    return "Drive time unavailable";
  }

  const roundedMinutes = Math.max(1, Math.round(durationMinutes));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
};

const formatDriveSummary = (
  distanceKm: number | null,
  durationMinutes: number | null
): string => {
  if (distanceKm === null) {
    return "Drive distance unavailable";
  }

  if (durationMinutes === null) {
    return `${distanceKm.toFixed(1)} km`;
  }

  return `${distanceKm.toFixed(1)} km, ${formatDriveDuration(durationMinutes)}`;
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

const buildTotalFireBanDetailsUrl = (
  forest: ForestApiResponse["forests"][number]
): string => {
  const fullAddress = forest.geocodeName?.trim() ? forest.geocodeName : " ";
  const placeIdentifier = " ";
  const latitude =
    typeof forest.latitude === "number" && Number.isFinite(forest.latitude)
      ? String(forest.latitude)
      : " ";
  const longitude =
    typeof forest.longitude === "number" && Number.isFinite(forest.longitude)
      ? String(forest.longitude)
      : " ";

  return `${TOTAL_FIRE_BAN_SOURCE_URL}?fullAddress=${encodeURIComponent(fullAddress)}&lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}&placeId=${encodeURIComponent(placeIdentifier)}`;
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

const isBanFilterMode = (value: unknown): value is BanFilterMode =>
  value === "ALL" ||
  value === "NOT_BANNED" ||
  value === "BANNED" ||
  value === "UNKNOWN";

const isLegacyBanFilterMode = (value: unknown): value is LegacyBanFilterMode =>
  value === "ALL" || value === "ALLOWED" || value === "NOT_ALLOWED";

const toModernBanFilterMode = (mode: LegacyBanFilterMode): BanFilterMode => {
  if (mode === "ALLOWED") {
    return "NOT_BANNED";
  }

  if (mode === "NOT_ALLOWED") {
    return "BANNED";
  }

  return "ALL";
};

const matchesBanFilter = (
  mode: BanFilterMode,
  status: ForestApiResponse["forests"][number]["banStatus"]
): boolean => {
  if (mode === "ALL") {
    return true;
  }

  return status === mode;
};

const getStatusClassName = (status: ForestApiResponse["forests"][number]["banStatus"]): string => {
  if (status === "NOT_BANNED") {
    return "allowed";
  }

  if (status === "BANNED") {
    return "banned";
  }

  return "unknown";
};

const getSolidFuelStatusLabel = (
  status: ForestApiResponse["forests"][number]["banStatus"]
): string => {
  if (status === "NOT_BANNED") {
    return "Solid fuel: not banned";
  }

  if (status === "BANNED") {
    return "Solid fuel: banned";
  }

  return "Solid fuel: unknown";
};

const getTotalFireBanStatusLabel = (
  status: ForestApiResponse["forests"][number]["totalFireBanStatus"]
): string => {
  if (status === "NOT_BANNED") {
    return "No Total Fire Ban";
  }

  if (status === "BANNED") {
    return "Total Fire Ban";
  }

  return "Total Fire Ban: unknown";
};

const getForestClosureStatus = (
  forest: ForestApiResponse["forests"][number]
): "NONE" | "NOTICE" | "PARTIAL" | "CLOSED" => {
  const status = forest.closureStatus;
  if (status === "NONE" || status === "NOTICE" || status === "PARTIAL" || status === "CLOSED") {
    return status;
  }

  return "NONE";
};

const getClosureStatusLabel = (status: "NONE" | "NOTICE" | "PARTIAL" | "CLOSED"): string => {
  if (status === "CLOSED") {
    return "Closed";
  }

  if (status === "PARTIAL") {
    return "Partial";
  }

  if (status === "NOTICE") {
    return "Notice";
  }

  return "No notice";
};

const CLOSURE_IMPACT_ORDER: Record<ClosureImpactLevel, number> = {
  NONE: 0,
  ADVISORY: 1,
  RESTRICTED: 2,
  CLOSED: 3,
  UNKNOWN: -1
};

const mergeImpactLevel = (
  leftImpact: ClosureImpactLevel,
  rightImpact: ClosureImpactLevel
): ClosureImpactLevel => {
  if (CLOSURE_IMPACT_ORDER[rightImpact] > CLOSURE_IMPACT_ORDER[leftImpact]) {
    return rightImpact;
  }

  return leftImpact;
};

const isImpactWarning = (impactLevel: ClosureImpactLevel): boolean =>
  impactLevel === "RESTRICTED" || impactLevel === "CLOSED";

type ForestImpactSummary = {
  campingImpact: ClosureImpactLevel;
  access2wdImpact: ClosureImpactLevel;
  access4wdImpact: ClosureImpactLevel;
};

const getForestImpactSummary = (
  forest: ForestApiResponse["forests"][number]
): ForestImpactSummary => {
  const summary = forest.closureImpactSummary;
  if (summary) {
    return {
      campingImpact: summary.campingImpact,
      access2wdImpact: summary.access2wdImpact,
      access4wdImpact: summary.access4wdImpact
    };
  }

  const fallback: ForestImpactSummary = {
    campingImpact: "NONE",
    access2wdImpact: "NONE",
    access4wdImpact: "NONE"
  };

  for (const notice of forest.closureNotices ?? []) {
    const impact = notice.structuredImpact;
    if (!impact) {
      continue;
    }

    fallback.campingImpact = mergeImpactLevel(fallback.campingImpact, impact.campingImpact);
    fallback.access2wdImpact = mergeImpactLevel(fallback.access2wdImpact, impact.access2wdImpact);
    fallback.access4wdImpact = mergeImpactLevel(fallback.access4wdImpact, impact.access4wdImpact);
  }

  return fallback;
};

type FacilityImpactTarget = "CAMPING" | "ACCESS_2WD" | "ACCESS_4WD" | null;

const inferFacilityImpactTarget = (
  facility: ForestApiResponse["availableFacilities"][number]
): FacilityImpactTarget => {
  const text = `${facility.iconKey} ${facility.label} ${facility.paramName}`.toLowerCase();

  if (/camp/.test(text)) {
    return "CAMPING";
  }

  if (/2wd|two.?wheel/.test(text)) {
    return "ACCESS_2WD";
  }

  if (/4wd|four.?wheel/.test(text)) {
    return "ACCESS_4WD";
  }

  return null;
};

const isClosureFilterMode = (value: unknown): value is ClosureFilterMode =>
  value === "ALL" ||
  value === "OPEN_ONLY" ||
  value === "NO_FULL_CLOSURES" ||
  value === "HAS_NOTICE";

const isTriStateMode = (value: unknown): value is TriStateMode =>
  value === "ANY" || value === "INCLUDE" || value === "EXCLUDE";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

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

    if (isBanFilterMode(rawPreferences.solidFuelBanFilterMode)) {
      preferences.solidFuelBanFilterMode = rawPreferences.solidFuelBanFilterMode;
    } else if (isLegacyBanFilterMode(rawPreferences.banFilterMode)) {
      preferences.solidFuelBanFilterMode = toModernBanFilterMode(rawPreferences.banFilterMode);
      preferences.banFilterMode = rawPreferences.banFilterMode;
    }

    if (isBanFilterMode(rawPreferences.totalFireBanFilterMode)) {
      preferences.totalFireBanFilterMode = rawPreferences.totalFireBanFilterMode;
    }

    if (isClosureFilterMode(rawPreferences.closureFilterMode)) {
      preferences.closureFilterMode = rawPreferences.closureFilterMode;
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

    if (
      typeof rawPreferences.closureTagFilterModes === "object" &&
      rawPreferences.closureTagFilterModes !== null
    ) {
      const nextClosureTagFilterModes: Record<string, TriStateMode> = {};
      for (const [key, mode] of Object.entries(rawPreferences.closureTagFilterModes)) {
        if (isTriStateMode(mode)) {
          nextClosureTagFilterModes[key] = mode;
        }
      }
      preferences.closureTagFilterModes = nextClosureTagFilterModes;
    }

    if (isTriStateMode(rawPreferences.impactCampingFilterMode)) {
      preferences.impactCampingFilterMode = rawPreferences.impactCampingFilterMode;
    }

    if (isTriStateMode(rawPreferences.impactAccessFilterMode)) {
      preferences.impactAccessFilterMode = rawPreferences.impactAccessFilterMode;
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

    if (isBoolean(rawPreferences.avoidTolls)) {
      preferences.avoidTolls = rawPreferences.avoidTolls;
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

const buildRefreshWebSocketUrl = (): string => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/api/refresh/ws`;
};

const buildForestsWebSocketUrl = (): string => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/api/forests/ws`;
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

  useEffect(() => {
    let isMounted = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let webSocket: WebSocket | null = null;

    const connect = () => {
      if (!isMounted) {
        return;
      }

      const webSocketUrl = buildRefreshWebSocketUrl();
      webSocket = new WebSocket(webSocketUrl);

      webSocket.addEventListener("message", (event) => {
        if (!isMounted) {
          return;
        }

        try {
          const payload = JSON.parse(event.data as string) as {
            type?: string;
            task?: RefreshTaskState;
          };

          if (payload.type === "refresh-task" && payload.task) {
            setRefreshTaskState(payload.task);
          }
        } catch {
          return;
        }
      });

      webSocket.addEventListener("close", () => {
        if (!isMounted) {
          return;
        }

        reconnectTimer = setTimeout(connect, 1500);
      });
    };

    connect();

    return () => {
      isMounted = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      webSocket?.close();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let webSocket: WebSocket | null = null;

    const connect = () => {
      if (!isMounted) {
        return;
      }

      const webSocketUrl = buildForestsWebSocketUrl();
      webSocket = new WebSocket(webSocketUrl);

      webSocket.addEventListener("message", (event) => {
        if (!isMounted) {
          return;
        }

        try {
          const payload = JSON.parse(event.data as string) as {
            type?: string;
            load?: ForestLoadProgressState;
          };

          if (payload.type === "forest-load-progress" && payload.load) {
            setForestLoadProgressState(payload.load);
          }
        } catch {
          return;
        }
      });

      webSocket.addEventListener("close", () => {
        if (!isMounted) {
          return;
        }

        reconnectTimer = setTimeout(connect, 1500);
      });
    };

    connect();

    return () => {
      isMounted = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      webSocket?.close();
    };
  }, []);

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

  const refreshTaskStatusText = useMemo(() => {
    if (!refreshTaskState || refreshTaskState.status === "IDLE") {
      return null;
    }

    if (refreshTaskState.status === "RUNNING") {
      const completed = refreshTaskState.progress?.completed;
      const total = refreshTaskState.progress?.total;
      const progressText =
        typeof completed === "number" && typeof total === "number"
          ? ` (${completed}/${total})`
          : "";
      return `Refresh in progress: ${refreshTaskState.message}${progressText}`;
    }

    if (refreshTaskState.status === "FAILED") {
      return `Refresh failed: ${refreshTaskState.error ?? "Unknown error"}`;
    }

    return "Refresh completed.";
  }, [refreshTaskState]);

  const refreshTaskProgress = useMemo(() => {
    if (!refreshTaskState || refreshTaskState.status !== "RUNNING") {
      return null;
    }

    const completed = refreshTaskState.progress?.completed ?? 0;
    const total = refreshTaskState.progress?.total;

    if (typeof total !== "number" || total <= 0) {
      return {
        phase: refreshTaskState.phase,
        completed,
        total: null,
        percentage: null
      };
    }

    return {
      phase: refreshTaskState.phase,
      completed,
      total,
      percentage: Math.max(0, Math.min(100, Math.round((completed / total) * 100)))
    };
  }, [refreshTaskState]);

  const forestLoadStatusText = useMemo(() => {
    if (!forestLoadProgressState || forestLoadProgressState.status === "IDLE") {
      return null;
    }

    if (forestLoadProgressState.status === "RUNNING") {
      const completed = forestLoadProgressState.progress?.completed;
      const total = forestLoadProgressState.progress?.total;
      const progressText =
        typeof completed === "number" && typeof total === "number"
          ? ` (${completed}/${total})`
          : "";
      return `Loading forests: ${forestLoadProgressState.message}${progressText}`;
    }

    if (forestLoadProgressState.status === "FAILED") {
      return `Forest load failed: ${forestLoadProgressState.error ?? "Unknown error"}`;
    }

    return "Forest load completed.";
  }, [forestLoadProgressState]);

  const forestLoadProgress = useMemo(() => {
    if (!forestLoadProgressState || forestLoadProgressState.status !== "RUNNING") {
      return null;
    }

    const completed = forestLoadProgressState.progress?.completed ?? 0;
    const total = forestLoadProgressState.progress?.total;

    if (typeof total !== "number" || total <= 0) {
      return {
        phase: forestLoadProgressState.phase,
        completed,
        total: null,
        percentage: null
      };
    }

    return {
      phase: forestLoadProgressState.phase,
      completed,
      total,
      percentage: Math.max(0, Math.min(100, Math.round((completed / total) * 100)))
    };
  }, [forestLoadProgressState]);

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

      {settingsOpen ? (
        <div
          className="warnings-overlay settings-overlay"
          data-testid="settings-overlay"
          role="presentation"
          onClick={closeSettingsDialog}
        >
          <section
            className="panel settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            data-testid="settings-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="warnings-dialog-header">
              <h2 id="settings-title">Route Settings</h2>
              <button type="button" onClick={closeSettingsDialog}>
                Close
              </button>
            </div>
            <p className="muted">
              Driving estimates use Google Routes traffic for the next Saturday at 10:00 AM
              (calculated at request time).
            </p>
            <fieldset className="settings-options">
              <legend>Toll roads</legend>
              <label className="settings-option">
                <input
                  type="radio"
                  name="toll-setting"
                  checked={avoidTolls}
                  onChange={() => setAvoidTolls(true)}
                  data-testid="settings-tolls-avoid"
                />
                <span>No tolls (default)</span>
              </label>
              <label className="settings-option">
                <input
                  type="radio"
                  name="toll-setting"
                  checked={!avoidTolls}
                  onChange={() => setAvoidTolls(false)}
                  data-testid="settings-tolls-allow"
                />
                <span>Allow toll roads</span>
              </label>
            </fieldset>
          </section>
        </div>
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

              {hasUnmappedForestWarning ? (
                <details
                  className="warnings-section warnings-section-collapsible"
                  data-testid="warnings-unmapped-section"
                  open
                >
                  <summary className="warnings-section-summary">
                    Unmapped Forests (Distance Unavailable)
                  </summary>
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
                </details>
              ) : null}

              {hasUnknownTotalFireBanWarning ? (
                <details
                  className="warnings-section warnings-section-collapsible"
                  data-testid="warnings-total-fire-ban-unknown-section"
                  open
                >
                  <summary className="warnings-section-summary">
                    Total Fire Ban Status Unknown
                  </summary>
                  <p className="muted">
                    {forestsWithUnknownTotalFireBan.length} forest(s) have unknown Total Fire Ban status.
                  </p>
                  <ul className="warning-list warning-list-detailed">
                    {forestsWithUnknownTotalFireBan.map((forest) => {
                      const debugEntries =
                        forest.totalFireBanDiagnostics?.debug?.length
                          ? forest.totalFireBanDiagnostics.debug
                          : ["No Total Fire Ban diagnostics were captured in this snapshot."];
                      const failureReason =
                        forest.totalFireBanDiagnostics?.reason ??
                        "Total Fire Ban status could not be determined from available source data.";

                      return (
                        <li key={`${forest.id}:total-fire-ban-unknown`} className="warning-list-item-detailed">
                          <div>
                            <a
                              href={buildTotalFireBanDetailsUrl(forest)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <mark className="warning-forest-highlight">{forest.forestName}</mark>
                            </a>{" "}
                            <span className="muted">(RFS Total Fire Ban details)</span>
                          </div>
                          <div className="muted">Reason: {failureReason}</div>
                          <details className="warning-debug">
                            <summary>Debug info</summary>
                            <ul className="warning-debug-list">
                              {debugEntries.map((entry, index) => (
                                <li key={`${forest.id}:total-fire-ban-debug:${index}`}>{entry}</li>
                              ))}
                            </ul>
                          </details>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ) : null}

              {generalWarnings.length > 0 ? (
                <details className="warnings-section warnings-section-collapsible" open>
                  <summary className="warnings-section-summary">General</summary>
                  <ul className="warning-list">
                    {generalWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {hasFacilitiesMismatchWarning || matchDiagnostics.unmatchedFacilitiesForests.length > 0 ? (
                <details className="warnings-section warnings-section-collapsible" open>
                  <summary className="warnings-section-summary">
                    Facilities Missing From Fire-Ban Pages
                  </summary>
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
                </details>
              ) : null}

              {hasFuzzyMatchesWarning || matchDiagnostics.fuzzyMatches.length > 0 ? (
                <details className="warnings-section warnings-section-collapsible" open>
                  <summary className="warnings-section-summary">Fuzzy Facilities Matching</summary>
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
                </details>
              ) : null}

              {closureDiagnostics.unmatchedNotices.length > 0 ? (
                <details className="warnings-section warnings-section-collapsible" open>
                  <summary className="warnings-section-summary">Unmatched Closure Notices</summary>
                  <p className="muted">
                    {closureDiagnostics.unmatchedNotices.length} closure notice(s) could not be matched to forests.
                  </p>
                  <ul className="warning-list">
                    {closureDiagnostics.unmatchedNotices.map((notice) => (
                      <li key={`unmatched-closure:${notice.id}`}>
                        <a href={notice.detailUrl} target="_blank" rel="noopener noreferrer">
                          {notice.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
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
