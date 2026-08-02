import { useCallback, useEffect, useRef, useState } from "react";
import type { Server } from "../api/servers";
import { downloadUrl, fetchFiles, uploadFile, type FileEntry } from "../api/files";
import { formatBytes, formatDateTime } from "../lib/format";

interface Props {
  server: Server | null;
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

export function Files({ server }: Props) {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!server) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFiles(server.id, currentPath);
      setEntries(data);
    } catch {
      setError("一覧の取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [server, currentPath]);

  useEffect(() => {
    setCurrentPath("");
  }, [server?.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpload(files: FileList | null) {
    if (!server || !files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await uploadFile(server.id, currentPath, file);
      }
      await load();
    } catch {
      setError("アップロードに失敗しました。");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (!server) {
    return <p className="files-empty">サーバーを選択してください。</p>;
  }

  const breadcrumbSegments = currentPath ? currentPath.split("/") : [];

  return (
    <div className="files">
      <div className="files-toolbar">
        <nav className="breadcrumb">
          <button onClick={() => setCurrentPath("")}>{server.displayName}</button>
          {breadcrumbSegments.map((segment, i) => (
            <span key={i}>
              {" / "}
              <button onClick={() => setCurrentPath(breadcrumbSegments.slice(0, i + 1).join("/"))}>
                {segment}
              </button>
            </span>
          ))}
        </nav>
        <label className="upload-button">
          {uploading ? "アップロード中..." : "アップロード"}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            disabled={uploading}
            onChange={(e) => handleUpload(e.target.files)}
          />
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      <table className="file-table">
        <thead>
          <tr>
            <th>名前</th>
            <th>サイズ</th>
            <th>更新日時</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={3}>読み込み中...</td>
            </tr>
          )}
          {!loading && entries.length === 0 && (
            <tr>
              <td colSpan={3}>ファイルがありません。</td>
            </tr>
          )}
          {!loading &&
            entries.map((entry) => (
              <tr key={entry.name}>
                <td>
                  {entry.type === "directory" ? (
                    <button
                      className="file-link"
                      onClick={() => setCurrentPath(joinPath(currentPath, entry.name))}
                    >
                      📁 {entry.name}
                    </button>
                  ) : (
                    <a
                      className="file-link"
                      href={downloadUrl(server.id, joinPath(currentPath, entry.name))}
                    >
                      📄 {entry.name}
                    </a>
                  )}
                </td>
                <td>{entry.type === "file" ? formatBytes(entry.size) : "-"}</td>
                <td>{formatDateTime(entry.mtime)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
