# QA Dashboard — Project Guide

Maintainer reference for architecture, storage, APIs, and dev/production workflows.

---

## What this project is

| UI name | Module ID | Purpose |
|---------|-----------|---------|
| Keyword Radar | `keyword-check` | Crawl site, find keyword matches |
| Link Radar | `error-check` | Broken pages & internal links |
| SEO Testing | `seo` | Meta, headings, SEO score |
| UI Testing (single) | `ui-check` | Single-URL visual QA (multi-URL via commas) |
| UI Testing (full site) | `full-ui-check` | Crawl + UI QA per page |

**Stack:** Express (`backend/`) + Next.js 15 (`web/`) + Playwright.

**UI:** Only `web/` — legacy static `frontend/` was removed. Old `/modules/*` URLs redirect via `web/next.config.ts`.

---

## Ports

| Environment | UI | API |
|-------------|-----|-----|
| Development | http://localhost:3001 | http://localhost:3000 |
| Production | `PORT` (default `10000`) | `API_PORT` (default `3000`, internal) |

```bash
npm run dev              # API + UI (hot reload)
npm run dev:restart      # Kill 3000/3001, then dev
npm run build:web && npm start
```

Next.js rewrites `/api/*` → Express. **Open port 3001 in dev**, not 3000 alone.

---

## Repository layout

```
project-root/
├── web/                         # Next.js dashboard (sole UI)
│   ├── src/app/                 # App Router pages
│   ├── src/components/modules/  # ui-testing-workspace, device-selector, …
│   ├── src/lib/api.ts           # API client
│   └── next.config.ts           # API proxy + legacy redirects
├── backend/
│   ├── server.js
│   ├── shared/                  # jobStore, jobQueue, browserService, deviceService
│   ├── routes/
│   ├── keyword-check/
│   ├── error-check/
│   ├── SEO/
│   ├── ui-check/
│   └── full-ui-check/
├── scripts/                     # start-production, purge/clear reports
├── .github/workflows/ci.yml     # Lint + build on push
├── Dockerfile
└── render.yaml
```

---

## Module registry

**File:** `backend/shared/moduleRegistry.js`

Report APIs:

- `GET /api/modules/:moduleId/reports`
- `GET /api/modules/:moduleId/jobs/:jobId/report`
- `POST /api/modules/:moduleId/jobs` (ui-check, full-ui-check, seo)

---

## Report storage

| Module | Path | Formats |
|--------|------|---------|
| keyword-check | `backend/keyword-check/storage/` | JSON, PDF, HTML (API) |
| error-check | `backend/error-check/reports/` | JSON, HTML (API) |
| seo | `backend/SEO/jobs/<id>/` | JSON, HTML |
| ui-check | `backend/ui-check/jobs/<id>/` | JSON, HTML, screenshots |
| full-ui-check | `backend/full-ui-check/jobs/<id>/` | JSON, HTML, screenshots |

Job state: `job.json` per folder (`pending` | `running` | `completed` | `failed` | `cancelled`).

On Render with `STORAGE_ROOT`, data lives on the persistent disk. Live reports may expire (ephemeral TTL); bundled reports are seeded on startup.

---

## UI Testing specifics

### Single page — multiple URLs
Comma-separated URLs in one job → one `qaReport.json` / `qa-report.html`.

### Browsers
`GET /api/config/browsers?scope=ui` → Chrome, Firefox, Safari.  
Stored in `job.options.browser`; launched via `backend/shared/services/browserService.js`.

### Devices
`GET /api/config/devices` → Desktop, iPhone13, iPhone15 Plus, S21, Tablet (portrait).  
Custom viewports supported in UI. Landscape: use custom width×height (presets planned).

### Full website
- Default 8 pages; warn above 10 on live hosting
- URL priority queue after crawl
- Stale job heartbeat recovery

---

## API overview

### Keyword & Link (scan-based)

| Method | Route |
|--------|-------|
| POST | `/api/scan/start` |
| GET | `/api/scan/:id/status` |
| POST | `/api/check-broken-pages` |
| GET | `/api/check-broken-pages/status` |

### Jobs (UI + SEO)

| Method | Route |
|--------|-------|
| POST | `/api/modules/:moduleId/jobs` |
| GET | `/api/modules/:moduleId/jobs/:jobId` |
| POST | `/api/execution/cancel` |

### Config

| Method | Route |
|--------|-------|
| GET | `/api/config/devices` |
| GET | `/api/config/browsers` |
| GET | `/api/config/browsers?scope=ui` |

---

## Frontend state (Zustand)

| Store | File | Role |
|-------|------|------|
| `useScanStore` | `web/src/store/scan-store.ts` | Keyword + Link runs |
| `useExecutionStore` | `web/src/store/execution-store.ts` | UI + SEO jobs |
| `useDashboardStore` | `web/src/store/dashboard-store.ts` | Dashboard refresh |

Session: `web/src/lib/session.ts` — anonymous per-browser `X-QA-Session-Id` for live run isolation.

---

## Maintenance scripts

```bash
npm run reports:clear
npm run reports:purge-test
npm run reports:purge-cancelled
npm run dev:restart
npm run playwright    # chromium firefox webkit
```

---

## Production checklist

1. `npm install` && `npm run build:web`
2. Env: `NODE_ENV=production`, `PORT`, `STORAGE_ROOT`, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true`
3. `npm start` → `scripts/start-production.js` (API + Next standalone)
4. Optional: `npm run reports:purge-test` before deploy

**Docker:** `npm run docker:build` / `docker:up`

---

## CI

`.github/workflows/ci.yml` — on push/PR to `main`:

- Install deps (skip Playwright download)
- `npm run lint` in `web/`
- `npm run build:web`

---

## Key files

| Task | Files |
|------|-------|
| Add module | `moduleRegistry.js`, `web/src/app/<page>/` |
| UI test engine | `backend/ui-check/uiChecks.js`, `generateReport.js`, `runJob.js` |
| Job lifecycle | `backend/shared/jobStore.js`, `jobQueue.js` |
| Browsers | `backend/shared/services/browserService.js` |
| API client | `web/src/lib/api.ts` |

---

## Legacy URL redirects

| Old path | New path |
|----------|----------|
| `/modules/ui-check` | `/ui-testing` |
| `/modules/full-ui-check` | `/ui-testing` |
| `/modules/seo` | `/seo-testing` |
| `/modules/keyword-check` | `/keyword-radar` |
| `/modules/error-check` | `/link-radar` |
| `/linkradar` | `/link-radar` |

---

MIT License — Md Imran