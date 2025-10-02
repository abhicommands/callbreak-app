/* eslint-env node */
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const hostSetting = env.VITE_DEV_SERVER_HOST;
  const host =
    hostSetting === "false"
      ? false
      : hostSetting && hostSetting !== "true"
      ? hostSetting
      : true;

  const port = Number(env.VITE_DEV_SERVER_PORT) || 3000;
  const proxyTarget = env.VITE_API_PROXY_TARGET || "http://localhost:8080";

  return {
    server: {
      host,
      port,
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ""),
        },
      },
    },
    plugins: [react()],
  };
});
