import { useState } from "react";
import { controlServer, type Server, type ServerAction } from "../api/servers";

interface Props {
  server: Server | null;
  onChanged: () => void;
}

const CONFIRM_MESSAGE: Record<ServerAction, string | null> = {
  start: null,
  stop: "サーバーを停止します。よろしいですか？",
  restart: "サーバーを再起動します。プレイヤーは一時的に切断されます。よろしいですか？",
};

export function ServerControls({ server, onChanged }: Props) {
  const [pending, setPending] = useState<ServerAction | null>(null);

  if (!server) return null;

  const isRunning = server.state === "running";

  async function run(action: ServerAction) {
    const message = CONFIRM_MESSAGE[action];
    if (message && !window.confirm(message)) return;

    setPending(action);
    try {
      await controlServer(server!.id, action);
      onChanged();
    } catch {
      window.alert(`${action}に失敗しました。`);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="server-controls">
      <button disabled={isRunning || pending !== null} onClick={() => run("start")}>
        {pending === "start" ? "起動中..." : "起動"}
      </button>
      <button disabled={!isRunning || pending !== null} onClick={() => run("stop")}>
        {pending === "stop" ? "停止中..." : "停止"}
      </button>
      <button disabled={!isRunning || pending !== null} onClick={() => run("restart")}>
        {pending === "restart" ? "再起動中..." : "再起動"}
      </button>
    </div>
  );
}
