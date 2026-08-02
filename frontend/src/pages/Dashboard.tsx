import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMetricsSocket } from "../hooks/useMetricsSocket";
import { useServers } from "../hooks/useServers";
import { ServerSwitcher } from "../components/ServerSwitcher";
import { ServerControls } from "../components/ServerControls";

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return `${gb.toFixed(1)} GB`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function Dashboard() {
  const { points, connected } = useMetricsSocket();
  const { servers, loading: serversLoading, refresh: refreshServers } = useServers();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const latest = points.at(-1);
  const selectedServer = servers.find((s) => s.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId === null && servers.length > 0) {
      setSelectedId(servers[0].id);
    }
  }, [servers, selectedId]);

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>minecraftMonitoring</h1>
        <div className="dashboard-header-controls">
          <ServerSwitcher
            servers={servers}
            loading={serversLoading}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <ServerControls server={selectedServer} onChanged={refreshServers} />
        </div>
      </header>

      <section className="stat-cards">
        <div className="stat-card">
          <span className="stat-label">接続状態</span>
          <span className="stat-value">{connected ? "接続中" : "再接続中..."}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">CPU使用率</span>
          <span className="stat-value">
            {latest ? `${latest.cpuLoadPercent.toFixed(1)}%` : "-"}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">メモリ使用率</span>
          <span className="stat-value">
            {latest ? `${latest.memUsedPercent.toFixed(1)}%` : "-"}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">メモリ使用量</span>
          <span className="stat-value">
            {latest ? `${formatBytes(latest.memUsedBytes)} / ${formatBytes(latest.memTotalBytes)}` : "-"}
          </span>
        </div>
      </section>

      <section className="chart-container">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="timestamp" tickFormatter={formatTime} minTickGap={40} />
            <YAxis domain={[0, 100]} unit="%" />
            <Tooltip labelFormatter={(v) => formatTime(Number(v))} />
            <Line type="monotone" dataKey="cpuLoadPercent" name="CPU %" stroke="#2563eb" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="memUsedPercent" name="メモリ %" stroke="#16a34a" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </section>
    </div>
  );
}
