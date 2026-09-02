# Base44 Dev Environment

## Overview
Hitch — a rotational work planner. pnpm monorepo with a Vite/React frontend and an Express API server (scaffolding, not yet used by the frontend). All app data is client-side in localStorage.

## Architecture
- **Frontend** (`artifacts/hitch-planner`): Vite 7 + React 19 + Tailwind 4 + wouter. This is the user-facing app, served on port 3000. Requires `PORT` and `BASE_PATH` env vars.
- **API server** (`artifacts/api-server`): Express 5 with a single `/api/healthz` route. Built with esbuild (not a watch mode — `dev` script does `build && start`). The frontend does NOT call it yet.
- **DB** (`lib/db`): Drizzle ORM + PostgreSQL. Schema is currently empty (`export {}`). Not imported by the API server at runtime.
- **API client** (`lib/api-client-react`): Orval-generated React Query hooks. Not imported by the frontend yet.

## Running the app
```bash
docker compose -f docker-compose.base44.yml up -d
```
The web service installs pnpm workspace deps (cached in a volume) and starts the Vite dev server with live reload.

## Key gotchas
- **pnpm 11 build approval**: pnpm 11 blocks native build scripts (esbuild, @swc/core) by default. The compose command runs `pnpm rebuild esbuild @swc/core` after install, and sets `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false` to skip pnpm's pre-script deps check (which re-runs install and fails on ignored builds).
- **Replit-only vite plugins**: `@replit/vite-plugin-cartographer` and `dev-banner` are conditionally loaded only when `REPL_ID` is set. We intentionally don't set it, so they're skipped.
- **Vite config requires env**: `PORT` (set to 3000) and `BASE_PATH` (set to `/`) are required or the config throws at startup.
- **Node 24**: The `.replit` specifies `nodejs-24`; the compose uses `node:24-slim`.

## Verification
- `curl -sf http://localhost:3000/` returns the Vite-served HTML with HMR client
- Preview shows the Hitch planner with a 24-hour timeline view
