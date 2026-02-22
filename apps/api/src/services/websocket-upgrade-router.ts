export type WebSocketServerKey = "refresh" | "forests";

const WEBSOCKET_PATH_BY_SERVER_KEY: Record<WebSocketServerKey, string> = {
  refresh: "/api/refresh/ws",
  forests: "/api/forests/ws"
};

export const resolveWebSocketServerKey = (
  requestUrl: string | undefined
): WebSocketServerKey | null => {
  if (!requestUrl) {
    return null;
  }

  let pathname = "";

  try {
    pathname = new URL(requestUrl, "http://localhost").pathname;
  } catch {
    return null;
  }

  for (const [serverKey, expectedPathname] of Object.entries(WEBSOCKET_PATH_BY_SERVER_KEY)) {
    if (pathname === expectedPathname) {
      return serverKey as WebSocketServerKey;
    }
  }

  return null;
};