import { useCallback, useEffect, useRef, useState } from "react";
import type { Server } from "../api/servers";
import { deleteFile, downloadUrl, downloadZipUrl, fetchFiles, renameFile, uploadFile, type FileEntry } from "../api/files";
import { formatBytes, formatDateTime } from "../lib/format";
import { ArchiveIcon, ChevronRightIcon, DownloadIcon, EditIcon, FileIcon, FolderIcon, MoveIcon, TrashIcon, UploadIcon } from "../components/icons";

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
  const [actionPending, setActionPending] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

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
    setSelected(new Set());
  }, [server?.id, currentPath]);

  useEffect(() => {
    load();
  }, [load]);

  const allNames = entries.map((e) => e.name);
  const allSelected = allNames.length > 0 && allNames.every((n) => selected.has(n));
  const someSelected = allNames.some((n) => selected.has(n));
  const selectedEntries = entries.filter((e) => selected.has(e.name));
  const singleSelected = selectedEntries.length === 1 ? selectedEntries[0] : null;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  function toggleOne(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allNames));
  }

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

  async function handleRenameSelected() {
    if (!server || !singleSelected) return;
    const entry = singleSelected;
    const newName = window.prompt("新しい名前を入力してください。", entry.name);
    if (!newName || newName === entry.name) return;

    setActionPending(true);
    setError(null);
    try {
      await renameFile(server.id, joinPath(currentPath, entry.name), joinPath(currentPath, newName));
      await load();
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error && err.message === "destination_exists" ? "同名のファイル/フォルダが既に存在します。" : "名前変更に失敗しました。");
    } finally {
      setActionPending(false);
    }
  }

  async function handleMoveSelected() {
    if (!server || !singleSelected) return;
    const entry = singleSelected;
    const currentFullPath = joinPath(currentPath, entry.name);
    const newFullPath = window.prompt(
      "移動先のパスを入力してください（フォルダも含めて指定できます）。",
      currentFullPath,
    );
    if (!newFullPath || newFullPath === currentFullPath) return;

    setActionPending(true);
    setError(null);
    try {
      await renameFile(server.id, currentFullPath, newFullPath);
      await load();
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error && err.message === "destination_exists" ? "移動先に同名のファイル/フォルダが既に存在します。" : "移動に失敗しました。");
    } finally {
      setActionPending(false);
    }
  }

  async function handleDeleteSelected() {
    if (!server || selectedEntries.length === 0) return;
    const count = selectedEntries.length;
    const message =
      count === 1
        ? `「${selectedEntries[0].name}」を削除します。よろしいですか？\n（.trash フォルダへ退避されます）`
        : `${count}件を削除します。よろしいですか？\n（.trash フォルダへ退避されます）`;
    if (!window.confirm(message)) return;

    setActionPending(true);
    setError(null);
    const results = await Promise.allSettled(
      selectedEntries.map((entry) => deleteFile(server.id, joinPath(currentPath, entry.name))),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      setError(`${count}件中${failed}件の削除に失敗しました。`);
    }
    await load();
    setSelected(new Set());
    setActionPending(false);
  }

  if (!server) {
    return <p className="files-empty">サーバーを選択してください。</p>;
  }

  const breadcrumbSegments = currentPath ? currentPath.split("/") : [];

  const canDownload = singleSelected !== null;
  const canRenameMove = singleSelected !== null;
  const canDelete = selectedEntries.length >= 1;
  const isDirSelected = singleSelected?.type === "directory";
  const downloadHref = !canDownload
    ? undefined
    : isDirSelected
      ? downloadZipUrl(server.id, joinPath(currentPath, singleSelected.name))
      : downloadUrl(server.id, joinPath(currentPath, singleSelected.name));

  return (
    <div className="files">
      <div className="files-toolbar">
        <nav className="breadcrumb">
          <button onClick={() => setCurrentPath("")}>{server.displayName}</button>
          {breadcrumbSegments.map((segment, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span className="breadcrumb-sep">
                <ChevronRightIcon width={13} height={13} />
              </span>
              <button onClick={() => setCurrentPath(breadcrumbSegments.slice(0, i + 1).join("/"))}>
                {segment}
              </button>
            </span>
          ))}
        </nav>
        <div className="files-toolbar-actions">
          {selected.size > 0 && <span className="selection-count">{selected.size}件選択中</span>}
          <div className="selection-actions">
            <a
              className={`btn btn-sm btn-outline${!canDownload || actionPending ? " btn-disabled-link" : ""}`}
              href={canDownload && !actionPending ? downloadHref : undefined}
              aria-disabled={!canDownload || actionPending}
              onClick={(e) => {
                if (!canDownload || actionPending) e.preventDefault();
              }}
            >
              {isDirSelected ? <ArchiveIcon /> : <DownloadIcon />}
              {isDirSelected ? "ZIPダウンロード" : "ダウンロード"}
            </a>
            <button
              className="btn btn-sm btn-outline"
              disabled={!canRenameMove || actionPending}
              onClick={handleRenameSelected}
            >
              <EditIcon />
              名前変更
            </button>
            <button
              className="btn btn-sm btn-outline"
              disabled={!canRenameMove || actionPending}
              onClick={handleMoveSelected}
            >
              <MoveIcon />
              移動
            </button>
            <button
              className="btn btn-sm btn-danger"
              disabled={!canDelete || actionPending}
              onClick={handleDeleteSelected}
            >
              <TrashIcon />
              削除
            </button>
          </div>
          <label className="btn btn-sm btn-primary upload-button">
            <UploadIcon />
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
      </div>

      {error && <p className="error">{error}</p>}

      <div className="file-table-wrap">
        <table className="file-table">
          <thead>
            <tr>
              <th className="col-checkbox">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={entries.length === 0}
                  aria-label="すべて選択"
                />
              </th>
              <th>名前</th>
              <th>サイズ</th>
              <th>更新日時</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4}>読み込み中...</td>
              </tr>
            )}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={4}>ファイルがありません。</td>
              </tr>
            )}
            {!loading &&
              entries.map((entry) => (
                <tr key={entry.name}>
                  <td className="col-checkbox">
                    <input
                      type="checkbox"
                      checked={selected.has(entry.name)}
                      onChange={() => toggleOne(entry.name)}
                      aria-label={`${entry.name}を選択`}
                    />
                  </td>
                  <td>
                    {entry.type === "directory" ? (
                      <button
                        className="file-link"
                        onClick={() => setCurrentPath(joinPath(currentPath, entry.name))}
                      >
                        <FolderIcon className="file-icon is-folder" />
                        {entry.name}
                      </button>
                    ) : (
                      <a
                        className="file-link"
                        href={downloadUrl(server.id, joinPath(currentPath, entry.name))}
                      >
                        <FileIcon className="file-icon" />
                        {entry.name}
                      </a>
                    )}
                  </td>
                  <td className="col-size">{entry.type === "file" ? formatBytes(entry.size) : "-"}</td>
                  <td className="col-mtime">{formatDateTime(entry.mtime)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
