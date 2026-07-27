# QA Dashboard

Multi-module website QA toolkit with a **Next.js** dashboard and **Express** API. Crawl, audit, and report on SEO/GEO, links, keywords, UI, images, sitemaps, and security — using **Playwright** for browser automation.

| Doc | Purpose |
|-----|---------|
| **[PROJECT_GUIDE.md](./PROJECT_GUIDE.md)** | Architecture, storage, APIs, module details |
| **[LOCAL_SETUP.md](./LOCAL_SETUP.md)** | Clone on a new machine, local parallel mode, sample reports |

---

## Features (modules)

| UI name | Route | Module ID | Description |
|---------|-------|-----------|-------------|
| **Keyword Radar** | `/keyword-radar` | `keyword-check` | Crawl a site and find keyword matches (JSON / HTML / PDF) |
| **Link Radar** | `/link-radar` | `error-check` | Broken pages & internal links; plain-English issues; CSV/Excel export |
| **Seo/Geo Audit** | `/seo-testing` | `seo` | Toggleable SEO, GEO, security headers; optional PageSpeed & Rich Results |
| **UI Testing** | `/ui-testing` | `ui-check` / `full-ui-check` | Single-page (multi-URL) or full-site visual QA |
| **Sitemap Audit** | `/sitemap-check` | `sitemap-check` | Walk sitemap tree, check page HTTP status (pass = final 200) |
| **Image Audit** | `/image-audit` | `image-audit` | Duplicates, CDN, optimization, accessibility, SEO |
| **Security Audit** | `/security-audit` | `security-audit` | PageSpeed, W3C HTML, robots.txt, redirects, SSL Labs |
| **Dashboard** | `/dashboard` | — | Overview stats |
| **Reports** | `/reports` | — | Report center |

> **History** may still be available at `/history` in some builds; it is not always listed in the main sidebar.

---

## Local vs production (same code)

One codebase. Behavior changes with env:

| Mode | Parallel multi-module runs | Link Radar URL cap (approx.) |
|------|----------------------------|------------------------------|
| **Local** (`NODE_ENV=development`) | Yes | Up to ~10 000 |
| **Production** (`NODE_ENV=production`) | No (unless `QA_PARALLEL_MODULES=1`) | ~500 |

See **[LOCAL_SETUP.md](./LOCAL_SETUP.md)** for a full laptop restore.

---

## Seo/Geo Audit (highlights)

| Area | What it does |
|------|----------------|
| **SEO** (toggle, default on) | Titles, H1, hierarchy, meta, Open Graph, bad links, alt text, score |
| **GEO** (toggle, default on) | Schema.org / JSON-LD, Microdata/RDFa, GeoJSON/maps, FAQ, freshness — **Critical / Minor / Warning** |
| **Security headers** (toggle, default on) | CSP, HSTS, XFO, etc. — Critical / Minor / Warning |
| **Google PageSpeed** (optional) | Official **PageSpeed Insights API** (`PAGESPEED_API_KEY`) |
| **Google Rich Results** (optional) | Best-effort Playwright screenshot of [Rich Results Test](https://search.google.com/test/rich-results) (**main URL only**). Headless often login-walled; **local Schema/GEO is source of truth**. |
| **Reports** | HTML cards only for **enabled** modules; CSV export (pages + issues) |

**Job options:** `mode`, `includeSeo`, `includeGeo`, `includeSecurityHeaders`, `includePageSpeed`, `includeRichResults` (core modules default **on** if omitted).

---

## Link Radar (highlights)

- Flags bad **HTTP status** (404, 410, …) and high-confidence error content  
- Plain-English **What it means / What to do** in the HTML report (including “looks fine but HTTP 410”)  
- **Download CSV** and **Download Excel (formatted)** — columns: `Main URL` · `URL` · `Issues`

---

## Tech stack

| Layer | Technology |
|-------|------------|
| UI | Next.js 15, React, Tailwind (`web/`) |
| API | Node.js 18+, Express (`backend/`) |
| Automation | Playwright (Chromium, Firefox, WebKit) |
| Storage | JSON / HTML / PDF under module folders (or `STORAGE_ROOT` in production) |

---

## Quick start

**Prerequisites:** Node.js 18+

```bash
npm install
npm run playwright    # Chromium, Firefox, WebKit for local runs
npm run dev
```

| Service | Dev URL (default) |
|---------|-------------------|
| **Dashboard** | http://localhost:3011 (`npm run dev` uses `-p 3011`) |
| **API** | http://localhost:3000 |

Next.js rewrites `/api/*` → Express. Use the **UI port** in the browser, not the API alone.

```bash
npm run dev:restart              # free ports / restart stack
npm run build:web && npm start   # production (API + standalone Next)
```

Copy env template and set keys as needed:

```bash
cp .env.example .env
# Optional: PAGESPEED_API_KEY for Google PageSpeed in Seo/Geo or Security Audit
```

---

## Project structure

```
project-root/
├── web/                      # Next.js dashboard (primary UI)
│   └── src/app/              # App Router pages
├── backend/
│   ├── server.js             # Express API
│   ├── shared/               # jobStore, moduleRegistry, services, report helpers
│   ├── routes/               # API routers
│   ├── keyword-check/
│   ├── error-check/
│   ├── SEO/                  # Seo/Geo engine (uiseocheck, runJob, reports)
│   ├── ui-check/
│   ├── full-ui-check/
│   ├── sitemap-check/
│   ├── image-audit/
│   └── security-audit/
├── scripts/                  # production start, report purge, healthcheck
├── .github/workflows/        # CI
├── package.json
├── Dockerfile
├── render.yaml
├── README.md
└── PROJECT_GUIDE.md
```

---

## Adding a new module

1. Register in `backend/shared/moduleRegistry.js`
2. Add engine + `reportReader.js` under `backend/<module-id>/`
3. Add UI page under `web/src/app/<route>/` and label in `web/src/lib/modules.ts`
4. Wire job runner / routes if the module is job-based

---

## Environment variables (common)

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `development` = local parallel + bulk caps; `production` = live defaults |
| `QA_PARALLEL_MODULES` | `1` / `0` force parallel on/off (backend) |
| `NEXT_PUBLIC_QA_PARALLEL_MODULES` | `1` / `0` force parallel UI |
| `QA_ERROR_CHECK_BULK` | `1` / `0` force Link Radar bulk limits |
| `PORT` / `API_PORT` | Production UI / internal API ports |
| `STORAGE_ROOT` | Persistent data root (Docker / Render) |
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | `true` in Docker (browsers in image) |
| `JOB_RECOVER_ON_STARTUP` | Job recovery on process start |
| `PAGESPEED_API_KEY` | Google PageSpeed Insights (optional) |
| `W3C_VALIDATOR_*` | Security Audit W3C checks |
| `SSL_LABS_*` | Security Audit SSL Labs (optional) |

See `.env.example` for the full list.

---

## Maintenance

```bash
npm run reports:purge-test        # cancelled + example.com-style artifacts
npm run reports:purge-cancelled   # all cancelled jobs
npm run reports:clear             # all report artifacts (destructive)
```

---

## Deployment (Render / Docker)

- **Dockerfile** uses Playwright base image; UI built from `web/`
- Set `STORAGE_ROOT=/app/data` and attach a persistent disk
- Health: `GET /api/health`

```bash
npm run docker:build
npm run docker:up
```

---

## CI

GitHub Actions on push/PR to `main` (see `.github/workflows/ci.yml`):

- `npm ci` (root + web)
- Web lint
- `npm run build:web`

---

## License

MIT — Md Imran
