export const buildRefreshWebSocketUrl = (): string => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/api/refresh/ws`;
};

export const buildForestsWebSocketUrl = (): string => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/api/forests/ws`;
};
