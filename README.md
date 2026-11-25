# Callbreak Ledger

A live scoreboard and series ledger for four players and five rounds. React/Vite serves the interface. Cloudflare Workers serves the UI and API from one origin. Each series has one SQLite-backed Durable Object.

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
| `npm exec playwright -- install chromium` | Install the browser for end-to-end tests. Add `--with-deps` on Linux when OS libraries are needed |
| `npm run test:browser` | Build the app and test it in independent Chromium editor and viewer contexts |
| `npm run build` | Build static assets into `client/dist` |

The browser and API test suites each start Wrangler with a temporary directory. Local data, the named Cloudflare preview environment, and the production namespace are isolated. The old Express server kept games in memory and was replaced by the Worker. Scoring remains in JavaScript under `server/src`.

## Pull requests

The **Verify ledger** check runs a clean install, dependency audit, lint, scoring tests, a real local Worker, and Chromium tests. It also checks both Cloudflare bundles with dry runs. Keep gameplay rules in the shared JavaScript scoring code so another mode can reuse them.

## Play and share

- Saved regular calls appear in **If call made** after saving. **Confirmed** includes played and auto-awarded rounds. The points table sorts by the projected column, which equals confirmed points when no regular bids are pending.
- With auto-award enabled, saved calls totaling under 10 in rounds 1–4 score bid + 0.1. An 8+ bid opens a side game. Resolve or cancel it, then submit regular bids for that same round.
- Change the seating and next dealer for upcoming rounds from **Seating & Dealer**. Pregame substitutions preserve a benched player's balance. The previous game's last-place player deals first in the next game.
- The settlement ranks the exact scores 1 through 5 in any order first, five identical scores second, then other totals. Second-, third-, and fourth-place weights are doubled for a winner over 20 and doubled again for any loser below zero. Weights and stakes accept up to three decimal places and a maximum of 10,000. Balances are stored as integer millionths.
- **Copy Viewer Link** gives viewers `/ledger/<seriesId>`. It follows the active game and can open settled history. **Editor Access** shows the private editor code. Enter it from **Unlock Editing** to edit on another browser. Save the recovery code when creating the ledger. **Use Recovery Code** replaces the editor code and invalidates the old one. Keep both codes in a password manager and share only the viewer link with spectators.

## Try it locally

1. Open the home page and select **Create Ledger**. Copy the viewer link and open it in a private browser window to see the read-only view.
2. For these examples, assign the numbers to **Player 1** through **Player 4** by name. Enter bids of `4, 2, 2, 2` and actuals of `5, 2, 3, 3` in round 1. Enter bids of `4, 1, 1, 1` in round 2 to try an auto-award.
3. Enter bids of `4, 2, 2, 2` in round 3. Player 1 should show **8.2 Confirmed** and **12.2 If call made** in both windows. Save actuals of `3, 4, 3, 3` in round 3. Both totals should become **4.2**.
4. Enter a bid of 8 or more in round 4 to try the side game. Resolve or cancel it, then enter regular bids for the same round. To check history, finish all five rounds, resolve the game, and start the next game. The viewer link stays the same.

## Backups and API

Use **Export Ledger** while editing to save a versioned JSON backup. The download includes the series events needed to replay scores, balances, side games, and settled history. **Restore Backup** on the home page validates and replays the file into a fresh series with a new viewer URL and private credentials. The source series remains accessible at its own link. The first format supports 5,000 accepted operations per series and a 4 MiB restore request.

The public API exposes `GET /api/ledger/<seriesId>/snapshot`, `/socket` (a read-only, hibernating WebSocket), and `/history` or `/history/<gameId>`. HTTP and WebSocket snapshots share a version and a monotonically increasing series revision. The browser refreshes over HTTP when reconnecting.

The browser creates cryptographically random series identifiers, editor codes, and recovery codes. SQLite stores credential verifiers. Commands use the editor bearer credential, an `Idempotency-Key` and the `expectedRevision` from the last snapshot the edit used. Retrying the same request bytes and key returns the original committed revision with the current snapshot. A conflicting edit returns HTTP 409 with `STALE_REVISION`. Recovery uses the recovery credential. Creating or restoring a new series uses revision 0 and registers a fresh pair of verifiers. SQLite updates the active game, archived games, balances, audit entries, and retry receipts in the same transaction. Keep backup files private if they contain player names or balances.
