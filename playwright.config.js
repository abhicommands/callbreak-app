import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  timeout: 45_000,
  retries: 0,
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "android-chromium", use: { browserName: "chromium" } },
    { name: "iphone-webkit", use: { browserName: "webkit" } },
  ],
});
