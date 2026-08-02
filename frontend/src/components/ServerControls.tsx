import { useState } from "react";
import { controlServer, type Server, type ServerAction } from "../api/servers";
import { PlayIcon, RestartIcon, StopIcon } from "./icons";

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
      <button
        className="btn btn-sm btn-success"
        disabled={isRunning || pending !== null}
        onClick={() => run("start")}
      >
        <PlayIcon />
        {pending === "start" ? "起動中..." : "起動"}
      </button>
      <button
        className="btn btn-sm btn-danger"
        disabled={!isRunning || pending !== null}
        onClick={() => run("stop")}
      >
        <StopIcon />
        {pending === "stop" ? "停止中..." : "停止"}
      </button>
      <button
        className="btn btn-sm btn-outline"
        disabled={!isRunning || pending !== null}
        onClick={() => run("restart")}
      >
        <RestartIcon />
        {pending === "restart" ? "再起動中..." : "再起動"}
      </button>
    </div>
  );
}
