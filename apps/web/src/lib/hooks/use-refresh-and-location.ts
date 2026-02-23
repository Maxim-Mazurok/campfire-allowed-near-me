import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ApiWebSocketMessage } from "../../../../../packages/shared/src/websocket.js";
import {
  fetchForests,
  fetchRefreshTaskStatus,
  type ForestLoadProgressState,
  type RefreshTaskState
} from "../api";
import { buildForestsQueryKey, isStaticMode, type UserLocation } from "../forests-query";
import {
  buildForestsWebSocketUrl,
  buildRefreshWebSocketUrl
} from "../app-domain-websocket";
import { useReconnectingWebSocket } from "./use-reconnecting-websocket";

export type UseRefreshAndLocationResult = {
  locationError: string | null;
  refreshTaskState: RefreshTaskState | null;
  forestLoadProgressState: ForestLoadProgressState | null;
  refreshFromSource: () => void;
  requestLocation: (options?: { silent?: boolean }) => void;
};

export const useRefreshAndLocation = ({
  queryClient,
  forestsQueryKey,
  userLocation,
  setUserLocation,
  avoidTolls,
  payloadRefreshTask
}: {
  queryClient: QueryClient;
  forestsQueryKey: readonly unknown[];
  userLocation: UserLocation | null;
  setUserLocation: (userLocation: UserLocation | null) => void;
  avoidTolls: boolean;
  payloadRefreshTask?: RefreshTaskState;
}): UseRefreshAndLocationResult => {
  const [locationError, setLocationError] = useState<string | null>(null);
  const [refreshTaskState, setRefreshTaskState] = useState<RefreshTaskState | null>(null);
  const [forestLoadProgressState, setForestLoadProgressState] =
    useState<ForestLoadProgressState | null>(null);
  const refreshStatusPollTimerReference = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearRefreshStatusPollTimer = () => {
    if (refreshStatusPollTimerReference.current) {
      clearInterval(refreshStatusPollTimerReference.current);
      refreshStatusPollTimerReference.current = null;
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

    if (refreshStatusPollTimerReference.current) {
      return;
    }

    refreshStatusPollTimerReference.current = setInterval(() => {
      syncRefreshTaskState();
    }, 1500);
  };

  useEffect(() => {
    if (!payloadRefreshTask) {
      return;
    }

    setRefreshTaskState(payloadRefreshTask);
  }, [payloadRefreshTask]);

  useReconnectingWebSocket<ApiWebSocketMessage>({
    webSocketUrl: buildRefreshWebSocketUrl(),
    isEnabled: !isStaticMode,
    onMessage: (message) => {
      if (message.type === "refresh-task") {
        setRefreshTaskState(message.task);
      }
    }
  });

  useReconnectingWebSocket<ApiWebSocketMessage>({
    webSocketUrl: buildForestsWebSocketUrl(),
    isEnabled: !isStaticMode,
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
      (geolocationError) => {
        if (!options?.silent) {
          setLocationError(`Unable to read your location: ${geolocationError.message}`);
        }
      }
    );
  };

  useEffect(() => {
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

    void requestLocationIfPermissionGranted();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    locationError,
    refreshTaskState,
    forestLoadProgressState,
    refreshFromSource,
    requestLocation
  };
};
