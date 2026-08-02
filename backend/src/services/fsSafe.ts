import path from "node:path";
import fs from "node:fs/promises";
import { env } from "../env.js";

export class PathViolationError extends Error {}

export function dataRootFor(dataPath: string): string {
  return path.resolve(env.SHARED_ROOT, dataPath);
}

/**
 * `dataPath`（サーバーごとの共有ルート配下の相対パス）を基準に、
 * ユーザー指定の相対パス（`requestedPath`）を安全な絶対パスへ解決する。
 * 先頭の "/" は相対パスとして扱い、".." で dataRoot の外へ出ようとする場合は拒否する。
 */
export function resolveServerPath(dataPath: string, requestedPath = ""): string {
  const root = dataRootFor(dataPath);
  const normalized = requestedPath.replace(/^[/\\]+/, "");
  const target = path.resolve(root, normalized);

  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new PathViolationError("path escapes data root");
  }

  return target;
}

/**
 * シンボリックリンク経由で dataRoot の外を指していないか、実体パスで再検証する。
 * 対象が存在しない場合（アップロード先の新規ファイルなど）は検証をスキップする。
 */
export async function assertRealPathWithinRoot(target: string, root: string): Promise<void> {
  let real: string;
  try {
    real = await fs.realpath(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }

  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new PathViolationError("resolved path escapes data root (symlink?)");
  }
}
