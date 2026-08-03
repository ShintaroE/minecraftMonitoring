import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ContainerStatsResponse, Server } from "../api/servers";
import { useMetricsSocket } from "../hooks/useMetricsSocket";
import { useRconPlayers } from "../hooks/useRconPlayers";
import { useContainerStats } from "../hooks/useContainerStats";
import { formatBytes } from "../lib/format";
import { CpuIcon, MemoryIcon } from "../components/icons";

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

function formatServerStat(
  server: Server | null,
  stats: ContainerStatsResponse | null,
  formatter: (s: Required<ContainerStatsResponse>) => string,
): string {
  if (!server || !stats) return "-";
  if (
    !stats.available ||
    typeof stats.cpuPercent !== "number" ||
    typeof stats.memUsedBytes !== "number" ||
    typeof stats.memUsedPercent !== "number"
  ) {
    return "停止中";
  }
  return formatter(stats as Required<ContainerStatsResponse>);
}

export function Dashboard({ server }: Props) {
  const { points, connected } = useMetricsSocket();
  const players = useRconPlayers(server?.id ?? null);
  const stats = useContainerStats(server?.id ?? null);
  const latest = points.at(-1);
  const hostLive = connected && latest;

  const serverCpuValue = formatServerStat(server, stats, (s) => `${s.cpuPercent.toFixed(1)}%`);
  const serverMemValue = formatServerStat(
    server,
    stats,
    (s) => `${s.memUsedPercent.toFixed(1)}%（${formatBytes(s.memUsedBytes)}）`,
  );

  return (
    <>
      <section className="stat-group">
        <h2 className="stat-group-title">サーバー全体</h2>
        <div className="stat-cards">
          <div className="stat-card">
            <span className="stat-icon">
              <CpuIcon />
            </span>
            <span className="stat-label">ホストCPU使用率</span>
            <span className="stat-value">
              {hostLive ? `${latest.cpuLoadPercent.toFixed(1)}%` : "-"}
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-icon">
              <MemoryIcon />
            </span>
            <span className="stat-label">ホストメモリ使用率</span>
            <span className="stat-value">
              {hostLive ? `${latest.memUsedPercent.toFixed(1)}%` : "-"}
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-icon">
              <MemoryIcon />
            </span>
            <span className="stat-label">ホストメモリ使用量</span>
            <span className="stat-value">
              {hostLive ? `${formatBytes(latest.memUsedBytes)} / ${formatBytes(latest.memTotalBytes)}` : "-"}
            </span>
          </div>
        </div>
      </section>

      <section className="stat-group">
        <h2 className="stat-group-title">マインクラフト</h2>
        <div className="stat-cards">
          <div className="stat-card">
            <span className="stat-icon">
              <CpuIcon />
            </span>
            <span className="stat-label">サーバーCPU使用率</span>
            <span className="stat-value">{serverCpuValue}</span>
          </div>
          <div className="stat-card">
            <span className="stat-icon">
              <MemoryIcon />
            </span>
            <span className="stat-label">サーバーメモリ使用率</span>
            <span className="stat-value">{serverMemValue}</span>
          </div>
        </div>
      </section>

      <section className="chart-container">
        <h2 className="stat-group-title">ホスト全体のCPU/メモリ推移</h2>
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

      <section className="players-table-section">
        <h2 className="stat-group-title">オンラインプレイヤー</h2>
        {players?.available ? (
          <>
            <p className="players-online-line">
              オンライン: {players.online} / {players.max}
            </p>
            <div className="players-table-wrap">
              <table className="players-table">
                <thead>
                  <tr>
                    <th>名前</th>
                  </tr>
                </thead>
                <tbody>
                  {players.names && players.names.length > 0 ? (
                    players.names.map((name) => (
                      <tr key={name}>
                        <td>{name}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td>誰もいません</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="players-online-line">プレイヤー情報を取得できません</p>
        )}
      </section>
    </>
  );
}
