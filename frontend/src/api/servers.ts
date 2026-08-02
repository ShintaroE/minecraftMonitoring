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

export type ServerAction = "start" | "stop" | "restart";

export async function controlServer(id: number, action: ServerAction): Promise<void> {
  const res = await fetch(`/api/servers/${id}/${action}`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`failed to ${action} server: ${res.status}`);
}
