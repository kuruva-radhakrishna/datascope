# 🔬 DataDive

**Drop a CSV, get answers you can defend.**

Analysts get messy CSVs every day. DataDive gives you an instant data profile (column types, quality score 0–100, anomalies, auto-insights), lets you run *real* statistical hypothesis tests, and lets you chat with an AI about the data — where the statistics are always computed deterministically by the backend and the AI only narrates them.

## What makes it different

- **Deterministic math, LLM narration.** Welch's t-test, chi-square, one-way ANOVA and correlation significance are hand-written in Node — including numerically computed p-values (Lanczos log-gamma + continued-fraction incomplete beta), unit-tested against canonical values. The model never computes a number.
- **Privacy by construction.** The LLM sees column schemas and profile aggregates — never raw rows.
- **Works offline.** Without an API key or network, a rule-based parser handles the common question shapes with templated interpretations. Nothing breaks.
- **Honest statistics.** Effect sizes alongside p-values, warnings when chi-square expected counts are low, skew warnings when the mean is untrustworthy.

## Stack

React (Vite) frontend · Node.js backend (zero frameworks — plain `node:http`) · MongoDB Atlas (with in-memory failsafe) · LLM via the Bifrost gateway (OpenAI-compatible, `gpt-4o`).

## Local preview

Requires Node ≥ 20. Copy `.env.example` to `.env` and fill in values.

```
npm install
npm --prefix frontend install
node backend/server.js          # backend on :8090
npm --prefix frontend run dev   # frontend on :9080 (proxies /api to :8090)
```

Open http://localhost:9080 — a seeded demo dataset (`meesho_orders.csv`, 500 rows with planted quality issues and effects) loads on first boot.

## Tests

```
npm test
```

16 tests cover the CSV parser, type inference, profiler, and the stats engine against known values (e.g. t=2.0, df=10 ⇒ two-tailed p ≈ 0.0734).

## Docker (single judging image)

```
docker build -t datadive:final ^
  --build-arg MONGODB_URI="<from .env>" ^
  --build-arg MONGODB_URI_FALLBACK="<from .env>" ^
  --build-arg BIFROST_API_KEY="<from .env>" .
docker run --rm -p 9080:9080 -p 8090:8090 datadive:final
```

nginx serves the frontend on **9080** and proxies `/api/` to the backend on **8090**. Judges run the image with no env vars — connection values are baked at build time (never committed to the repo).

## Vercel

The same repo deploys to Vercel: static frontend + `api/[[...slug]].js` catch-all function reusing the identical backend router. Set `MONGODB_URI`, `BIFROST_API_KEY` (and optionally `MONGODB_URI_FALLBACK`, `BIFROST_URL`, `BIFROST_MODEL`, `MONGODB_DB`, `SEED_DEMO`) as project env vars. Uploads are capped at 4MB on Vercel.

## Demo script (3 minutes)

1. Open the app — the demo dataset is already profiled: quality score **63** with itemized deductions (mixed date formats, test rows, duplicates, future dates, non-numeric noise).
2. Auto-insights: the ₹49,999 outlier (z = 22), and why the median beats the mean here.
3. Click the chat chip *"Is return rate different between couriers?"* — a chi-square runs locally (χ² = 32.5, p < 0.0001) and the AI explains it: QuickShip's return rate is genuinely higher.
4. Click *"Compare price between Karnataka and Maharashtra"* — Welch's t-test, ~₹171 gap, Cohen's d ≈ 1 (large).
5. "Hand me any CSV." — upload theirs, everything recomputes live.
