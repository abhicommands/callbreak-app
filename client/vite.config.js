import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/

export default defineConfig({
  server: {
    host: true, // expose on LAN
    port: 5173, // your choice
    proxy: {
      "/api": {
        target: "http://localhost:5001", // your server
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  plugins: [react()],
});
