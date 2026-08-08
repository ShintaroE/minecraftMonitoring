import { useState } from "react";
import type { Server } from "../api/servers";
import { CheckIcon, CopyIcon } from "./icons";

interface Props {
  server: Server | null;
  publicHost: string | null;
}

// Clipboard API (navigator.clipboard) は secure context (HTTPS/localhost) でしか使えない。
// このアプリはVPN内でHTTP配信のため、非推奨だが互換性の高い execCommand('copy') にフォールバックする。
function legacyCopy(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // secure context でない場合などはフォールバックへ
    }
  }
  return legacyCopy(text);
}

export function AccessAddress({ server, publicHost }: Props) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  if (!server || !publicHost || !server.gamePort) return null;

  const address = `${publicHost}:${server.gamePort}`;

  async function handleCopy() {
    const ok = await copyText(address);
    setStatus(ok ? "copied" : "failed");
    setTimeout(() => setStatus("idle"), 1500);
  }

  return (
    <button
      className="access-address"
      onClick={handleCopy}
      title={status === "failed" ? "コピーに失敗しました" : "クリックしてコピー"}
    >
      <span className="access-address-value">
        {status === "failed" ? "コピー失敗" : address}
      </span>
      {status === "copied" ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
