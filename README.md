# Website Keyword Auditor

A production-ready QA toolkit that crawls websites, checks for keywords, detects broken pages, audits SEO, and runs UI quality checks — each as an isolated feature module.

## Features

| Module | Description |
|--------|-------------|
| **Keyword Check** | Crawl a site, find exact keyword matches, generate PDF reports |
| **Error Check** | Detect 404s, broken pages, and broken internal links |
| **SEO Check** | Full-site or single-URL SEO audit (headings, meta, OG tags, etc.) |
| **UI Check** | Single-URL visual QA (layout, contrast, images, buttons) |
| **Full UI Check** | Crawl an entire site and run UI checks on every page |

## Tech Stack

- **Frontend**: Next.js 15, React, Tailwind CSS (`web/`)
- **Backend**: Node.js, Express.js
- **Browser Automation**: Playwright (Chromium)
- **PDF Generation**: PDFKit (keyword check), Playwright (UI check)
- **Storage**: JSON files (per-feature folders)

For architecture, storage paths, API map, and production notes, see **[PROJECT_GUIDE.md](./PROJECT_GUIDE.md)**.

## Quick Start

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
npm install
npx playwright install chromium
npm run dev
```

Maintenance:

```bash
npm run reports:purge-test        # Remove cancelled + example.com test artifacts
npm run reports:purge-cancelled   # Remove all cancelled jobs/scans
npm run build:web && npm start   # Production
```

- **UI dashboard**: `http://localhost:3001`
- **API**: `http://localhost:3000` (redirects browser traffic to the UI)

### Modular UI

Each QA module has its own dedicated page that reads **only** its own reports:

| Module | Page URL |
|--------|----------|
| Dashboard | `http://localhost:3001/dashboard` |
| UI Testing | `http://localhost:3001/ui-testing` |
| SEO Testing | `http://localhost:3001/seo-testing` |
| Keyword Radar | `http://localhost:3001/keyword-radar` |
| Link Radar | `http://localhost:3001/link-radar` |
| History | `http://localhost:3001/history` |
| Reports | `http://localhost:3001/reports` |

Report API (per module): `GET /api/modules/<module-id>/reports`

To add a new module: register it in `backend/shared/moduleRegistry.js` and create `frontend/modules/<id>/` — no other modules need changes.

---

## Project Structure

```
project-root/
├── frontend/
│   ├── index.html               # Module hub (lists all modules)
│   ├── shared/                  # Shared CSS, API client, shell nav
│   │   ├── css/
│   │   └── js/
│   └── modules/                 # One folder per module (isolated UI)
│       ├── keyword-check/       # index.html, app.js, reports.js
│       ├── error-check/
│       ├── seo/
│       ├── ui-check/
│       └── full-ui-check/
│
├── backend/
│   ├── shared/
│   │   ├── moduleRegistry.js    # Add new modules here
│   │   └── reportUtils.js
│   ├── routes/
│   │   ├── scanRoutes.js        # Keyword + error run APIs
│   │   └── modulesRouter.js     # Per-module report APIs
│   ├── server.js                # Express server
│   ├── routes/
│   │   └── scanRoutes.js        # API routes (keyword-check + error-check)
│   │
│   ├── keyword-check/           # Keyword crawling & PDF reports
│   │   ├── crawlerService.js
│   │   ├── keywordService.js
│   │   ├── queueService.js
│   │   ├── stateService.js
│   │   ├── reportService.js
│   │   └── storage/
│   │       ├── scans/           # Scan session JSON
│   │       ├── checkpoints/     # Resume checkpoints
│   │       └── reports/         # Generated PDF reports
│   │
│   ├── error-check/             # Broken page / link detection
│   │   ├── errorCheckService.js
│   │   └── reports/             # JSON scan results
│   │
│   ├── seo/                     # SEO audit (CLI)
│   │   ├── runseo.js            # Entry point
│   │   ├── uiseocheck.js        # Audit engine
│   │   └── reports/
│   │       ├── seoReport.json   # Structured JSON report
│   │       └── reportseo.html   # HTML report
│   │
│   ├── ui-check/                # Single-URL UI check (CLI)
│   │   ├── runSingleURL.js      # Entry point
│   │   ├── runTest.js           # Alternate entry point
│   │   ├── uiChecks.js
│   │   ├── generateReport.js
│   │   ├── generatePdf.js
│   │   ├── config.js
│   │   └── reports/
│   │       ├── <runId>/         # Per-run data (qaReport.json, screenshots)
│   │       ├── qa-report.html   # Latest HTML report
│   │       └── report.pdf       # Latest PDF report
│   │
│   └── full-ui-check/           # Full-site UI crawl (CLI)
│       ├── runFullSiteUI.js     # Entry point
│       ├── discoverURL.js       # Site crawler
│       ├── queueManager.js      # Sequential URL processor
│       ├── uichecksfull/        # QA engine modules
│       └── reports/
│           ├── <runId>/         # Per-run data (qaReport.json, urlQueue, screenshots)
│           ├── job-tracker.json # Resume/progress tracker
│           ├── qa-report.html   # Latest HTML report
│           └── report.pdf       # Latest PDF report
│
├── package.json
└── README.md
```

Each feature folder is **fully self-contained** — all scripts, configs, and report output live inside that folder. No feature reads or writes reports in another feature's directory.

---

## Report Output Locations

| Module | How to Run | Report Files Saved To |
|--------|-----------|----------------------|
| **Keyword Check** | Web UI or `POST /api/scan/start` | `backend/keyword-check/storage/scans/<scanId>.json` (state) |
| | `GET /api/scan/:id/report` | `backend/keyword-check/storage/reports/keyword-audit-report-<scanId>.pdf` |
| | Checkpoints | `backend/keyword-check/storage/checkpoints/<scanId>.json` |
| **Error Check** | Web UI or `POST /api/check-broken-pages` | `backend/error-check/reports/error-check-<host>-<timestamp>.json` |
| **SEO Check** | `node backend/seo/runseo.js <url> [single\|full]` | `backend/seo/reports/seoReport.json` |
| | | `backend/seo/reports/reportseo.html` |
| **UI Check** | `node backend/ui-check/runSingleURL.js <url>` | `backend/ui-check/reports/<runId>/qaReport.json` |
| | | `backend/ui-check/reports/<runId>/screenshots/` |
| | | `backend/ui-check/reports/qa-report.html` |
| | | `backend/ui-check/reports/report.pdf` |
| **Full UI Check** | `node backend/full-ui-check/runFullSiteUI.js <url> queue` | `backend/full-ui-check/reports/<runId>/qaReport.json` |
| | `node backend/full-ui-check/runFullSiteUI.js <url> local` | `backend/full-ui-check/reports/<runId>/urlQueue.jsonl` (queue mode) |
| | | `backend/full-ui-check/reports/<runId>/screenshots/` |
| | | `backend/full-ui-check/reports/qa-report.html` |
| | | `backend/full-ui-check/reports/report.pdf` |
| | | `backend/full-ui-check/reports/job-tracker.json` |

---

## CLI Usage

### SEO Check

```bash
# Single URL
node backend/seo/runseo.js https://example.com single

# Full site (sitemap-based)
node backend/seo/runseo.js https://example.com full
```

### UI Check (single URL)

```bash
node backend/ui-check/runSingleURL.js https://example.com
```

### Full UI Check

```bash
# Crawl entire site and test each page
node backend/full-ui-check/runFullSiteUI.js https://example.com queue

# Test specific URL(s) without crawling
node backend/full-ui-check/runFullSiteUI.js https://example.com local

# Resume an interrupted queue run
node backend/full-ui-check/runFullSiteUI.js --resume <runId>
```

### Keyword Check & Error Check

Use the web dashboard at `http://localhost:3000` or the API endpoints below.

---

## API Endpoints

| Method | Endpoint | Module | Description |
|--------|----------|--------|-------------|
| POST | `/api/scan/start` | Keyword Check | Start a keyword scan |
| GET | `/api/scan/:id/status` | Keyword Check | Get scan progress |
| GET | `/api/scan/:id/results` | Keyword Check | Get scan results |
| GET | `/api/scan/:id/report` | Keyword Check | Download PDF report |
| GET | `/api/scans` | Keyword Check | List all scans |
| DELETE | `/api/scan/:id` | Keyword Check | Delete a scan |
| POST | `/api/check-broken-pages` | Error Check | Run broken page check |
| GET | `/api/check-broken-pages/status` | Error Check | Live progress polling |
| GET | `/api/health` | Server | Health check |

---

## Deployment

### Render (Docker — recommended)

Playwright needs at least **512MB RAM** (Render Starter plan or higher). The repo includes a Blueprint at `render.yaml`.

1. Push the repo to GitHub/GitLab
2. In Render: **New → Blueprint** → select the repository
3. Render builds the Docker image from `Dockerfile` and deploys `qa-dashboard`
4. A **5GB persistent disk** is mounted at `/app/data` (jobs, reports, scans survive redeploys)

Required environment variables (set automatically by the Blueprint):

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `PORT` | `10000` |
| `STORAGE_ROOT` | `/app/data` |
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | `true` |
| `PLAYWRIGHT_CHROMIUM_SANDBOX` | `false` |
| `JOB_RECOVER_ON_STARTUP` | `false` |

Health check: `GET /api/health`

### Docker (local production test)

```bash
npm run docker:build
npm run docker:up
```

Dashboard: `http://localhost:3000` (mapped to container port 10000)

Data persists in the `qa-data` Docker volume.

### Manual Render Web Service (without Blueprint)

- **Runtime**: Docker
- **Dockerfile path**: `./Dockerfile`
- **Health check path**: `/api/health`
- Attach a disk at `/app/data` and set `STORAGE_ROOT=/app/data`

### Local Development

```bash
npm install
npx playwright install chromium
npm run dev
```

---

## Configuration

### Keyword Check

- **Batch Size**: 50 URLs per batch
- **Concurrency**: 1 simultaneous page (memory-safe)
- **Max URLs**: 3000
- **Page Timeout**: 30 seconds
- **Navigation Timeout**: 60 seconds

### Environment Variables

| Variable | Description |
|----------|-------------|
| `STORAGE_ROOT` | Persistent data root (`/app/data` in Docker/Render) |
| `JOB_RECOVER_ON_STARTUP` | Re-queue jobs after restart (`false` recommended in production) |
| `QA_REPORT_HTML_PATH` | Override HTML report output path |
| `QA_REPORT_PDF_PATH` | Override PDF report output path |
| `SKIP_PDF=1` | Skip PDF generation |
| `QA_CLEANUP_REPORTS=1` | Auto-clean old report runs |

---

## License

MIT License

## Author

**Md Imran**