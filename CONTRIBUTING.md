# Contributing

YT Agent is a self-hosted project maintained by [Hamza Maqsood](https://github.com/Hamza-Maqsood1). These are the development notes for working on the codebase.

## Getting started

```bash
npm install        # also fetches the bundled FFmpeg binary
npm test           # full system test suite — no credentials or network needed
npm run lint
```

You don't need API keys to work on most of the code — the test suite and the simulation fallbacks run without them. For real end-to-end runs, `npm run setup` walks you through credentials (any one AI provider is enough).

## Tests

`npm test` is hermetic. Before any module loads it redirects `DATABASE_PATH`, `LOG_DIR`, `CONFIG_DIR`, and `API_KEY_FILE` to a throwaway temp folder and blanks every provider key, so tests never touch your real database, logs, or credentials, and never make paid API calls. Those same four environment variables also let you run a second instance side by side without clobbering the default paths.

The suite lives in `test.js` as `SystemTest` methods and runs without a test framework.

## Before you commit

1. Run `npm run lint` and `npm test` — both must pass.
2. If you fix a bug, add a regression test in `test.js` following the existing patterns. Any test that opens a database must point `db.dbPath` at a `mkdtemp` folder, never the default.
3. Note how you verified it (e.g. "generated a video with Gemini-only credentials and confirmed a real `.mp4` appeared in `data/videos/`").

The startup **capability check** (`🔎 Capability check:` in the terminal) diagnoses most provider and credential issues at a glance — keep it in bug reports.

## Architecture at a glance

- **`index.js`** — Express server, route wiring, API-key and Host protection, generation-job orchestration, graceful shutdown.
- **`agents/`** — one file per pipeline stage (strategy, script, thumbnail, SEO, production, publishing, analytics).
- **`utils/`** — AI text/video services, the autonomous operator, media generation, scene repair, shorts, provenance, discoverability, learning, and logging.
- **`database/db.js`** — SQLite schema and all data access.
- **`schedules/`** — cron-based automation.
- **`dashboard/`** — the web UI (vanilla JS, no build step).

## Known gaps

- **Reporting API not integrated.** Thumbnail impressions and CTR are unavailable from the Analytics API, so CTR-based learning and Controlled Growth Experiments cannot collect evidence yet. Use YouTube Studio's Test & Compare in the meantime.
- **The `mcp/` manifest is a stub** — its referenced server file does not exist and no MCP library is installed.
- **No cross-provider AI failover.** One text provider is selected at startup; a failure retries the same provider rather than switching to another. Use OpenRouter if you want a single key that spans models.
