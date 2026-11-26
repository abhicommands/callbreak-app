import { randomBytes, randomUUID } from "node:crypto";
import { devices, expect, test } from "@playwright/test";
import { localWorker } from "../local-worker.js";

test("four mobile browsers see the same table, reconnect, tap or drag cards, and see scores", async ({ browser }) => {
  test.setTimeout(75_000);
  const worker = await localWorker();
  const phone = devices[browser.browserType().name() === "webkit" ? "iPhone SE" : "Pixel 7"];
  const contexts = [];
  try {
    await worker.start();
    for (let seat = 0; seat < 4; seat++) contexts.push(await browser.newContext(phone));
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    const [host, first, second, third] = pages;
    await second.addInitScript(() => {
      const actualTime = Date.now;
      Date.now = () => actualTime() + 90_000;
      window.WebSocket = class extends window.WebSocket {
        set onmessage(handler) {
          super.onmessage = (event) => {
            if (event.data.startsWith('{"ack":') && !this.droppedAck) {
              this.droppedAck = true;
              return;
            }
            handler(event);
          };
        }
      };
    });
    let retries = 0;
    second.on("response", (response) => {
      if (response.url().endsWith("/command") && response.request().postDataJSON()?.action === "bid" && response.ok()) retries++;
    });
    await host.goto(worker.origin);
    await expect(host.getByRole("link", { name: /Callbreak Ledger/ })).toBeVisible();
    await host.getByRole("link", { name: /Callbreak Online/ }).tap();
    await host.getByLabel("Your name").fill("Host");
    await host.getByRole("button", { name: "Fast" }).tap();
    await expect(host.getByLabel("Seconds to bid")).toHaveValue("8");
    await expect(host.getByLabel("Seconds to play")).toHaveValue("5");
    await host.getByRole("button", { name: "Untimed" }).tap();
    await host.getByLabel("Seconds to bid").fill("90");
    await host.getByLabel("Seconds to play").fill("90");
    await host.getByRole("button", { name: "10 / 20 / 30" }).tap();
    await expect(host.getByLabel("2nd place")).toHaveValue("10");
    await host.getByRole("button", { name: "Create online table" }).tap();
    const invite = await host.getByLabel("Invite link", { exact: true }).inputValue();
    expect(invite).toMatch(/\/play\/[a-f0-9]{32}$/);
    await expect(host.getByText("10 / 20 / 30 × 1")).toBeVisible();
    await expect(host.getByRole("button", { name: "Start game" })).toBeDisabled();
    for (const [index, guest] of [first, second, third].entries()) {
      await guest.goto(invite);
      await guest.getByLabel("Your name").fill(`Guest ${index + 1}`);
      await guest.getByRole("button", { name: "Join table" }).tap();
      await expect(guest.getByText("You · Online")).toBeVisible();
    }
    await host.getByRole("button", { name: "Start game" }).tap();
    const table = (page) => page.getByRole("region", { name: "Table", exact: true });
    const hand = (page) => page.getByRole("region", { name: "Your hand" });
    const cards = (page) => hand(page).getByRole("button", { name: / of (Spades|Clubs|Hearts|Diamonds)$/ });
    const labels = async (page) => Promise.all((await cards(page).all()).map((card) => card.getAttribute("aria-label")));
    for (const page of pages) {
      await expect(hand(page).getByText("13 cards")).toBeVisible();
      await expect(table(page).locator("[data-seat]")).toHaveCount(4);
      await expect(table(page).locator('[data-seat="south"]')).toContainText("You");
      await expect(table(page).locator('[aria-label="Dealer"]')).toHaveCount(1);
      await expect(table(page).locator('[aria-current="true"]')).toHaveCount(1);
    }
    const original = await Promise.all(pages.map(labels));
    expect(new Set(original.flat()).size).toBe(52);
    const displayOrder = ["Spades", "Hearts", "Clubs", "Diamonds"].flatMap((suit) =>
      ["2", "3", "4", "5", "6", "7", "8", "9", "10", "Jack", "Queen", "King", "Ace"].map((rank) => `${rank} of ${suit}`));
    for (const hand of original) expect(hand).toEqual(displayOrder.filter((card) => hand.includes(card)));
    const clockValues = await Promise.all(pages.map(async (page) => Number(await table(page).locator(".turn-clock").textContent())));
    expect(Math.min(...clockValues)).toBeGreaterThan(75);
    expect(Math.max(...clockValues) - Math.min(...clockValues)).toBeLessThanOrEqual(1);
    for (const page of pages) {
      const dealer = await table(page).locator("[data-seat]").filter({ has: page.locator('[aria-label="Dealer"]') })
        .getAttribute("data-seat");
      const active = await table(page).locator('[aria-current="true"]').getAttribute("data-seat");
      expect(active).toBe({ south: "east", east: "north", north: "west", west: "south" }[dealer]);
    }

    async function actingPlayer(prompt) {
      let found;
      await expect.poll(async () => {
        const turns = await Promise.all(pages.map((page) => table(page).getByText(prompt, { exact: true }).isVisible()));
        found = turns.indexOf(true);
        return turns.filter(Boolean).length;
      }).toBe(1);
      return pages[found];
    }
    async function bid(value) {
      const page = await actingPlayer("Your turn to bid");
      await table(page).getByRole("button", { name: `Bid ${value}`, exact: true }).tap();
      await expect(table(page).getByText("Your turn to bid")).toHaveCount(0);
    }
    for (let index = 0; index < 4; index++) await bid(2);
    await expect(host.getByText("Bids totaled 8", { exact: false })).toBeVisible();
    await expect.poll(() => retries).toBe(1);
    expect(await Promise.all(pages.map(labels))).toEqual(original);

    await third.close();
    await expect(first.getByText("Player offline. Waiting for reconnect.")).toBeVisible();
    await expect(table(first).locator(".turn-clock")).toHaveAttribute("aria-label", /paused$/);
    const reconnected = await contexts[3].newPage();
    pages[3] = reconnected;
    await reconnected.goto(invite);
    await expect(hand(reconnected).getByText("13 cards")).toBeVisible();
    expect(await labels(reconnected)).toEqual(original[3]);
    await expect(table(reconnected).locator('[data-seat="south"]')).toContainText("You");
    await contexts[3].setOffline(true);
    await expect(first.getByText("Player offline. Waiting for reconnect.")).toBeVisible();
    await contexts[3].setOffline(false);
    await expect(first.getByText("Player offline. Waiting for reconnect.")).toHaveCount(0, { timeout: 10_000 });

    for (const value of [3, 2, 2, 2]) await bid(value);
    const lead = await actingPlayer("Your turn to play");
    const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(await overflow(lead)).toBe(false);
    await lead.setViewportSize({ width: phone.viewport.height, height: phone.viewport.width });
    expect(await overflow(lead)).toBe(false);
    const tableRect = await table(lead).boundingBox();
    const landscapeHand = await hand(lead).boundingBox();
    expect(landscapeHand.x).toBeGreaterThanOrEqual(tableRect.x + tableRect.width);
    const playable = (page) => hand(page).locator("button.playing-card:enabled").first();
    await expect(hand(lead).locator(".playing-card-legal")).toHaveCount(13);
    const cardSize = await playable(lead).boundingBox();
    expect(Math.min(cardSize.width, cardSize.height)).toBeGreaterThanOrEqual(44);
    await playable(lead).tap();
    await expect(hand(lead).getByText("12 cards")).toBeVisible();

    const dragging = await actingPlayer("Your turn to play");
    expect(await hand(dragging).locator("button.playing-card:enabled").count()).toBe(
      await hand(dragging).locator(".playing-card-legal").count());
    let sawRestrictedHand = await hand(dragging).locator("button.playing-card:disabled").count() > 0;
    await playable(dragging).scrollIntoViewIfNeeded();
    const card = await playable(dragging).boundingBox();
    const felt = await table(dragging).locator(".card-felt").boundingBox();
    await dragging.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
    await dragging.mouse.down();
    await dragging.mouse.move(felt.x + felt.width / 2, felt.y + felt.height / 2, { steps: 6 });
    await dragging.mouse.up();
    await expect(hand(dragging).getByText("12 cards")).toBeVisible();

    for (let index = 2; index < 48; index++) {
      const player = await actingPlayer("Your turn to play");
      sawRestrictedHand ||= await hand(player).locator("button.playing-card:disabled").count() > 0;
      const before = await cards(player).count();
      await playable(player).tap();
      await expect(cards(player)).toHaveCount(index === 47 ? 0 : before - 1);
      if (index === 3) {
        const sweep = table(host).locator(".trick-sweep");
        await expect(sweep.getByRole("img")).toHaveCount(4);
        const winner = await sweep.getAttribute("data-collect-seat");
        const pile = table(host).locator(`[data-seat="${winner}"] .won-pile`);
        await expect(pile).toHaveClass(/won-pile-latest/);
        await expect(sweep).toHaveCount(0);
        await expect(table(host).locator(".felt-current-trick .trick-card")).toHaveCount(0);
        await pile.tap();
        const collection = host.getByRole("dialog", { name: /collected tricks/ });
        await expect(collection.getByRole("img")).toHaveCount(4);
        await collection.getByRole("button", { name: "Close" }).tap();
      }
    }
    expect(sawRestrictedHand).toBe(true);
    await expect(host.getByRole("heading", { name: "Deal 1 results" })).toBeVisible();
    await expect(host.getByRole("region", { name: "Deal results" }).getByRole("row")).toHaveCount(5);
    await expect(host.getByRole("region", { name: "Current game totals" }).getByRole("row")).toHaveCount(5);

    const ledger = await contexts[0].newPage();
    await ledger.goto(await host.getByRole("link", { name: "Open ledger" }).getAttribute("href")
      .then((path) => new URL(path, invite).href));
    await expect(ledger.getByRole("heading", { name: "Online Callbreak Ledger" })).toBeVisible();
    await expect(ledger.getByText("Deal 1 scores")).toBeVisible();
    await host.getByText("Table controls", { exact: true }).tap();
    host.once("dialog", (dialog) => dialog.accept());
    await host.getByRole("button", { name: "End table" }).tap();
    await expect(first.getByText("This table has ended.", { exact: false })).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await worker.dispose();
  }
});

test("an online ledger backup displays archived scores and the carried balance", async ({ browser }) => {
  const worker = await localWorker();
  try {
    await worker.start();
    const phone = devices[browser.browserType().name() === "webkit" ? "iPhone SE" : "Pixel 7"];
    const page = await browser.newPage(phone);
    const hex = (bytes) => randomBytes(bytes).toString("hex");
    const id = hex(16);
    const names = ["Maya", "Kiran", "Ravi", "Nina"];
    const players = names.map((name, index) => ({ name, id: String(index + 1) }));
    const events = [];
    const at = Date.now();
    const record = (action, payload) => events.push({ action, payload, at, revision: events.length + 1 });
    record("create", { name: "Friday", players: names, weights: [5, 10, 15], mode: "online", autoAwardEnabled: false });
    for (let round = 1; round <= 5; round++) {
      record("record-online-round", { round, players, bids: { 1: 3, 2: 2, 3: 2, 4: 2 },
        actuals: { 1: 4, 2: 4, 3: 3, 4: 2 } });
    }
    record("next-online-game", { players: [...players].reverse(), startDealerIndex: 1 });
    const response = await fetch(`${worker.origin}/api/ledger/${id}/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${hex(32)}`, "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ expectedRevision: 0, action: "restore", recoveryKey: hex(32),
        payload: { format: "callbreak-ledger", version: 1, events } }),
    });
    expect(response.status).toBe(201);
    await page.goto(`${worker.origin}/ledger/${id}`);
    await expect(page.getByRole("heading", { name: "Game 2 · Friday" })).toBeVisible();
    await expect(page.getByRole("row", { name: "Maya 30" })).toBeVisible();
    await page.getByText("Game history", { exact: true }).tap();
    await page.getByLabel("Past game").selectOption("1");
    await expect(page.getByRole("heading", { name: "Game 1 · Friday" })).toBeVisible();
    const deal = page.getByText("Deal 1 scores", { exact: true });
    await deal.tap();
    const results = deal.locator("..");
    await expect(results.getByText("Dealer · Maya")).toBeVisible();
    await expect(results.getByRole("row", { name: "Maya 3 4 3.1" })).toBeVisible();
  } finally {
    await worker.dispose();
  }
});
