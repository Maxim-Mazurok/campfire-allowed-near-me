import { describe, expect, it } from "vitest";
import { resolveWebSocketServerKey } from "../../apps/api/src/services/websocket-upgrade-router.js";

describe("resolveWebSocketServerKey", () => {
  it("maps refresh websocket path", () => {
    const serverKey = resolveWebSocketServerKey("/api/refresh/ws");
    expect(serverKey).toBe("refresh");
  });

  it("maps forests websocket path", () => {
    const serverKey = resolveWebSocketServerKey("/api/forests/ws");
    expect(serverKey).toBe("forests");
  });

  it("ignores query string while matching websocket path", () => {
    const serverKey = resolveWebSocketServerKey("/api/forests/ws?transport=websocket");
    expect(serverKey).toBe("forests");
  });

  it("returns null for unknown or invalid paths", () => {
    expect(resolveWebSocketServerKey("/api/forests")).toBeNull();
    expect(resolveWebSocketServerKey("not a url")).toBeNull();
    expect(resolveWebSocketServerKey(undefined)).toBeNull();
  });
});