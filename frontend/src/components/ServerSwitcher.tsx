import type { Server } from "../api/servers";

interface Props {
  servers: Server[];
  loading: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export function ServerSwitcher({ servers, loading, selectedId, onSelect }: Props) {
  if (loading && servers.length === 0) {
    return <span className="server-switcher-empty">サーバーを検出中...</span>;
  }

  if (servers.length === 0) {
    return <span className="server-switcher-empty">サーバーが見つかりません</span>;
  }

  const selected = servers.find((s) => s.id === selectedId);

  return (
    <div className="server-switcher-wrap">
      <span className={`status-dot ${selected?.state === "running" ? "running" : "stopped"}`} />
      <select
        className="server-switcher"
        value={selectedId ?? ""}
        onChange={(e) => onSelect(Number(e.target.value))}
      >
        {servers.map((server) => (
          <option key={server.id} value={server.id}>
            {server.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}
