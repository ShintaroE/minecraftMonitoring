import { docker } from "./dockerClient.js";
import { getHostTotalMemoryBytes } from "./metricsCollector.js";

export interface ContainerStatsResult {
  cpuPercent: number;
  memUsedBytes: number;
  memUsedPercent: number;
}

function computeCpuPercent(stats: {
  cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number };
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number };
}): number {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = (stats.cpu_stats.system_cpu_usage ?? 0) - (stats.precpu_stats.system_cpu_usage ?? 0);
  if (systemDelta <= 0 || cpuDelta <= 0) return 0;
  // onlineCpusを掛けないことで、ホスト側 systeminformation.currentLoad() と同じ
  // 「ホスト全体に対する割合(0-100%)」スケールに揃える。
  return (cpuDelta / systemDelta) * 100;
}

/**
 * コンテナが停止中・存在しない・取得失敗の場合は null を返す（任意機能として扱う）。
 * 停止直後などは dockerode の stats() が例外を投げずに memory_stats が欠けたレスポンスを
 * 返すことがあるため、値の妥当性(有限数か)も明示的に検証する。
 */
export async function getContainerStats(containerName: string): Promise<ContainerStatsResult | null> {
  try {
    const [stats, hostTotalMemBytes] = await Promise.all([
      docker.getContainer(containerName).stats({ stream: false }),
      getHostTotalMemoryBytes(),
    ]);

    const rawUsage = stats.memory_stats?.usage;
    if (typeof rawUsage !== "number" || !Number.isFinite(rawUsage)) {
      return null;
    }

    const memUsedBytes = rawUsage - (stats.memory_stats.stats?.cache ?? 0);
    const memUsedPercent = (memUsedBytes / hostTotalMemBytes) * 100;
    const cpuPercent = computeCpuPercent(stats);

    if (!Number.isFinite(memUsedBytes) || !Number.isFinite(memUsedPercent) || !Number.isFinite(cpuPercent)) {
      return null;
    }

    return { cpuPercent, memUsedBytes, memUsedPercent };
  } catch {
    return null;
  }
}
