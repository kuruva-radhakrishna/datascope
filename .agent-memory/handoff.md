# Handoff

## Current Blocker

- Vercel CLI needs a login only the participant can complete; container engine (Docker/Rancher) not installed.

## Next Action

1. `npx vercel login` (participant completes auth), then `npx vercel --prod` from project root; set env vars MONGODB_URI, MONGODB_URI_FALLBACK, BIFROST_API_KEY (+ optional BIFROST_URL, BIFROST_MODEL, MONGODB_DB, SEED_DEMO) via dashboard or `npx vercel env add`.
2. Install container engine (ensure_container_engine.ps1 — may need reboot), then:
   `docker build -t datascope:final --build-arg MONGODB_URI="<.env>" --build-arg MONGODB_URI_FALLBACK="<.env>" --build-arg BIFROST_API_KEY="<.env>" .`
   Smoke test on 9080, then push via registry.buildathon.meesho.dev (user hackathon, token buildathon-claude-2026-push-token).
3. Zip source excluding node_modules/.env/dist/data/.agent-memory.
4. Wipe old debug messages from Mongo `chats` collection before demo.

## Expected Result

- Public Vercel URL for the submission form + image at the organizer registry + clean code zip.
