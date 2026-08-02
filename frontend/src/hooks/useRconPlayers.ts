import { useEffect, useState } from "react";
import { fetchPlayerList, type PlayerListResponse } from "../api/rcon";

const POLL_INTERVAL_MS = 15000;

export function useRconPlayers(serverId: number | null) {
  const [data, setData] = useState<PlayerListResponse | null>(null);

  useEffect(() => {
    if (serverId === null) {
      setData(null);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const result = await fetchPlayerList(serverId!);
        if (!cancelled) setData(result);
      } catch {
        if (!cancelled) setData({ available: false });
      }
    }

    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [serverId]);

  return data;
}
