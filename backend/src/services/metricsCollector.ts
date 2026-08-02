import si from "systeminformation";

export interface MetricsSnapshot {
  timestamp: number;
  cpuLoadPercent: number;
  memUsedPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
}

export async function getMetricsSnapshot(): Promise<MetricsSnapshot> {
  const [load, mem] = await Promise.all([si.currentLoad(), si.mem()]);
  return {
    timestamp: Date.now(),
    cpuLoadPercent: load.currentLoad,
    memUsedPercent: (mem.active / mem.total) * 100,
    memUsedBytes: mem.active,
    memTotalBytes: mem.total,
  };
}
