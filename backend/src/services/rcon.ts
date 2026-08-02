import fs from "node:fs/promises";
import { Rcon } from "rcon-client";
import { dataRootFor, resolveServerPath, assertRealPathWithinRoot } from "./fsSafe.js";

const RCON_PORT = 25575;
const RCON_ENV_FILE = ".rcon-cli.env";
const CONNECT_TIMEOUT_MS = 2000;

export interface PlayerListResult {
  online: number;
  max: number;
  names: string[];
}

// itzgイメージが自動生成する .rcon-cli.env（"password=xxxx" 形式）からRCONパスワードを読み取る。
async function readRconPassword(dataPath: string): Promise<string | null> {
  const root = dataRootFor(dataPath);
  const target = resolveServerPath(dataPath, RCON_ENV_FILE);
  await assertRealPathWithinRoot(target, root);

  const content = await fs.readFile(target, "utf8").catch(() => null);
  if (!content) return null;

  const match = content.match(/^password=(.*)$/m);
  return match?.[1]?.trim() ?? null;
}

function parsePlayerList(response: string): PlayerListResult {
  const match = response.match(/There are (\d+) of a max of (\d+) players online:\s*(.*)/);
  if (!match) return { online: 0, max: 0, names: [] };

  const [, online, max, namesPart] = match;
  const names = namesPart ? namesPart.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return { online: Number(online), max: Number(max), names };
}

/** RCON未設定・未起動・接続不可の場合は null を返す（任意機能のため呼び出し側でエラー扱いしない）。 */
export async function fetchPlayerList(
  containerName: string,
  dataPath: string,
): Promise<PlayerListResult | null> {
  const password = await readRconPassword(dataPath);
  if (!password) return null;

  let rcon: Rcon;
  try {
    rcon = await Rcon.connect({
      host: containerName,
      port: RCON_PORT,
      password,
      timeout: CONNECT_TIMEOUT_MS,
    });
  } catch {
    return null;
  }

  try {
    const response = await rcon.send("list");
    return parsePlayerList(response);
  } catch {
    return null;
  } finally {
    await rcon.end().catch(() => {});
  }
}
