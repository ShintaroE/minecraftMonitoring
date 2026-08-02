export interface PlayerListResponse {
  available: boolean;
  online?: number;
  max?: number;
  names?: string[];
}

export async function fetchPlayerList(serverId: number): Promise<PlayerListResponse> {
  const res = await fetch(`/api/servers/${serverId}/rcon/players`, { credentials: "include" });
  if (!res.ok) throw new Error(`failed to fetch player list: ${res.status}`);
  return res.json();
}
