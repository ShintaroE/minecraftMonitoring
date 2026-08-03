import { useEffect, useState } from "react";
import { fetchContainerStats, type ContainerStatsResponse } from "../api/servers";

const POLL_INTERVAL_MS = 3000;

export function useContainerStats(serverId: number | null) {
  const [data, setData] = useState<ContainerStatsResponse | null>(null);

  useEffect(() => {
    if (serverId === null) {
      setData(null);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const result = await fetchContainerStats(serverId!);
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
