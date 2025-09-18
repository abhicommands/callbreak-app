# Repository Guidelines

## Project Structure & Module Organization
The workspace is split into `client/` and `server/`. The React frontend in `client/` uses Vite; entry `src/main.jsx` mounts `App.jsx`, while routed views live under `src/pages/` (`Home.jsx`, `Game.jsx`). Shared styling sits in `src/styles.css` and `App.css`; static assets and the HTML shell are in `client/public/` and `index.html`. The Express API resides in `server/server.js`, maintaining an in-memory session store for games, series metadata, and admin operations.

## Build, Test, and Development Commands
- `cd client && npm install` installs frontend dependencies; run once per clone.
- `cd client && npm run dev` starts Vite on port 5173 with hot reload against the API.
- `cd client && npm run build` produces a production bundle in `client/dist/`.
- `cd client && npm run lint` runs ESLint with the shared config.
- `cd server && npm install` prepares backend dependencies.
- `cd server && npm run dev` launches the API on `http://localhost:5001` with verbose logging; use `npm start` for production-like mode.

## Coding Style & Naming Conventions
Prefer 2-space indentation, double quotes, semicolons, and concise arrow functions as reflected in `client/src/App.jsx`. Name React components and exported modules in PascalCase (`GameControls.jsx`), and hooks/utilities in camelCase (`useRoundState`). Keep CSS modules descriptive (`*.css`) and colocated with consumers when scoped. Run `npm run lint` before pushing; it enforces the recommended ESLint, React Hooks, and React Refresh rules, plus `no-unused-vars` exemptions for intentionally global constants.

## Testing Guidelines
Automated tests are not yet wired up; please include targeted coverage with changes. For frontend work, prefer Vitest plus React Testing Library (`client/src/__tests__/*.test.jsx`), documenting `npm run test` instructions when introduced. Backend additions should use Supertest against the Express app; isolate game-state fixtures and assert both success and error paths. Until a script exists, provide manual verification notes in the PR and keep fixtures deterministic.

## Commit & Pull Request Guidelines
Author focused commits with clear imperative summaries (`Add scoreboard drag-and-drop`); avoid stacked unrelated changes. Reference issues in the body when applicable and describe user-visible impacts or migration steps. PRs should include: purpose, key implementation notes, test evidence (commands, screenshots of UI states), and any follow-up tasks. Request review only after linting and double-checking that both frontend and backend servers start cleanly.

## Environment Notes
The server is in-memory; restarting clears sessions. If you add configuration (ports, admin keys), surface defaults via README tables and guard secrets with `.env` files ignored by git.
