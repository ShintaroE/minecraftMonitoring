import { useEffect, useState } from "react";
import { Dashboard } from "./pages/Dashboard";
import { Files } from "./pages/Files";
import { ServerSwitcher } from "./components/ServerSwitcher";
import { ServerControls } from "./components/ServerControls";
import { useServers } from "./hooks/useServers";

type Tab = "dashboard" | "files";

function App() {
  const { servers, loading: serversLoading, refresh: refreshServers } = useServers();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const selectedServer = servers.find((s) => s.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId === null && servers.length > 0) {
      setSelectedId(servers[0].id);
    }
  }, [servers, selectedId]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-left">
          <div className="brand">
            <span className="brand-mark">⛏</span>
            <h1>minecraftMonitoring</h1>
          </div>
          <nav className="tabs">
            <button className={tab === "dashboard" ? "active" : ""} onClick={() => setTab("dashboard")}>
              ダッシュボード
            </button>
            <button className={tab === "files" ? "active" : ""} onClick={() => setTab("files")}>
              ファイル
            </button>
          </nav>
        </div>
        <div className="app-header-controls">
          <ServerSwitcher
            servers={servers}
            loading={serversLoading}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <ServerControls server={selectedServer} onChanged={refreshServers} />
        </div>
      </header>

      {tab === "dashboard" ? <Dashboard server={selectedServer} /> : <Files server={selectedServer} />}
    </div>
  );
}

export default App;
