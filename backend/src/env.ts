import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  DOCKER_PROXY_HOST: z.string().default("docker-socket-proxy"),
  DOCKER_PROXY_PORT: z.coerce.number().default(2375),
  SHARED_ROOT: z.string().default("/mnt/docker-root"),
  MOD_BACKUP_ROOT: z.string().default("/app/data/mod-backups"),
  PUBLIC_HOST: z.string().default(""),
});

export const env = envSchema.parse(process.env);
