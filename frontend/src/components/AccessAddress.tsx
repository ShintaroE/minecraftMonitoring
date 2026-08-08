import { useState } from "react";
import type { Server } from "../api/servers";
import { CheckIcon, CopyIcon } from "./icons";

interface Props {
  server: Server | null;
  publicHost: string | null;
}

export function AccessAddress({ server, publicHost }: Props) {
  const [copied, setCopied] = useState(false);

  if (!server || !publicHost || !server.gamePort) return null;

  const address = `${publicHost}:${server.gamePort}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボードにアクセスできない環境では何もしない
    }
  }

  return (
    <button className="access-address" onClick={handleCopy} title="クリックしてコピー">
      <span className="access-address-value">{address}</span>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
