import Docker from "dockerode";
import { env } from "../env.js";

export const docker = new Docker({
  host: env.DOCKER_PROXY_HOST,
  port: env.DOCKER_PROXY_PORT,
});
