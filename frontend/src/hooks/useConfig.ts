import { useEffect, useState } from "react";
import { fetchConfig, type AppConfig } from "../api/config";

export function useConfig() {
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    fetchConfig()
      .then(setConfig)
      .catch(() => {
        // 取得できなければ接続先表示を省略する
      });
  }, []);

  return config;
}
