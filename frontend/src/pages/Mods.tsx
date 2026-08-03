import { useState } from "react";
import type { Server } from "../api/servers";
import { ModsManage } from "./ModsManage";
import { ModsHistory } from "./ModsHistory";

interface Props {
  server: Server | null;
}

type SubTab = "manage" | "history";

export function Mods({ server }: Props) {
  const [subTab, setSubTab] = useState<SubTab>("manage");

  return (
    <div>
      <nav className="tabs mods-subtabs">
        <button className={subTab === "manage" ? "active" : ""} onClick={() => setSubTab("manage")}>
          MOD管理
        </button>
        <button className={subTab === "history" ? "active" : ""} onClick={() => setSubTab("history")}>
          追加/削除履歴
        </button>
      </nav>

      {subTab === "manage" ? <ModsManage server={server} /> : <ModsHistory server={server} />}
    </div>
  );
}
