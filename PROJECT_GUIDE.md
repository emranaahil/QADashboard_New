# QA Dashboard — Project Guide

Maintainer reference: architecture, modules, storage, APIs, Seo/Geo details, and ops.

---

## What this project is

A multi-module **website QA dashboard**: crawl and audit sites, run Playwright checks, store job artifacts, and view HTML/JSON/PDF/CSV reports from a Next.js UI.

| UI name | Module ID | Purpose |
|---------|-----------|---------|
| Keyword Radar | `keyword-check` | Crawl site, find keyword matches |
| Link Radar | `error-check` | Broken pages & links; plain-English issues; CSV/Excel export |
| Seo/Geo Audit | `seo` | Toggleable SEO / GEO / security headers; optional PageSpeed & Rich Results |
| UI Testing (single) | `ui-check` | Single-URL visual QA (multi-URL via list/commas) |
| UI Testing (full site) | `full-ui-check` | Crawl + UI QA per page |
| Sitemap Audit | `sitemap-check` | Sitemap tree walk + page status checks |
| Image Audit | `image-audit` | Image quality, CDN, duplicates, a11y/SEO |
| Security Audit | `security-audit` | PageSpeed, W3C, robots, redirects, SSL Labs |

**Stack:** Express (`backend/`) + Next.js 15 (`web/`) + Playwright.

**UI:** Only `web/`. Legacy `/modules/*` URLs redirect via `web/next.config.ts`.

---

## Ports

| Environment | UI | API |
|-------------|-----|-----|
| Development (`npm run dev`) | http://localhost:**3011** | http://localhost:**3000** |
| Production | `PORT` (often `10000`) | `API_PORT` (default `3000`, internal) |

```bash
npm run dev              # API + UI (concurrently)
npm run dev:restart      # Kill busy ports, then dev
npm run build:web && npm start
```

Next.js rewrites `/api/*` → Express (`API_URL` / `http://127.0.0.1:3000`). Open the **UI** port in the browser.

---

## Repository layout

```
project-root/
├── web/                         # Next.js dashboard (sole UI)
│   ├── src/app/                 # App Router pages
│   ├── src/components/          # modules, layout, UI kit
│   ├── src/lib/                 # api.ts, modules, export helpers
│   └── next.config.ts           # API proxy + redirects
├── backend/
│   ├── server.js
│   ├── shared/                  # jobStore, moduleRegistry, services, CSV/HTML helpers
│   ├── routes/
│   ├── keyword-check/
│   ├── error-check/
│   ├── SEO/                     # uiseocheck.js, runJob.js, reports/
│   ├── ui-check/
│   ├── full-ui-check/
│   ├── sitemap-check/
│   ├── image-audit/
│   └── security-audit/
├── scripts/
├── .github/workflows/ci.yml
├── Dockerfile
├── render.yaml
├── README.md
└── PROJECT_GUIDE.md
```

---

## Module registry

**File:** `backend/shared/moduleRegistry.js`

Registering a module here wires report readers and listing. UI labels: `web/src/lib/modules.ts`.

Typical report APIs:

- `GET /api/modules/:moduleId/reports`
- `GET /api/modules/:moduleId/jobs/:jobId/report`
- `POST /api/modules/:moduleId/jobs`

---

## Seo/Geo Audit (`seo`) — detail

### Engine

| File | Role |
|------|------|
| `backend/SEO/uiseocheck.js` | Core audit + HTML report generation |
| `backend/SEO/runJob.js` | Job runner (queue worker) |
| `backend/SEO/reportReader.js` | Serve / regenerate reports |
| `backend/SEO/seoReportStorage.js` | `reports/<runId>/` artifacts |
| `backend/shared/services/pageSpeedInsights.js` | Official PageSpeed API |
| `backend/shared/services/richResultsTest.js` | Optional Rich Results Test capture (Playwright) |
| `backend/shared/httpSecurityHeaders.js` | HTTP security header policy |
| `backend/shared/seoReportCsv.js` | Pages / issues CSV |
| `backend/shared/seoReportDetailClient.js` | Lazy page detail JS in HTML |

### Report cards (per page)

Cards render only for modules enabled on that run (`page.auditModules` / legacy defaults).

1. **SEO** — on-page issues (critical / minor) when `includeSeo`  
2. **GEO** — structured data / AI-readiness; Critical / Minor / Warning when `includeGeo`  
3. **Security Headers** — response header checks when `includeSecurityHeaders`  
4. **Page Speed** — if `includePageSpeed` and API key configured  
5. **Google Rich Results** — if `includeRichResults` (main URL only)

### Job options

| Option | Default | Behavior |
|--------|---------|----------|
| `mode` | `single` | `single` (one or many URLs) or `full` (crawl) |
| `includeSeo` | `true` (if omitted) | On-page SEO rules, robots.txt site check, cross-page duplicates |
| `includeGeo` | `true` (if omitted) | GEO / structured-data audit |
| `includeSecurityHeaders` | `true` (if omitted) | Per-page + site HTTP security headers |
| `includePageSpeed` | `false` | PageSpeed Insights mobile + desktop per page (slower; concurrency 1) |
| `includeRichResults` | `false` | Playwright open of Google Rich Results Test for **main URL**; screenshot + tool URL |

UI: `web/src/components/modules/seo-testing-workspace.tsx` — core toggles default **on**; optional PageSpeed / Rich Results default **off**.

### GEO severity (summary)

| Severity | Examples |
|----------|----------|
| Critical | No Schema.org data, invalid Schema/JSON-LD, invalid GeoJSON |
| Minor | Invalid Microdata/RDFa, missing FAQ, semantic HTML, outdated content date |
| Warning | Map without coordinates, placeholder content, outdated copyright |

GEO warnings do **not** reduce the SEO score; critical/minor GEO do.

### Google PageSpeed

- **Official API** + `PAGESPEED_API_KEY`  
- Soft-fail if key missing or request errors  
- Same pattern as optional external checks in Security Audit  

### Google Rich Results (important)

| Fact | Detail |
|------|--------|
| Tool URL | `https://search.google.com/test/rich-results?url=<encoded>` |
| Official bulk API for arbitrary URLs | **None** (unlike PageSpeed) |
| Automation | Playwright best-effort; waits for result UI (e.g. “Test results”) up to ~4 minutes |
| Common failure | Google shows login / “Something went wrong — Log in and try again” to **headless** clients |
| Manual | Same URL often works in normal or **incognito** Chrome |
| Product rule | **Local Schema/GEO is the source of truth**; Rich Results is optional evidence + deep link |
| Not recommended | Cookie injection, stealth browsers, CAPTCHA solvers as production path |
| Future official path | Search Console **URL Inspection API** (`richResultsResult`) for **verified** properties only (OAuth) |

Screenshots (when captured) are stored under the report folder as `rich-results/<slug>.png` and embedded in HTML (base64) when possible.

### UI entry

- Page: `web/src/app/seo-testing/page.tsx`  
- Workspace: `web/src/components/modules/seo-testing-workspace.tsx`  
- Toggles: SEO, GEO, Security headers, Google PageSpeed, Google Rich Results  

---

## Link Radar (`error-check`)

| File | Role |
|------|------|
| `backend/error-check/errorCheckService.js` | Crawl + detect broken pages/links |
| `backend/shared/linkRadarIssueExplain.js` | Plain-English issue explanations |
| `backend/shared/linkRadarCsv.js` | CSV / Excel export builders |
| `backend/shared/radarReportHtml.js` | HTML report (+ Download CSV / Excel buttons) |
| `web/src/lib/radar-report-utils.ts` | Dashboard CSV + formatted Excel download |
| `web/src/app/link-radar/page.tsx` | UI |

**Export columns:** `Main URL` · `URL` · `Issues` (plain language + what it means / what to do).

**Limits:** `backend/shared/errorCheckLimits.js` — production ~500 URLs; local bulk up to ~10k when `NODE_ENV !== production` (or `QA_ERROR_CHECK_BULK=1`).

---

## Local parallel execution

| File | Role |
|------|------|
| `backend/shared/executionEnv.js` | `isParallelExecutionEnabled()` |
| `backend/shared/executionLock.js` | Single vs per-module job lock |
| `web/src/lib/parallel-execution.ts` | Frontend parallel flag |

Default: parallel **on** in development, **off** in production. Override with `QA_PARALLEL_MODULES` / `NEXT_PUBLIC_QA_PARALLEL_MODULES`.

Full laptop restore: [LOCAL_SETUP.md](./LOCAL_SETUP.md).

---

## Sitemap Audit (`sitemap-check`)

- Full sitemap **tree walk** (nested sitemaps + page URLs)  
- Status checks **follow redirects**; **Pass = final HTTP 200**  
- Summary: sitemap files, nested counts, pages found/checked, pass/fail  
- CSV export for pages / sitemaps where implemented  

---

## Image Audit (`image-audit`)

- Image inventory, duplicates, optimization signals, accessibility/SEO notes  
- HTML + CSV reports; percent columns omit empty/negative noise where configured  

---

## Security Audit (`security-audit`)

Optional checks (UI toggles): PageSpeed, W3C Nu HTML, robots.txt, redirect trace, SSL Labs.  
Env: `PAGESPEED_API_KEY`, `W3C_VALIDATOR_*`, `SSL_LABS_*` (see `.env.example`).

---

## Report storage (typical)

| Module | Path pattern | Formats |
|--------|--------------|---------|
| keyword-check | `backend/keyword-check/storage/` | JSON, PDF, HTML |
| error-check | `backend/error-check/reports/` | JSON, HTML |
| seo | `backend/SEO/reports/<runId>/`, jobs under `SEO/jobs/` | JSON, HTML, optional `rich-results/` |
| ui-check | `backend/ui-check/jobs/<id>/` | JSON, HTML, screenshots |
| full-ui-check | `backend/full-ui-check/jobs/<id>/` | JSON, HTML, screenshots |
| sitemap-check | under module storage / jobs | JSON, HTML, CSV |
| image-audit | under module storage | JSON, HTML, CSV |
| security-audit | under module storage / jobs | JSON, HTML |

With `STORAGE_ROOT`, paths resolve under that root (see `backend/shared/storagePaths.js`).

Job state: `job.json` — `pending` | `running` | `completed` | `failed` | `cancelled`.

---

## UI Testing specifics

### Single page — multiple URLs

Comma-separated or list input → one job / report where supported.

### Browsers & devices

- `GET /api/config/browsers?scope=ui`  
- `GET /api/config/devices`  
- Launch via `backend/shared/services/browserService.js`

### Full website

- Crawl limits / concurrency tuned in full-ui-check  
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

### Jobs (UI, SEO, sitemap, image, security, …)

| Method | Route |
|--------|-------|
| POST | `/api/modules/:moduleId/jobs` |
| GET | `/api/modules/:moduleId/jobs/:jobId` |
| GET | `/api/modules/:moduleId/jobs/:jobId/report` |
| POST | `/api/execution/cancel` |

### Config

| Method | Route |
|--------|-------|
| GET | `/api/config/devices` |
| GET | `/api/config/browsers` |
| GET | `/api/health` |

---

## Frontend state (Zustand)

| Store | File | Role |
|-------|------|------|
| `useScanStore` | `web/src/store/scan-store.ts` | Keyword + Link runs |
| `useExecutionStore` | `web/src/store/execution-store.ts` | Job modules (UI, SEO, …) |
| `useDashboardStore` | `web/src/store/dashboard-store.ts` | Dashboard refresh |

Session: `web/src/lib/session.ts` — `X-QA-Session-Id` for live isolation where used.

---

## Privacy / disclaimer

Collapsible/modal privacy notice near run actions (`privacy-disclaimer-notice`, run-test actions panel). Keep user-facing copy accurate when changing crawl/scan behavior.

---

## Maintenance scripts

```bash
npm run reports:clear
npm run reports:purge-test
npm run reports:purge-cancelled
npm run dev:restart
npm run playwright
```

---

## Production checklist

1. `npm install` && `npm run build:web`  
2. Env: `NODE_ENV=production`, `PORT`, `STORAGE_ROOT`, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true`  
3. Optional: `PAGESPEED_API_KEY`, W3C / SSL Labs vars  
4. `npm start` → `scripts/start-production.js`  
5. Optional: purge test reports before deploy  

**Docker:** `npm run docker:build` / `docker:up`

---

## CI

`.github/workflows/ci.yml` — push/PR to `main`:

- Install deps (Playwright download may be skipped)  
- Web lint  
- `npm run build:web`  

---

## Key files

| Task | Files |
|------|-------|
| Add module | `moduleRegistry.js`, `web/src/lib/modules.ts`, `web/src/app/<page>/` |
| Seo/Geo engine | `backend/SEO/uiseocheck.js`, `runJob.js` |
| Rich Results capture | `backend/shared/services/richResultsTest.js` |
| PageSpeed | `backend/shared/services/pageSpeedInsights.js` |
| Job lifecycle | `backend/shared/jobStore.js`, queue / execution routes |
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
| `/modules/sitemap-check` | `/sitemap-check` |
| `/modules/image-audit` | `/image-audit` |
| `/modules/security-audit` | `/security-audit` |
| `/linkradar` | `/link-radar` |

---

## Bundled sample reports

Manifest: `backend/shared/data/bundled-reports-manifest.json`  
Seeding: `backend/shared/seedBundledStorage.js` (when `STORAGE_ROOT` is set)

Keep only **small reference** jobs/reports in git (SEO samples, one Link Radar sample, keyword sample, a few UI jobs). Do not commit every local scan.

---

## Docs map

| File | Audience |
|------|----------|
| [README.md](./README.md) | Quick start, feature list, deploy |
| [PROJECT_GUIDE.md](./PROJECT_GUIDE.md) | This file — architecture & module details |
| [LOCAL_SETUP.md](./LOCAL_SETUP.md) | New machine / local parallel / remotes |
| [web/README.md](./web/README.md) | Next.js UI-only notes |
| [.env.example](./.env.example) | Environment variables |

---

MIT License — Md Imran
