# QA Dashboard — Project Guide

This document is a **maintainer / AI context guide** for the Website Keyword Auditor (QA Dashboard). Use it to understand architecture, where data lives, how features connect, and how to run the app in dev vs production.

---

## What this project is

A **multi-module QA toolkit** for websites:

| User-facing name | Module ID | Purpose |
|------------------|-----------|---------|
| Keyword Radar | `keyword-check` | Crawl site, find keyword matches |
| Link Radar | `error-check` | Broken pages & broken internal links |
| SEO Testing | `seo` | Meta, headings, SEO score per page |
| UI Testing | `ui-check` | Single-URL visual QA |
| Full UI Testing | `full-ui-check` | Crawl + UI QA on every page |

**Stack:** Express API (`backend/`) + Next.js 15 UI (`web/`) + Playwright for browser automation.

---

## Ports & entry points

| Environment | UI | API |
|-------------|-----|-----|
| Development | `http://localhost:3001` | `http://localhost:3000` |
| Production | `PORT` (default `10000`) | `API_PORT` (default `3000`, internal) |

```bash
# Development (both API + UI with hot reload)
npm run dev

# Production (build UI first)
npm run build:web
npm start
```

The Next.js app proxies `/api/*` → Express via `web/next.config.ts` rewrites. **Always open the UI port (3001 in dev), not the API port alone.**

---

## Repository layout

```
project-root/
├── backend/                 # Express API + QA engines
│   ├── server.js            # Main server
│   ├── shared/              # moduleRegistry, jobStore, deviceService, radarReportHtml
│   ├── routes/              # scanRoutes, modulesRouter, jobsRouter, dashboardRouter
│   ├── keyword-check/       # Keyword crawl + PDF
│   ├── error-check/         # Link / broken page check
│   ├── SEO/                 # SEO audit jobs
│   ├── ui-check/            # Single-page UI jobs
│   └── full-ui-check/       # Full-site UI jobs
├── web/                     # Next.js dashboard
│   └── src/
│       ├── app/             # Pages: dashboard, ui-testing, seo-testing, keyword-radar, link-radar
│       ├── components/      # UI components, device-selector, radar-report-panel
│       ├── store/           # Zustand: scan-store, execution-store, dashboard-store
│       └── lib/             # api.ts, radar-report-utils.ts, url-validation.ts
├── frontend/                # Legacy static UI (still in repo; Next.js is primary)
├── scripts/                 # start-production, purge-test-reports, clear-all-reports
├── package.json
├── README.md                # User-facing readme
└── PROJECT_GUIDE.md         # This file
```

---

## Module registry (single source of truth)

**File:** `backend/shared/moduleRegistry.js`

Adding a module = one registry entry + `reportReader.js` in the module folder. The API exposes:

- `GET /api/modules/:moduleId/reports`
- `GET /api/modules/:moduleId/reports/:reportId`
- `GET /api/modules/:moduleId/reports/:reportId/html`
- `GET /api/modules/:moduleId/jobs/:jobId/report` (job HTML for ui-check, seo, full-ui-check)

---

## Report storage

| Module | Storage path | Formats |
|--------|--------------|---------|
| keyword-check | `backend/keyword-check/storage/scans/*.json` | JSON, PDF (on demand), HTML (on demand via API) |
| error-check | `backend/error-check/reports/error-check-<host>-<ts>.json` | JSON, HTML (on demand via API) |
| seo | `backend/SEO/jobs/<jobId>/` + `backend/SEO/reports/<ts>/` | JSON, HTML |
| ui-check | `backend/ui-check/jobs/<jobId>/` | JSON, HTML, screenshots |
| full-ui-check | `backend/full-ui-check/jobs/<jobId>/` | JSON, HTML, screenshots, queue files |

Job state file: `job.json` per job folder (`status`: `running` | `completed` | `failed` | `cancelled`).

---

## API overview

### Keyword & Link (scan store, non-job)

| Method | Route | Module |
|--------|-------|--------|
| POST | `/api/scan/start` | Keyword Radar |
| GET | `/api/scan/:id/status` | Keyword Radar |
| POST | `/api/scan/:id/cancel` | Keyword Radar |
| POST | `/api/check-broken-pages` | Link Radar |
| GET | `/api/check-broken-pages/status` | Link Radar |
| POST | `/api/check-broken-pages/cancel` | Link Radar |

### UI / SEO (job-based)

| Method | Route |
|--------|-------|
| POST | `/api/modules/:moduleId/jobs` |
| GET | `/api/modules/:moduleId/jobs/:jobId` |
| POST | `/api/execution/cancel` |

### Config

| Method | Route |
|--------|-------|
| GET | `/api/config/devices` | Portrait-only presets (landscape removed) |

---

## Frontend state

| Store | File | Role |
|-------|------|------|
| `useScanStore` | `web/src/store/scan-store.ts` | Keyword + Link runs, polling, cancel, resume after navigation |
| `useExecutionStore` | `web/src/store/execution-store.ts` | UI + SEO job runner |
| `useDashboardStore` | `web/src/store/dashboard-store.ts` | `refreshKey` to reload reports/history |

`ScanResumeBootstrap` (`web/src/components/layout/scan-resume-bootstrap.tsx`) re-attaches in-flight keyword/link scans after client navigation.

---

## Feature notes (recent production behavior)

### SEO Testing
- **Avg SEO Score** rounded to whole numbers (`Math.round`) in backend + frontend.
- Reports: `backend/SEO/uiseocheck.js` → `averageSeoScore()`.

### Link Radar
- Stop/cancel closes Playwright immediately; status API returns `cancelled`/`idle` so refresh does not restart the check.
- Progress set to `running` synchronously on start (no idle flicker).
- HTML report via `backend/shared/radarReportHtml.js` + iframe in `RadarReportPanel`.
- Export CSV + Copy All Links on report panel.
- Default URL field is **empty** (not `example.com`).

### Keyword Radar
- Same HTML / CSV / Copy Links panel as Link Radar.
- Auto-selects scan report by `scanId` on completion.

### UI Testing — Devices
- Landscape presets removed from `backend/shared/services/deviceService.js`.
- Catalog: Desktop, iPhone13/15/S21/Tablet **Portrait** only.
- Default selection: **Desktop only**.

### Screenshot viewer (UI reports)
- Zoom/pan fixed in `backend/ui-check/generateReport.js` (no CSS double-scale).

---

## Maintenance scripts

```bash
# Remove ALL reports (destructive)
npm run reports:clear

# Remove test data: cancelled jobs + example.com artifacts
npm run reports:purge-test

# Remove ALL cancelled jobs/scans (any URL)
npm run reports:purge-cancelled

# Restart dev servers
npm run dev:restart
```

**Purge script:** `scripts/purge-test-reports.js`  
Removes:
- Job folders with `status: cancelled` and URL host `example.com`
- All `ui-check` jobs targeting `example.com`
- All `error-check` JSON reports for `example.com`
- Orphan `full-ui-check/qa-report.html` test file
- `example.com` keys in `backend/shared/data/test-executions.json`

---

## Production checklist

1. `npm install` && `npx playwright install chromium`
2. `npm run build:web`
3. Set env: `NODE_ENV=production`, `PORT`, `API_PORT`, optional `API_URL` for Next → API
4. `npm start` (runs `scripts/start-production.js`)
5. Optionally run `npm run reports:purge-test` before deploy to strip test artifacts

**Docker:** `npm run docker:build` / `docker:up` (see `docker-compose` if present).

---

## Key files to read first

| Task | Files |
|------|-------|
| Add module | `backend/shared/moduleRegistry.js`, `backend/routes/modulesRouter.js` |
| Link check logic | `backend/error-check/errorCheckService.js` |
| Keyword crawl | `backend/keyword-check/crawlerService.js` |
| SEO audit | `backend/SEO/uiseocheck.js`, `backend/SEO/runJob.js` |
| UI QA engine | `backend/ui-check/uiChecks.js`, `generateReport.js` |
| Job lifecycle | `backend/shared/jobStore.js`, `jobQueue.js` |
| Next pages | `web/src/app/*/page.tsx` |
| API client | `web/src/lib/api.ts` |
| Radar reports UI | `web/src/components/modules/radar-report-panel.tsx` |

---

## Worktree note

Active development may run from a Grok worktree path, e.g.:

`C:\Users\<user>\.grok\worktrees\qaiachatbot-qa-dashboard\<branch-id>`

Changes are **not** visible if dev is started from a different clone (e.g. `D:\Project\...`). Run `npm run dev` from the worktree where edits were made.

---

## Author / license

Md Imran — MIT License (`package.json`).