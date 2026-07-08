# Session Memory

## Current State

- Project idea: DataScope — CSV profiling + deterministic hypothesis tests + AI chat (LLM narrates, never computes; sees aggregates, never rows).
- Stack: React (Vite) on 9080 · plain node:http backend on 8090 · MongoDB Atlas (in-memory failsafe) · Bifrost gateway gpt-4o · single Docker image (nginx + node) · also deploys to Vercel from the same repo.
- Frontend URL: http://localhost:9080
- Backend health URL (through nginx /api): http://localhost:9080/api/health
- What works: 16/16 unit tests; seeded demo (quality 63, all planted flags found); Mongo Atlas connected via MONGODB_URI_FALLBACK (standard non-SRV URI — office network blocks Node SRV DNS); Bifrost chat verified in UI for chi-square + t-test demos; offline fallback incl. group-value matching; production vite build.
- What is blocked: Docker not installed (judging image); Vercel login needed (public app link).
- Most recent changes: entire app built this session (2026-07-08); Dockerfile/nginx/entrypoint, vercel.json + api/[[...slug]].js, README, tests.

## Gotchas (read before debugging)

- Node SRV DNS blocked on office network → keep MONGODB_URI_FALLBACK in env everywhere.
- Backend must NOT run under the Claude preview harness (its env blocks outbound HTTPS fetch → LLM silently falls back). Use scripts/dev-backend.cmd or plain `node backend/server.js`.
- esbuild postinstall blocked by npm allowScripts → if frontend serves raw JSX, run `node frontend/node_modules/esbuild/install.js` once.
- Paths with spaces break launch.json npm configs → use scripts/dev-frontend.cmd + dev-backend.cmd wrappers.
- Old debug chat messages exist in Mongo `chats` collection — wipe before final demo.
- Judging image bakes MONGODB_URI/BIFROST_API_KEY via --build-arg from .env (judges pass no env vars). Values never in repo/zip.
