export interface ModEvent {
  id: number;
  serverId: number;
  eventType: "added" | "deleted";
  fileName: string;
  fileSize: number;
  createdAt: string;
}

export async function uploadMod(serverId: number, file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/servers/${serverId}/mods/upload`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) throw new Error(`failed to upload mod: ${res.status}`);
}

export async function deleteMod(serverId: number, fileName: string): Promise<void> {
  const res = await fetch(`/api/servers/${serverId}/mods/${encodeURIComponent(fileName)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`failed to delete mod: ${res.status}`);
}

export async function fetchModHistory(serverId: number): Promise<ModEvent[]> {
  const res = await fetch(`/api/servers/${serverId}/mods/history`, { credentials: "include" });
  if (!res.ok) throw new Error(`failed to fetch mod history: ${res.status}`);
  return res.json();
}

export function modHistoryDownloadUrl(serverId: number, eventId: number): string {
  return `/api/servers/${serverId}/mods/history/${eventId}/download`;
}

export function modHistoryDownloadZipUrl(serverId: number, eventIds: number[]): string {
  return `/api/servers/${serverId}/mods/history/download-zip?eventIds=${eventIds.join(",")}`;
}
