# Local QA Dashboard setup

Use this guide when cloning **QADashboard_New_Local** (or any full checkout) onto a new machine so you get the **same unrestricted local workflow** as development on this laptop.

This is **one codebase**. Local vs live behavior is controlled by environment variables, not by a separate fork.

---

## What “local mode” gives you

| Capability | Local default | Production default |
|------------|---------------|--------------------|
| Run multiple modules / tests at once | **On** | Off (single job lock) |
| Link Radar bulk crawl (up to ~10k URLs) | **On** | Cap ~500 |
| Full UI / SEO / Image / Security jobs | All available | Same code, stricter concurrency |

Controlled by:

| Variable | Effect |
|----------|--------|
| `NODE_ENV=development` | Parallel jobs + bulk Link Radar (default local) |
| `QA_PARALLEL_MODULES=1` | Force parallel even if needed |
| `QA_PARALLEL_MODULES=0` | Force single-job (like production) |
| `NEXT_PUBLIC_QA_PARALLEL_MODULES=1` | Frontend parallel UI |
| `QA_ERROR_CHECK_BULK=1` | Force Link Radar bulk limits |
| `QA_ERROR_CHECK_BULK=0` | Force production Link Radar caps |

Implementation:

- Backend: `backend/shared/executionEnv.js`, `executionLock.js`, `errorCheckLimits.js`
- Frontend: `web/src/lib/parallel-execution.ts`

---

## Fresh machine install

```bash
git clone https://github.com/emranaahil/QADashboard_New_Local.git
cd QADashboard_New_Local

npm install
npm run playwright          # Chromium / Firefox / WebKit

cp .env.example .env
# Edit .env — see below

npm run dev
```

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:3011 |
| API | http://localhost:3000 |

Open the **dashboard** URL in the browser (Next proxies `/api/*` to Express).

---

## Recommended local `.env`

```env
NODE_ENV=development
PORT=3000
WEB_APP_URL=http://localhost:3011

# Optional: make parallel explicit for frontend
NEXT_PUBLIC_QA_PARALLEL_MODULES=1

# Optional external APIs
# PAGESPEED_API_KEY=...
```

Do **not** set `NODE_ENV=production` for everyday laptop use if you want multi-module parallel runs.

---

## Sample / reference reports

A small set of **bundled demo reports** ships with the repo so history/report UI is not empty on first run:

- SEO sample jobs + HTML under `backend/SEO/jobs/` and `backend/SEO/reports/`
- UI / full-UI sample jobs under `backend/ui-check/jobs/`, `backend/full-ui-check/jobs/`
- Link Radar sample JSON under `backend/error-check/reports/`
- Keyword sample under `backend/keyword-check/storage/`

Protected by `backend/shared/data/bundled-reports-manifest.json` (cannot be deleted as “user” reports in the same way as normal runs).

**Do not** commit every local scan. Only keep a few small reference reports.

---

## Git remotes (this worktree)

| Remote | Purpose |
|--------|---------|
| `origin` | Product / shared main (`QADashboard_New`) |
| `qadashboardlive` | Live deploy mirror |
| `local` | Full local backup (`QADashboard_New_Local`) |

Update the local backup after meaningful source changes:

```bash
git push local main
```

To **overwrite** the remote with this machine’s `main` (use carefully):

```bash
git push local main --force
```

---

## What not to commit

- `.env` (secrets)
- `node_modules/`, `web/.next/`
- Bulk `backend/**/jobs/*` and large `reports/` from daily scans
- Debug files (`_rr-debug.*`, `tmp-*`, MCP descriptor noise)

See `.gitignore` and [PROJECT_GUIDE.md](./PROJECT_GUIDE.md).

---

## Related docs

| File | Role |
|------|------|
| [README.md](./README.md) | Features, quick start, modules |
| [PROJECT_GUIDE.md](./PROJECT_GUIDE.md) | Architecture, job options, storage |
| [.env.example](./.env.example) | All env keys |
| [web/README.md](./web/README.md) | Next.js UI notes |
