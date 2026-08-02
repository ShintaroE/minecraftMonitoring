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
import { formatBytes } from "../lib/format";

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function Dashboard() {
  const { points, connected } = useMetricsSocket();
  const latest = points.at(-1);

  return (
    <>
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
    </>
  );
}
