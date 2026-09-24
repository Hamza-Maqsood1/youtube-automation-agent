# Dev notes

This is a private, self-hosted project owned by Hamza Maqsood (hamza.maqsuod@gmail.com · [GitHub](https://github.com/Hamza-Maqsood1) · [LinkedIn](https://www.linkedin.com/in/hamza-maqsood1)). There is no external contribution workflow — these are just internal notes for working on the codebase.

## Getting started

```bash
npm install        # also fetches the bundled FFmpeg binary
npm test           # system tests, no credentials needed
npm run lint
```

You don't need API keys to work on most of the codebase — the test suite and the simulation fallbacks run without them. For end-to-end runs, `npm run setup` walks you through credentials (any one AI provider is enough).

`npm test` is hermetic: before any module loads it redirects `DATABASE_PATH`, `LOG_DIR`, `CONFIG_DIR`, and `API_KEY_FILE` to a throwaway temp folder and blanks every provider key, so tests never touch your real database, logs, credentials, or make paid API calls. Those same four env vars let you run a second instance side by side without clobbering the default paths.

## Before committing a change

1. Run `npm run lint` and `npm test` — both should pass (50 tests, no credentials, no network).
2. If you fix a bug, add a regression test in `test.js` (see the existing `SystemTest` methods for the pattern). New DB-backed tests must set `db.dbPath` to a `mkdtemp` folder, not the default.
3. Note how you tested it, e.g. "Ran `npm start`, generated a video with Gemini-only credentials, verified a real .mp4 appeared in `data/videos/`."

## Known gaps

- **Reporting API not integrated.** Thumbnail impressions and CTR are unavailable, so CTR-based learning and growth experiments cannot collect evidence yet.
- **The `mcp/` manifest is a stub** — its referenced server file does not exist and no MCP library is installed.
- **No true cross-provider AI failover** — one text provider is selected at startup; a failure retries the same provider, it does not switch to another.

## Reporting an issue to yourself

Keep the startup capability check (`🔎 Capability check:` block) from the terminal output — it diagnoses most provider/credential issues instantly.
