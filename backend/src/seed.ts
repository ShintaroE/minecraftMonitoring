import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { users } from "./db/schema.js";
import { env } from "./env.js";
import { hashPassword } from "./services/auth.js";

async function main() {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
    console.log("ADMIN_USERNAME / ADMIN_PASSWORD が未設定のためシードをスキップします。");
    return;
  }

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.username, env.ADMIN_USERNAME))
    .limit(1);

  if (existing.length > 0) {
    console.log(`ユーザー "${env.ADMIN_USERNAME}" は既に存在します。スキップします。`);
    return;
  }

  const passwordHash = await hashPassword(env.ADMIN_PASSWORD);
  await db.insert(users).values({
    username: env.ADMIN_USERNAME,
    passwordHash,
    role: "admin",
  });

  console.log(`管理者ユーザー "${env.ADMIN_USERNAME}" を作成しました。`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
