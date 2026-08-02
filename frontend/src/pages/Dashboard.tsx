import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Server } from "../api/servers";
import { useMetricsSocket } from "../hooks/useMetricsSocket";
import { useRconPlayers } from "../hooks/useRconPlayers";
import { formatBytes } from "../lib/format";
import { CpuIcon, MemoryIcon, UsersIcon, WifiIcon } from "../components/icons";

interface Props {
  server: Server | null;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function Dashboard({ server }: Props) {
  const { points, connected } = useMetricsSocket();
  const players = useRconPlayers(server?.id ?? null);
  const latest = points.at(-1);

  return (
    <>
      <section className="stat-cards">
        <div className="stat-card">
          <span className="stat-icon">
            <WifiIcon />
          </span>
          <span className="stat-label">接続状態</span>
          <span className="stat-value">{connected ? "接続中" : "再接続中..."}</span>
        </div>
        <div className="stat-card">
          <span className="stat-icon">
            <CpuIcon />
          </span>
          <span className="stat-label">CPU使用率</span>
          <span className="stat-value">
            {latest ? `${latest.cpuLoadPercent.toFixed(1)}%` : "-"}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-icon">
            <MemoryIcon />
          </span>
          <span className="stat-label">メモリ使用率</span>
          <span className="stat-value">
            {latest ? `${latest.memUsedPercent.toFixed(1)}%` : "-"}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-icon">
            <MemoryIcon />
          </span>
          <span className="stat-label">メモリ使用量</span>
          <span className="stat-value">
            {latest ? `${formatBytes(latest.memUsedBytes)} / ${formatBytes(latest.memTotalBytes)}` : "-"}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-icon">
            <UsersIcon />
          </span>
          <span className="stat-label">オンラインプレイヤー</span>
          <span className="stat-value">
            {players?.available ? `${players.online} / ${players.max}` : "取得不可"}
          </span>
          {players?.available && players.names && players.names.length > 0 && (
            <span className="stat-sub">{players.names.join(", ")}</span>
          )}
        </div>
      </section>

      <section className="chart-container">
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={points}>
            <defs>
              <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="memFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--success)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatTime}
              minTickGap={40}
              stroke="var(--text-muted)"
              tick={{ fontSize: 12 }}
            />
            <YAxis domain={[0, 100]} unit="%" stroke="var(--text-muted)" tick={{ fontSize: 12 }} />
            <Tooltip
              labelFormatter={(v) => formatTime(Number(v))}
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                fontSize: 13,
              }}
            />
            <Area
              type="monotone"
              dataKey="cpuLoadPercent"
              name="CPU %"
              stroke="var(--accent)"
              strokeWidth={2}
              fill="url(#cpuFill)"
              dot={false}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="memUsedPercent"
              name="メモリ %"
              stroke="var(--success)"
              strokeWidth={2}
              fill="url(#memFill)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </section>
    </>
  );
}
