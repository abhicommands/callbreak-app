import { test, expect, devices } from "@playwright/test";
import { localWorker } from "../local-worker.js";

test("mobile editor and independent viewer follow the same ledger", async ({ browser }) => {
  test.setTimeout(120_000);
  const worker = await localWorker();
  try {
    await worker.start();
    const phone = browser.browserType().name() === "webkit" ? "iPhone SE" : "Pixel 7";
    const editorContext = await browser.newContext(devices[phone]);
    const viewerContext = await browser.newContext(devices[phone]);
    const editor = await editorContext.newPage();
    const viewer = await viewerContext.newPage();
    await editor.goto(`${worker.origin}/ledger`);
    await editor.getByLabel("Appearance", { exact: true }).selectOption("dark");
    await editor.getByLabel(/Auto-award rounds/).check();
    await editor.getByRole("button", { name: "Create Ledger" }).click();
    await expect(editor.getByText("Live sync: Online")).toBeVisible();
    await expect(editor.getByText(/Expires .+ if paid up and inactive/)).toBeVisible();
    const shareLink = editor.url();
    expect(shareLink).toMatch(/\/ledger\/[a-f0-9]{32}$/);
    const recovery = await editor.getByLabel("Recovery code", { exact: true }).inputValue();
    expect(recovery).toMatch(/^[a-f0-9]{64}$/);
    await editor.getByRole("button", { name: "I Saved the Recovery Code" }).click();

    const editorCheckFailed = editor.waitForEvent("requestfailed", (request) => request.url().endsWith("/editor"));
    await editor.route("**/api/ledger/*/editor", (route) => route.abort(), { times: 1 });
    await editor.reload();
    await editorCheckFailed;
    await expect(editor.getByRole("button", { name: "Set Bids", exact: true }).first()).toBeVisible();

    await viewer.goto(shareLink);
    await expect(viewer.getByText("Live sync: Online")).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Set Bids" })).toHaveCount(0);
    await expect(viewer.getByText(recovery)).toHaveCount(0);

    await editor.getByRole("button", { name: "Edit Seating" }).click();
    const dealer = editor.getByRole("combobox").filter({
      has: editor.locator("option").filter({ hasText: /^Player 1$/ }),
    });
    const order = editor.getByRole("list", { name: "Seating order" });
    await order.getByRole("button", { name: "Move Player 1 down" }).tap();
    await expect(order.getByRole("listitem").nth(1)).toContainText("Player 1");
    const handle = order.getByRole("button", { name: "Drag Player 1 to reorder" });
    await handle.scrollIntoViewIfNeeded();
    const start = await handle.boundingBox();
    const end = await order.getByRole("listitem").first().boundingBox();
    await editor.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await editor.mouse.down();
    await editor.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 4 });
    await editor.mouse.up();
    await expect(order.getByRole("listitem").first()).toContainText("Player 1");
    await expect(dealer).toHaveValue("1");
    await dealer.selectOption("2");
    await editor.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(dealer).toHaveValue("1");
    await editor.getByRole("button", { name: "Close", exact: true }).click();

    const round = (page, number) => page.getByRole("region", { name: `Round ${number}` });
    const totalRows = (page) => page.getByRole("heading", { name: "Total Points (This Game)" })
      .locator("..").getByRole("row");
    const playerTotals = (page, player) => totalRows(page).filter({ hasText: `Player ${player}` }).getByRole("cell");
    const bid = async (number, values, update = false) => {
      const card = round(editor, number);
      for (const [index, value] of values.entries()) {
        const input = card.getByLabel(`Bid for Player ${index + 1}`);
        await expect(input).toHaveAttribute("inputmode", "numeric");
        await input.fill(String(value));
      }
      await card.getByRole("button", { name: update ? "Update Bids" : "Set Bids", exact: true }).click();
    };
    const actual = async (number, values) => {
      const card = round(editor, number);
      for (const [index, value] of values.entries()) {
        await card.getByLabel(`Actual for Player ${index + 1}`).fill(String(value));
      }
      await card.getByRole("button", { name: "Set Actuals (sum 13)", exact: true }).click();
      await expect(round(viewer, number).getByText("PLAYED", { exact: true })).toBeVisible();
    };

    await bid(1, [4, 2, 2, 2]);
    const scorecard = viewer.getByRole("navigation", { name: "Five-deal scorecard" });
    await expect(scorecard.getByRole("link", { name: "Deal 1 Bids in" })).toBeVisible();
    await actual(1, [5, 2, 3, 3]);
    await expect(scorecard.getByRole("link", { name: "Deal 1 Scored" })).toBeVisible();
    await bid(2, [4, 1, 1, 1]);
    await expect(round(viewer, 2).getByText("AUTO-AWARDED", { exact: true })).toBeVisible();
    await bid(3, [4, 2, 2, 2]);
    for (const page of [editor, viewer]) {
      await expect(playerTotals(page, 1)).toHaveText(["1", "Player 1", "8.2", "12.2"]);
    }

    await bid(4, [1, 7, 1, 1]);
    await expect(totalRows(viewer).nth(1)).toContainText("Player 1");
    await bid(5, [1, 7, 1, 1]);
    await expect(totalRows(viewer).nth(1)).toContainText("Player 2");
    await actual(5, [5, 2, 3, 3]);
    await expect(totalRows(viewer).nth(1)).toContainText("Player 1");

    await round(editor, 3).getByRole("button", { name: "Edit Bids" }).click();
    await bid(3, [8, 2, 2, 2], true);
    await expect(round(viewer, 3).getByRole("heading", { name: "Side Game (High Bid)" })).toBeVisible();
    await expect(playerTotals(viewer, 1).nth(3)).toHaveText("10.6");
    await round(editor, 3).getByRole("button", { name: "Cancel & Edit Bids" }).click();
    await expect(round(viewer, 3).getByRole("heading", { name: "Side Game (High Bid)" })).toHaveCount(0);
    await bid(3, [8, 2, 2, 2]);
    await round(editor, 3).getByRole("button", { name: "Yes — Bidder Won" }).click();
    await expect(round(viewer, 3).getByRole("heading", { name: "Side Game (High Bid)" })).toHaveCount(0);
    await bid(3, [4, 2, 2, 2]);
    await actual(3, [3, 4, 3, 3]);
    await expect(playerTotals(viewer, 1).nth(2)).toHaveText("5.6");
    await expect(playerTotals(viewer, 1).nth(3)).toHaveText("6.6");
    await actual(4, [4, 3, 3, 3]);

    for (const page of [editor, viewer]) {
      const layout = await page.evaluate(() => {
        const overflow = [...document.querySelectorAll("body *")]
          .filter((element) => element.getBoundingClientRect().right > window.innerWidth)
          .map((element) => element.tagName + "." + element.className);
        return { width: document.documentElement.scrollWidth, viewport: window.innerWidth, overflow };
      });
      expect(layout.width, layout.overflow.join(", ")).toBeLessThanOrEqual(layout.viewport);
    }
    await expect(editor.getByRole("heading", { name: "First-place tie" })).toBeVisible();
    await editor.getByRole("button", { name: "Keep tie and split winnings" }).click();
    const settlement = viewer.getByRole("heading", { name: "This Game Settlement (Applied)" }).locator("..");
    await expect(settlement.getByRole("row").filter({ hasText: "Player 3" }).getByRole("cell").first()).toHaveText("1");
    await expect(settlement.getByRole("row").filter({ hasText: "Player 4" }).getByRole("cell").first()).toHaveText("1");
    await editor.getByRole("button", { name: "Start Next Game (carry payouts)" }).click();
    await expect(viewer.getByText("Game 2", { exact: true })).toBeVisible();
    expect(viewer.url()).toBe(shareLink);
    expect(editor.url()).toBe(shareLink);

    const download = editor.waitForEvent("download");
    await editor.getByRole("button", { name: "Export Ledger" }).click();
    const backupPath = await (await download).path();

    await viewer.getByRole("button", { name: "View Game History" }).click();
    await expect(viewer.getByRole("heading", { name: "Final Totals" })).toBeVisible();
    await worker.stop();
    await worker.start();
    await expect(viewer.getByText("Live sync: Online")).toBeVisible({ timeout: 18_000 });
    await viewer.reload();
    await expect(viewer.getByText("Game 2", { exact: true })).toBeVisible();

    const copy = await viewerContext.newPage();
    await copy.goto(`${worker.origin}/ledger`);
    await copy.getByLabel("Ledger backup").setInputFiles(backupPath);
    await copy.getByRole("button", { name: "Restore Backup" }).click();
    await expect(copy.getByText("Game 2", { exact: true })).toBeVisible();
    expect(copy.url()).not.toBe(shareLink);
    await copy.getByRole("button", { name: "View Game History" }).click();
    await expect(copy.getByRole("heading", { name: "Final Totals" })).toBeVisible();
  } finally {
    await worker.dispose();
  }
});

test("an editor must review live changes before resubmitting a stale draft", async ({ browser }) => {
  const worker = await localWorker();
  try {
    await worker.start();
    const first = await browser.newPage();
    const second = await browser.newPage();
    await first.goto(`${worker.origin}/ledger`);
    await first.getByLabel(/Auto-award rounds/).check();
    await first.getByRole("button", { name: "Create Ledger" }).click();
    await first.getByText("Editor Access", { exact: true }).click();
    const token = await first.getByLabel("Private editor code").inputValue();
    await second.goto(first.url());
    await second.locator("summary").filter({ hasText: "Unlock Editing" }).click();
    await second.getByLabel("Private editor code").fill(token);
    await second.locator("form").getByRole("button", { name: "Unlock Editing" }).click();

    const secondRound = second.getByRole("region", { name: "Round 1" });
    for (const index of [1, 2, 3, 4]) {
      await secondRound.getByLabel(`Bid for Player ${index}`).fill("2");
    }

    await first.getByRole("button", { name: "Turn Off", exact: true }).click();
    await expect(second.getByRole("button", { name: "Turn On", exact: true })).toBeVisible();
    await secondRound.getByRole("button", { name: "Set Bids" }).click();
    await expect(secondRound.getByRole("alert")).toContainText("The ledger changed.");
    await expect(secondRound.getByLabel("Bid for Player 1")).toHaveValue("");
    const firstRound = first.getByRole("region", { name: "Round 1" });
    await expect(firstRound.getByText("IN PROGRESS")).toBeVisible();

    const openSideGame = async () => {
      for (const [index, bid] of [8, 2, 2, 2].entries()) {
        await firstRound.getByLabel(`Bid for Player ${index + 1}`).fill(String(bid));
      }
      await firstRound.getByRole("button", { name: "Set Bids", exact: true }).click();
      await expect(secondRound.getByRole("heading", { name: "Side Game (High Bid)" })).toBeVisible();
    };
    const pool = secondRound.getByText("Side payout · 6 total");
    await openSideGame();
    await expect(pool).toBeVisible();
    await firstRound.getByRole("button", { name: "Cancel & Edit Bids" }).click();
    await expect(secondRound.getByRole("heading", { name: "Side Game (High Bid)" })).toHaveCount(0);
    await openSideGame();
    await expect(pool).toBeVisible();
  } finally {
    await worker.dispose();
  }
});

test("the regular ledger handles payments and the next game, and old bookmarks still work", async ({ browser }) => {
  const worker = await localWorker();
  const phone = browser.browserType().name() === "webkit" ? "iPhone SE" : "Pixel 7";
  const context = await browser.newContext(devices[phone]);
  try {
    await worker.start();
    const page = await context.newPage();
    await page.goto(worker.origin + "/ledger");
    await page.getByRole("button", { name: "Create Ledger" }).tap();
    const deal = page.getByRole("region", { name: "Round 1", exact: true });
    for (const [i, value] of [10, 1, 1, 1].entries()) {
      await deal.getByLabel("Bid for Player " + (i + 1)).fill(String(value));
    }
    await deal.getByRole("button", { name: "Set Bids", exact: true }).tap();
    await expect(deal.getByText("Side payout · 12 total")).toBeVisible();
    await deal.getByRole("button", { name: "Yes — Bidder Won" }).tap();
    const ledgerUrl = page.url();
    await page.goto(ledgerUrl.replace("/ledger/", "/group/"));
    await expect(page).toHaveURL(ledgerUrl);
    await page.getByRole("link", { name: "Balances", exact: true }).tap();
    await expect(page.locator("#balances").getByRole("row").filter({ hasText: "Player 1" })).toContainText("12.0");
    await page.getByRole("button", { name: "Settle up" }).tap();
    await expect(page.getByText("Player 2 pays Player 1")).toBeVisible();
    await page.getByRole("button", { name: "Confirm paid" }).tap();
    await expect(page.locator("#balances tbody b").filter({ hasText: /^0\.0$/ })).toHaveCount(4);
    await page.getByText("Payment receipts (1)", { exact: true }).tap();
    await expect(page.getByRole("heading", { name: /^Paid ·/ })).toBeVisible();
    await page.getByText("End current game", { exact: true }).tap();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "End this game" }).tap();
    await page.getByText("Start a new game", { exact: true }).tap();
    await page.getByRole("radio", { name: "Online", exact: true }).check();
    await page.getByRole("button", { name: "10 / 20 / 30" }).tap();
    await page.getByRole("button", { name: "Create online game" }).tap();
    await expect(page.getByRole("button", { name: "Start game" })).toBeDisabled();
    await expect(page.getByText("10 / 20 / 30 × 1")).toBeVisible();
    await page.getByRole("link", { name: "Open ledger" }).tap();
    await expect(page.getByRole("heading", { name: "Online Callbreak Ledger" })).toBeVisible();
    await page.getByText("Game history", { exact: true }).tap();
    await page.getByLabel("Past game").selectOption("1");
    await page.getByText("Payment receipts (1)", { exact: true }).tap();
    await expect(page.getByText("Player 2 pays Player 1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await context.close();
    await worker.dispose();
  }
});
