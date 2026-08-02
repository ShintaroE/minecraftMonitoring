import { fileURLToPath } from "node:url";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { env } from "../env.js";

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

const migrationClient = postgres(env.DATABASE_URL, { max: 1 });
const db = drizzle(migrationClient);

await migrate(db, { migrationsFolder });
await migrationClient.end();

console.log("Migrations applied.");
