import { useCallback, useEffect, useState } from "react";
import { fetchServers, type Server } from "../api/servers";

const POLL_INTERVAL_MS = 10000;

export function useServers() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchServers();
      setServers(data);
    } catch {
      // 次のポーリングで再試行する
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { servers, loading, refresh };
}
