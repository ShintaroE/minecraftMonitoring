import { useEffect, useState } from "react";
import { fetchServers, type Server } from "../api/servers";

const POLL_INTERVAL_MS = 10000;

export function useServers() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchServers();
        if (!cancelled) setServers(data);
      } catch {
        // 次のポーリングで再試行する
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return { servers, loading };
}
