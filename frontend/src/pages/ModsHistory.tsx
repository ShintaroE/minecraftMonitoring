import { useEffect, useState } from "react";
import type { Server } from "../api/servers";
import { fetchModHistory, modHistoryDownloadUrl, modHistoryDownloadZipUrl, type ModEvent } from "../api/mods";
import { formatBytes } from "../lib/format";
import { ArchiveIcon, DownloadIcon } from "../components/icons";

interface Props {
  server: Server | null;
}

interface DateGroup {
  dateLabel: string;
  added: ModEvent[];
  deleted: ModEvent[];
}

function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function groupByDate(events: ModEvent[]): DateGroup[] {
  const groups: DateGroup[] = [];
  const byLabel = new Map<string, DateGroup>();

  for (const event of events) {
    const dateLabel = new Date(event.createdAt).toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    });

    let group = byLabel.get(dateLabel);
    if (!group) {
      group = { dateLabel, added: [], deleted: [] };
      byLabel.set(dateLabel, group);
      groups.push(group);
    }

    if (event.eventType === "added") group.added.push(event);
    else group.deleted.push(event);
  }

  return groups;
}

export function ModsHistory({ server }: Props) {
  const [events, setEvents] = useState<ModEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!server) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchModHistory(server.id)
      .then((data) => {
        if (!cancelled) setEvents(data);
      })
      .catch(() => {
        if (!cancelled) setError("履歴の取得に失敗しました。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [server?.id]);

  if (!server) {
    return <p className="files-empty">サーバーを選択してください。</p>;
  }

  if (loading) {
    return <p className="files-empty">読み込み中...</p>;
  }

  if (error) {
    return <p className="error">{error}</p>;
  }

  const groups = groupByDate(events);

  if (groups.length === 0) {
    return <p className="files-empty">MOD管理タブでのアップロード・削除の履歴はまだありません。</p>;
  }

  return (
    <div className="mod-history">
      {groups.map((group) => (
        <div className="mod-history-card" key={group.dateLabel}>
          <div className="mod-history-date-row">
            <h2 className="mod-history-date">{group.dateLabel}</h2>
            {group.added.length > 0 && (
              <a
                className="btn btn-sm btn-outline"
                href={modHistoryDownloadZipUrl(
                  server.id,
                  group.added.map((e) => e.id),
                )}
              >
                <ArchiveIcon />
                この日の追加分を一括ダウンロード
              </a>
            )}
          </div>

          {group.added.length > 0 && (
            <div className="mod-history-section">
              <h3 className="mod-history-section-title added">追加（{group.added.length}件）</h3>
              <ul className="mod-history-list">
                {group.added.map((event) => (
                  <li className="mod-history-row" key={event.id}>
                    <span className="mod-history-name">{event.fileName}</span>
                    <span className="mod-history-meta">{formatBytes(event.fileSize)}</span>
                    <span className="mod-history-meta">{formatEventTime(event.createdAt)}</span>
                    <a
                      className="btn btn-icon btn-ghost"
                      title="ダウンロード"
                      aria-label="ダウンロード"
                      href={modHistoryDownloadUrl(server.id, event.id)}
                    >
                      <DownloadIcon />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {group.deleted.length > 0 && (
            <div className="mod-history-section">
              <h3 className="mod-history-section-title deleted">削除（{group.deleted.length}件）</h3>
              <ul className="mod-history-list">
                {group.deleted.map((event) => (
                  <li className="mod-history-row" key={event.id}>
                    <span className="mod-history-name">{event.fileName}</span>
                    <span className="mod-history-meta">{formatBytes(event.fileSize)}</span>
                    <span className="mod-history-meta">{formatEventTime(event.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
