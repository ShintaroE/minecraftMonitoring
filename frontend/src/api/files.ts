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
