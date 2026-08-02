import { docker } from "./dockerClient.js";

export async function startContainer(containerName: string): Promise<void> {
  await docker.getContainer(containerName).start();
}

export async function stopContainer(containerName: string): Promise<void> {
  await docker.getContainer(containerName).stop();
}

export async function restartContainer(containerName: string): Promise<void> {
  await docker.getContainer(containerName).restart();
}

export async function getContainerState(containerName: string): Promise<string> {
  const info = await docker.getContainer(containerName).inspect();
  return info.State.Status;
}
