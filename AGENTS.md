# Repository Guidelines

## Project structure

The React/Vite app is in `client/`. The Cloudflare Worker and SQLite Durable Object are in `worker/`. Keep house rules, scoring, and game transitions in the shared JavaScript domain code under `server/src/`. The npm workspace and lockfile are at the root.

## Development and verification

Use the pinned Node version in `.nvmrc`. Run `npm ci` from the root and `npm run dev` to start Vite's production build on the local Wrangler stack. Local state is isolated in `.wrangler/ledger-dev`.

Run `npm run lint`, `npm test`, `npm run test:browser`, and the Wrangler dry runs before requesting review. Install the test browsers with `npm exec playwright -- install chromium webkit` first. Include targeted tests for behavior changes. Put deterministic scoring coverage and Worker API tests in `test/`, and cross-context browser coverage in `test/browser/`. See the README for the command and environment details.

## Mobile web

Treat phone browsers as primary targets for the ledger and online Callbreak. Support Safari, Chrome, and Brave on iOS, and Chrome and Brave on Android, alongside desktop browsers. Keep score entry and game controls usable in portrait and landscape with touch, a visible keyboard, and narrow screens. Use clear tap targets and provide a tap option for any drag interaction.

Run the ledger flows in Android Chromium and iPhone WebKit profiles. For online play, cover joining by link, private hands, bidding and playing cards by touch, and reconnecting after the phone sleeps or switches networks. Record physical-device coverage when devices are available.

## Coding style

Prefer two-space indentation, double quotes, semicolons, and descriptive names. Use PascalCase for React components and camelCase for functions and hooks. Keep TypeScript at the Worker API boundary and avoid duplicating scoring rules in the client.

## Commits and pull requests

Use focused commits with clear imperative summaries. Describe user-visible behavior, any migration steps, and verification evidence. Keep real credentials, ledger exports, test reports, and local state out of Git.
