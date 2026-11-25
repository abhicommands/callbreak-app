import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // Preserve the browser versions targeted before the Vite 8 upgrade.
    target: ["chrome107", "edge107", "firefox104", "safari16"],
  },
});
