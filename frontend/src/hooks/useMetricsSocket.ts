import { useEffect, useRef, useState } from "react";

export interface MetricsPoint {
  timestamp: number;
  cpuLoadPercent: number;
  memUsedPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
}

const MAX_POINTS = 60;
const RECONNECT_DELAY_MS = 3000;

export function useMetricsSocket() {
  const [points, setPoints] = useState<MetricsPoint[]>([]);
  const [connected, setConnected] = useState(false);
  const closedByClient = useRef(false);

  useEffect(() => {
    closedByClient.current = false;
    let socket: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${location.host}/ws/metrics`);

      socket.onopen = () => setConnected(true);

      socket.onmessage = (event) => {
        const point: MetricsPoint = JSON.parse(event.data);
        setPoints((prev) => [...prev.slice(-(MAX_POINTS - 1)), point]);
      };

      socket.onclose = () => {
        setConnected(false);
        if (!closedByClient.current) {
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };

      socket.onerror = () => socket.close();
    }

    connect();

    return () => {
      closedByClient.current = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  return { points, connected };
}
