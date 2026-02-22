import { useEffect, useRef } from "react";

interface UseReconnectingWebSocketOptions<Message> {
  webSocketUrl: string;
  reconnectDelayMs?: number;
  onMessage: (message: Message) => void;
  isEnabled?: boolean;
}

const parseWebSocketMessage = <Message,>(rawData: unknown): Message | null => {
  if (typeof rawData !== "string") {
    return null;
  }

  try {
    return JSON.parse(rawData) as Message;
  } catch {
    return null;
  }
};

export const useReconnectingWebSocket = <Message,>({
  webSocketUrl,
  reconnectDelayMs = 1500,
  onMessage,
  isEnabled = true
}: UseReconnectingWebSocketOptions<Message>) => {
  const onMessageReference = useRef(onMessage);

  useEffect(() => {
    onMessageReference.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!isEnabled) {
      return;
    }

    let isMounted = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let webSocket: WebSocket | null = null;

    const connect = () => {
      if (!isMounted) {
        return;
      }

      webSocket = new WebSocket(webSocketUrl);

      webSocket.addEventListener("message", (event) => {
        if (!isMounted) {
          return;
        }

        const parsedMessage = parseWebSocketMessage<Message>(event.data);
        if (!parsedMessage) {
          return;
        }

        onMessageReference.current(parsedMessage);
      });

      webSocket.addEventListener("close", () => {
        if (!isMounted) {
          return;
        }

        reconnectTimer = setTimeout(connect, reconnectDelayMs);
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
  }, [isEnabled, reconnectDelayMs, webSocketUrl]);
};
