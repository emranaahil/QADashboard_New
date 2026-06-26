# QA Dashboard

A multi-module website QA toolkit: keyword search, broken-link detection, SEO audits, and Playwright-based visual UI testing — with a Next.js dashboard and Express API.

## Features

| Module | Page | Description |
|--------|------|-------------|
| **Keyword Radar** | `/keyword-radar` | Crawl a site and find keyword matches (PDF export) |
| **Link Radar** | `/link-radar` | Detect 404s and broken internal links |
| **SEO Testing** | `/seo-testing` | Single-page or full-site SEO audit |
| **UI Testing** | `/ui-testing` | Single-page (incl. comma-separated URLs) or full-site visual QA |
| **Dashboard** | `/dashboard` | Stats overview |
| **History** | `/history` | Past runs |
| **Reports** | `/reports` | Report center |

## Tech stack

- **UI:** Next.js 15, React, Tailwind CSS (`web/`)
- **API:** Node.js, Express (`backend/`)
- **Automation:** Playwright (Chromium, Firefox, WebKit)
- **Storage:** JSON files under `backend/` (jobs, scans, reports)

See **[PROJECT_GUIDE.md](./PROJECT_GUIDE.md)** for architecture, storage paths, and production notes.

## Quick start

**Prerequisites:** Node.js 18+

```bash
npm install
npm run playwright    # installs Chromium, Firefox, WebKit locally
npm run dev
```

| Service | Dev URL |
|---------|---------|
| **Dashboard (use this)** | http://localhost:3001 |
| API | http://localhost:3000 |

```bash
npm run dev:restart   # kill ports 3000/3001 and restart
npm run build:web && npm start   # production
```

## Project structure

```
project-root/
├── web/                     # Next.js dashboard (primary UI)
│   └── src/app/             # dashboard, ui-testing, seo-testing, …
├── backend/
│   ├── server.js            # Express API
│   ├── shared/              # jobStore, moduleRegistry, browserService, …
│   ├── routes/              # API routers
│   ├── keyword-check/       # Keyword crawl engine
│   ├── error-check/         # Link / broken page engine
│   ├── SEO/                 # SEO audit jobs
│   ├── ui-check/            # Single-page UI jobs
│   └── full-ui-check/       # Full-site UI crawl jobs
├── scripts/                 # start-production, report purge, healthcheck
├── .github/workflows/       # CI (lint + build on push)
├── package.json
├── Dockerfile
└── render.yaml
```

## Adding a new module

1. Register in `backend/shared/moduleRegistry.js`
2. Add backend engine + `reportReader.js` in `backend/<module-id>/`
3. Add a Next.js page under `web/src/app/<route>/`

## Maintenance

```bash
npm run reports:purge-test        # Remove cancelled + example.com artifacts
npm run reports:purge-cancelled   # Remove all cancelled jobs/scans
npm run reports:clear             # Remove all report artifacts (destructive)
```

## Deployment (Render / Docker)

- **Dockerfile** uses Playwright base image; UI built from `web/`
- Set `STORAGE_ROOT=/app/data` and attach a persistent disk
- Health check: `GET /api/health`

| Variable | Purpose |
|----------|---------|
| `STORAGE_ROOT` | Persistent data root |
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | `true` in Docker (browsers pre-installed) |
| `JOB_RECOVER_ON_STARTUP` | `false` recommended on production |

## CI

GitHub Actions runs on every push/PR to `main`:

- `npm ci` (root + web)
- `npm run lint` (web)
- `npm run build:web`

Workflow: `.github/workflows/ci.yml`

## License

MIT — Md Imran