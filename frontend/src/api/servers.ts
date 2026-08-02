export interface Server {
  id: number;
  containerName: string;
  displayName: string;
  dataPath: string;
  state: string;
  sortOrder: number;
  isArchived: boolean;
}

export async function fetchServers(): Promise<Server[]> {
  const res = await fetch("/api/servers", { credentials: "include" });
  if (!res.ok) throw new Error(`failed to fetch servers: ${res.status}`);
  return res.json();
}
