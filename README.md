# Callbreak

Play four-player Callbreak online or keep a live scoreboard and series ledger for in-person play. React/Vite serves the interface. Cloudflare Workers serves the UI and API from one origin. Each series or online table has its own SQLite-backed Durable Object.

## Start from a fresh clone

Install Node.js 24.22.3 LTS. With `nvm`, run the following from the repository root.

```sh
nvm install
nvm use
npm ci
npm run dev
```

On macOS with the pinned version installed via Homebrew, use `export PATH="$(brew --prefix node@24)/bin:$PATH"` in place of the two `nvm` commands.

Open `http://127.0.0.1:8787`. The dev command builds the frontend and starts the actual Worker locally. Re-run it after frontend changes to rebuild the static assets. No Cloudflare credentials are needed locally.

| Command | Purpose |
| --- | --- |
| `npm ci` | Install exactly the packages in the root lockfile |
| `npm run dev` | Start Wrangler with persistent local data in `.wrangler/ledger-dev` |
| `npm run lint` | Check the React source with ESLint and the Worker with TypeScript |
| `npm test` | Build the app, run scoring tests, and exercise the local Worker with fresh SQLite storage |
| `npm exec playwright -- install chromium webkit` | Install the browsers for end-to-end tests. Add `--with-deps` on Linux when OS libraries are needed |
| `npm run test:browser` | Test online play, reconnects, rotation, and the ledger in Android Chromium and iPhone WebKit profiles |
| `npm run build` | Build static assets into `client/dist` |

The browser and API test suites each start Wrangler with a temporary directory. Local data, the named Cloudflare preview environment, and the production namespace are isolated. The old Express server kept games in memory and was replaced by the Worker. Scoring remains in JavaScript under `server/src`.

## Pull requests

The **Verify ledger** check runs a clean install, dependency audit, lint, scoring tests, a real local Worker, and Chromium and WebKit tests. It also checks both Cloudflare bundles with dry runs. Keep gameplay rules in the shared JavaScript scoring code so another mode can reuse them.

## Play online locally

1. After starting the Worker with `npm run dev`, open `http://127.0.0.1:8787` and choose **Callbreak Online**. Pick the pace and payouts, create a table, and copy the invite link. The host can still edit these settings from the lobby.
2. Open the invite in three other browser profiles. For example, use Chrome normal, Chrome Incognito, Safari, and Brave. Tabs in the same profile share a seat. Multiple incognito windows from the same browser can share an incognito profile.
3. Join from each profile and start once all four seats show **Online**. The game shuffles the seats and draws the first dealer. Bidding and play go to the right around the table. With the default minimum total of 9, bid 2 in all four seats to see a rebid with the same hands, then bid 3, 2, 2, 2. Legal cards rise on your turn. Tap one or drag it onto the table. The table plays the last card from each hand in turn and settles the final trick automatically.
4. Close a guest tab, verify play pauses, then reopen the invite in the same profile to resume. To try a lost seat code, close the guest tab and request a seat from a fresh profile. The host can restore the offline seat during the deal. Between deals, the host can assign a new player to a guest seat. Previously played deals keep the original names and points.
5. **This deal** shows the current calls and tricks. Deal results appear after the last card. **Play again** begins another five-deal game with the same invitation, archived scores, and carried balances. Use **Open ledger** to view past games or **Table controls** to export or end the table.

**Fast** allows 8 seconds to bid and 5 to play. **Standard** allows 20 and 15 seconds, **Relaxed** allows 35 and 25, and **Untimed** leaves both open. The host can set each timer independently. On timeout, the Worker chooses a bid from 1 to 4 or a random legal card. The clock pauses with the table when a seat goes offline and resumes with the remaining time.

The default minimum combined bid is 9 and can be changed in the lobby. A bid of 8 or more turns the current hand into a side game led by the highest bidder. Tied bids go to the first of those bidders in the original bidding order. The side payout uses the sum of the three configured payouts times the stake, doubled for a call of 10 or more, and is split equally across the three opponents. The ledger posts it as soon as the call is made or becomes impossible. After all 13 tricks, the host resumes the same regular deal with fresh cards and the original dealer and bidding order. The last trick plays automatically one card at a time. Collected piles show trick counts.

**Game totals** shows points and net payout for the current game. **Open ledger** shows round history and series balances.

Payout presets are 1/2/3, 5/10/15, and 10/20/30. The host can enter custom amounts and a stake multiplier. Both modes use the same scoring, side-game transfers, and final settlement. For a first-place tie under the house ranking, the host or editor can choose a winner or split the lower places' payments among the tied winners. Tied winners do not pay each other. Games with substitutions retain individual scores and skip final settlement because the house payout calculation assumes a fixed roster of four.

The table pauses when a seat, including the host, disconnects. A silent connection loss can take up to about a minute to register. Save the private seat code and host recovery code from **Reconnect from another browser**. A successful host recovery replaces the previous host seat code. Joining by name alone grants no access to an existing seat's cards.

Online tables expire 24 hours after the last manual play or saved table change. Automatic moves, viewing, reconnecting, and pending seat requests leave the timer alone. Ending the table clears private hands and guests' access immediately and keeps the completed ledger available for another 24 hours. Export it to keep a portable backup.

## In-person ledger

- Saved regular calls appear in **If call made** after saving. **Confirmed** includes played and auto-awarded rounds. The points table sorts by the projected column, which equals confirmed points when no regular bids are pending.
- With auto-award enabled, saved calls totaling under 10 in rounds 1–4 score bid + 0.1. An 8+ bid opens a side game. Resolve or cancel it, then submit regular bids for that same round.
- Change the seating and next dealer for upcoming rounds from **Seating & Dealer**. Pregame substitutions preserve a benched player's balance. The previous game's last-place player deals first in the next game.
- The settlement ranks the exact scores 1 through 5 in any order first, five identical scores second, then other totals. Second-, third-, and fourth-place weights are doubled for a winner over 20 and doubled again for any loser below zero. Weights and stakes accept up to three decimal places and a maximum of 10,000. Balances are stored as integer millionths.
- **Copy Viewer Link** gives viewers `/ledger/<seriesId>`. It follows the active game and can open settled history. **Editor Access** shows the private editor code. Enter it from **Unlock Editing** to edit on another browser. Save the recovery code when creating the ledger. **Use Recovery Code** replaces the editor code and invalidates the old one. Keep both codes in a password manager and share only the viewer link with spectators.

## Try the in-person ledger locally

1. Choose **Callbreak Ledger** from the home page and select **Create Ledger**. Copy the viewer link and open it in a private browser window to see the read-only view.
2. For these examples, assign the numbers to **Player 1** through **Player 4** by name. Enter bids of `4, 2, 2, 2` and actuals of `5, 2, 3, 3` in round 1. Enter bids of `4, 1, 1, 1` in round 2 to try an auto-award.
3. Enter bids of `4, 2, 2, 2` in round 3. Player 1 should show **8.2 Confirmed** and **12.2 If call made** in both windows. Save actuals of `3, 4, 3, 3` in round 3. Both totals should become **4.2**.
4. Enter a bid of 8 or more in round 4 to try the side game. Resolve or cancel it, then enter regular bids for the same round. To check history, finish all five rounds, resolve the game, and start the next game. The viewer link stays the same.

## Backups and API

Ledgers expire after 24 hours without a saved editor change. A save resets the timer for the whole ledger, including its settled history. Viewing, reconnecting, and exporting leave the timer alone. Export before the deadline to keep your scores, balances, and history. Ledgers created before expiration was introduced start their timer on their next saved editor change.

Use **Export Ledger** while editing to save a versioned JSON backup. The download includes the series events needed to replay scores, balances, side games, and settled history. **Restore Backup** under **Callbreak Ledger** validates and replays the file into a fresh series with a new viewer URL, private credentials, and a fresh 24-hour window. The source ledger keeps its own expiration date and link. The first format supports 5,000 accepted operations per series and a 4 MiB restore request.

The public API exposes `GET /api/ledger/<seriesId>/snapshot`, `/socket` (a read-only, hibernating WebSocket), and `/history` or `/history/<gameId>`. HTTP and WebSocket snapshots share a version and a monotonically increasing series revision. The browser refreshes over HTTP when reconnecting.

The browser creates cryptographically random series identifiers, editor codes, and recovery codes. SQLite stores credential verifiers. Commands use the editor bearer credential, an `Idempotency-Key` and the `expectedRevision` from the last snapshot the edit used. Retrying the same request bytes and key returns the original committed revision with the current snapshot. A conflicting edit returns HTTP 409 with `STALE_REVISION`. Recovery uses the recovery credential. Creating or restoring a new series uses revision 0 and registers a fresh pair of verifiers. SQLite updates the active game, archived games, balances, audit entries, and retry receipts in the same transaction. Keep backup files private if they contain player names or balances.
