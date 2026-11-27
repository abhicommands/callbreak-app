import { expect, test } from "@playwright/test";
import { localWorker } from "../local-worker.js";

test("copy buttons confirm in place and provide a manual fallback", async ({ page }) => {
  const worker = await localWorker();
  try {
    await worker.start();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { value: {
        async writeText(value) {
          if (window.blockCopy) throw new Error("Clipboard unavailable");
          window.copiedLink = value;
        },
      } });
    });
    for (const online of [true, false]) {
      await page.goto(worker.origin + (online ? "/play" : "/ledger"));
      if (online) await page.getByLabel("Your name").fill("Host");
      await page.getByRole("button", { name: online ? "Create online table" : "Create Ledger" }).click();
      const button = page.getByRole("button", { name: online ? "Copy invite link" : "Copy Viewer Link" });
      await button.click();
      await expect(page.getByRole("button", { name: "Copied!", exact: true })).toBeVisible();
      expect(await page.evaluate(() => window.copiedLink)).toBe(page.url());
      await expect(button).toBeVisible();
      await page.evaluate(() => { window.blockCopy = true; });
      await button.click();
      await expect(page.getByRole("button", { name: "Copy manually" })).toBeVisible();
      await expect(page.getByLabel(online ? "Invite link" : "Link to copy", { exact: true })).toHaveValue(page.url());
    }
  } finally {
    await worker.dispose();
  }
});
