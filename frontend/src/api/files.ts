export interface FileEntry {
  name: string;
  type: "file" | "directory";
  size: number;
  mtime: number;
}

export async function fetchFiles(serverId: number, dirPath: string): Promise<FileEntry[]> {
  const res = await fetch(`/api/servers/${serverId}/files?path=${encodeURIComponent(dirPath)}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`failed to list files: ${res.status}`);
  return res.json();
}

export function downloadUrl(serverId: number, filePath: string): string {
  return `/api/servers/${serverId}/files/download?path=${encodeURIComponent(filePath)}`;
}

export function downloadZipUrl(serverId: number, dirPath: string): string {
  return `/api/servers/${serverId}/files/download-zip?path=${encodeURIComponent(dirPath)}`;
}

export async function uploadFile(serverId: number, dirPath: string, file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/servers/${serverId}/files/upload?path=${encodeURIComponent(dirPath)}`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) throw new Error(`failed to upload ${file.name}: ${res.status}`);
}

export async function renameFile(serverId: number, from: string, to: string): Promise<void> {
  const res = await fetch(`/api/servers/${serverId}/files/rename`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  });
  if (!res.ok) {
    if (res.status === 409) throw new Error("destination_exists");
    throw new Error(`failed to rename: ${res.status}`);
  }
}

export async function deleteFile(serverId: number, filePath: string): Promise<void> {
  const res = await fetch(`/api/servers/${serverId}/files?path=${encodeURIComponent(filePath)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`failed to delete: ${res.status}`);
}
