import { useCallback, useEffect, useRef, useState } from "react";
import type { Server } from "../api/servers";
import { fetchFiles, renameFile, type FileEntry } from "../api/files";
import { deleteMod, uploadMod } from "../api/mods";
import { formatBytes, formatDateTime } from "../lib/format";
import { FileIcon, PowerIcon, TrashIcon, UploadIcon } from "../components/icons";

interface Props {
  server: Server | null;
}

const MODS_PATH = "mods";
const DISABLED_SUFFIX = ".disabled";

interface ModRow {
  entry: FileEntry;
  displayName: string;
  enabled: boolean;
}

function toModRow(entry: FileEntry): ModRow {
  if (entry.name.endsWith(DISABLED_SUFFIX)) {
    return { entry, displayName: entry.name.slice(0, -DISABLED_SUFFIX.length), enabled: false };
  }
  return { entry, displayName: entry.name, enabled: true };
}

export function ModsManage({ server }: Props) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!server) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFiles(server.id, MODS_PATH);
      setEntries(data.filter((e) => e.type === "file"));
    } catch {
      setError("MOD一覧の取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [server?.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpload(files: FileList | null) {
    if (!server || !files || files.length === 0) return;

    const fileList = Array.from(files);
    const invalid = fileList.filter((f) => !f.name.toLowerCase().endsWith(".jar"));
    if (invalid.length > 0) {
      setError(`${invalid.map((f) => f.name).join("、")} は .jar ファイルではないためアップロードできません。`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploading(true);
    setError(null);
    try {
      for (const file of fileList) {
        await uploadMod(server.id, file);
      }
      await load();
    } catch {
      setError("アップロードに失敗しました。");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleToggle(row: ModRow) {
    if (!server) return;
    const from = `${MODS_PATH}/${row.entry.name}`;
    const to = `${MODS_PATH}/${row.enabled ? `${row.entry.name}${DISABLED_SUFFIX}` : row.displayName}`;

    setBusyName(row.entry.name);
    setError(null);
    try {
      await renameFile(server.id, from, to);
      await load();
    } catch (err) {
      setError(
        err instanceof Error && err.message === "destination_exists"
          ? "既に同名のファイルが存在します。"
          : "有効/無効の切り替えに失敗しました。",
      );
    } finally {
      setBusyName(null);
    }
  }

  async function handleDelete(row: ModRow) {
    if (!server) return;
    if (!window.confirm(`「${row.displayName}」を削除します。よろしいですか？\n（.trash フォルダへ退避されます）`)) return;

    setBusyName(row.entry.name);
    setError(null);
    try {
      await deleteMod(server.id, row.entry.name);
      await load();
    } catch {
      setError("削除に失敗しました。");
    } finally {
      setBusyName(null);
    }
  }

  if (!server) {
    return <p className="files-empty">サーバーを選択してください。</p>;
  }

  const rows = entries.map(toModRow);

  return (
    <div className="files">
      <p className="mods-hint">MODの追加・削除・有効化/無効化を反映するには、サーバーの再起動が必要です。</p>

      <div className="files-toolbar">
        <div />
        <div className="files-toolbar-actions">
          <label className="btn btn-sm btn-primary upload-button">
            <UploadIcon />
            {uploading ? "アップロード中..." : "MODをアップロード"}
            <input
              ref={fileInputRef}
              type="file"
              accept=".jar"
              multiple
              disabled={uploading}
              onChange={(e) => handleUpload(e.target.files)}
            />
          </label>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="file-table-wrap">
        <table className="file-table">
          <thead>
            <tr>
              <th>名前</th>
              <th>状態</th>
              <th>サイズ</th>
              <th>更新日時</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5}>読み込み中...</td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5}>MODがありません。</td>
              </tr>
            )}
            {!loading &&
              rows.map((row) => (
                <tr key={row.entry.name}>
                  <td>
                    <span className="mod-name">
                      <FileIcon className="file-icon" />
                      {row.displayName}
                    </span>
                  </td>
                  <td>
                    <span className={`mod-status-badge ${row.enabled ? "enabled" : "disabled"}`}>
                      {row.enabled ? "有効" : "無効"}
                    </span>
                  </td>
                  <td className="col-size">{formatBytes(row.entry.size)}</td>
                  <td className="col-mtime">{formatDateTime(row.entry.mtime)}</td>
                  <td className="mod-row-actions">
                    <button
                      className="btn btn-icon btn-ghost"
                      title={row.enabled ? "無効化" : "有効化"}
                      aria-label={row.enabled ? "無効化" : "有効化"}
                      disabled={busyName !== null}
                      onClick={() => handleToggle(row)}
                    >
                      <PowerIcon />
                    </button>
                    <button
                      className="btn btn-icon btn-ghost danger-hover"
                      title="削除"
                      aria-label="削除"
                      disabled={busyName !== null}
                      onClick={() => handleDelete(row)}
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
