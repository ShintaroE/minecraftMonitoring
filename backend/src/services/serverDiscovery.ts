import { sql } from "drizzle-orm";
import { docker } from "./dockerClient.js";
import { db } from "../db/client.js";
import { servers } from "../db/schema.js";

const ENABLE_LABEL = "mcmonitor.enable";
const DATA_PATH_LABEL = "mcmonitor.data_path";

export interface DiscoveredServer {
  id: number;
  containerName: string;
  displayName: string;
  dataPath: string;
  state: string;
  sortOrder: number;
  isArchived: boolean;
}

export async function discoverAndSyncServers(): Promise<DiscoveredServer[]> {
  const containers = await docker.listContainers({
    all: true,
    filters: JSON.stringify({ label: [`${ENABLE_LABEL}=true`] }),
  });

  const results: DiscoveredServer[] = [];

  for (const container of containers) {
    const containerName = container.Names[0]?.replace(/^\//, "");
    const dataPath = container.Labels[DATA_PATH_LABEL];
    if (!containerName || !dataPath) continue;

    const [row] = await db
      .insert(servers)
      .values({ containerName, displayName: containerName, dataPath })
      .onConflictDoUpdate({
        target: servers.containerName,
        // インフラ側の実体パスは常に同期。表示名や並び順はユーザーが後で編集できるよう上書きしない。
        set: { dataPath: sql`excluded.data_path` },
      })
      .returning();

    if (!row) continue;

    results.push({
      id: row.id,
      containerName: row.containerName,
      displayName: row.displayName,
      dataPath: row.dataPath,
      state: container.State,
      sortOrder: row.sortOrder,
      isArchived: row.isArchived,
    });
  }

  return results.sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName));
}
