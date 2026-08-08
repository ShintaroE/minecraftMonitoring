export interface AppConfig {
  publicHost: string;
}

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch("/api/config", { credentials: "include" });
  if (!res.ok) throw new Error(`failed to fetch config: ${res.status}`);
  return res.json();
}
