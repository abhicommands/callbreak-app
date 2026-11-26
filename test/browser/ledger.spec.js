import { test, expect, devices } from "@playwright/test";
import { localWorker } from "../local-worker.js";

test("mobile editor and independent viewer follow the same ledger", async ({ browser }) => {
  const worker = await localWorker();
  try {
    await worker.start();
    const phone = browser.browserType().name() === "webkit" ? "iPhone SE" : "Pixel 7";
    const editorContext = await browser.newContext(devices[phone]);
    const viewerContext = await browser.newContext(devices[phone]);
    const editor = await editorContext.newPage();
    const viewer = await viewerContext.newPage();
    await editor.goto(`${worker.origin}/ledger`);
    await editor.getByRole("button", { name: "Create Ledger" }).click();
    await expect(editor.getByText("Live sync: Online")).toBeVisible();
    await expect(editor.getByText(/Expires .+ unless you save another edit/)).toBeVisible();
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
    await actual(1, [5, 2, 3, 3]);
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
      const horizontalOverflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > window.innerWidth);
      expect(horizontalOverflow).toBe(false);
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
    const stake = secondRound.getByPlaceholder("3", { exact: true });
    await openSideGame();
    await stake.fill("11");
    await firstRound.getByRole("button", { name: "Cancel & Edit Bids" }).click();
    await expect(secondRound.getByRole("heading", { name: "Side Game (High Bid)" })).toHaveCount(0);
    await openSideGame();
    await expect(stake).toHaveValue("3");
  } finally {
    await worker.dispose();
  }
});
