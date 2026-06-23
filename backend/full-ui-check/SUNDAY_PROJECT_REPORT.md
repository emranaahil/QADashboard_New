# Sunday Project — Terminal Script Package Report

**Scope:** Terminal-only QA crawler (`node runFullSiteUI.js <url>`). No frontend, backend, server, API, UI, deployment, or infrastructure code.

**Verified:** `node runFullSiteUI.js https://www.saucedemo.com/` — exit code 0 (2026-06-21).

---

## Entry Points

| Entry | Command | Purpose |
|-------|---------|---------|
| `runFullSiteUI.js` | `node runFullSiteUI.js <seedUrl>` | Default **queue mode**: crawl → test → report |
| `runFullSiteUI.js` | `node runFullSiteUI.js <seedUrl> local` | Direct URL test (no crawl) |
| `runFullSiteUI.js` | `node runFullSiteUI.js --resume <runId>` | Resume interrupted queue run |

---

## Dependency Tree

```
runFullSiteUI.js
├── discoverURL.js
│   ├── crawlConfig.js
│   ├── urlNormalizer.js
│   ├── urlFilter.js
│   └── uichecksfull/browser.js → uichecksfull/config.js
├── queueManager.js
│   ├── uichecksfull/browser.js
│   ├── uichecksfull/config.js
│   ├── uichecksfull/uiChecksfull.js
│   ├── uichecksfull/generateReportfull.js → uichecksfull/utils/reportUtils.js
│   ├── uichecksfull/generatePdffull.js → uichecksfull/browser.js
│   ├── tracker.js
│   └── urlNormalizer.js
├── resumeManager.js
├── tracker.js
├── uichecksfull/browser.js
├── uichecksfull/config.js
├── uichecksfull/uiChecksfull.js
├── uichecksfull/generateReportfull.js
├── uichecksfull/generatePdffull.js
└── uichecksfull/utils/reportUtils.js

Dynamic (conditional):
├── crawlConfig.js          — re-required in queue mode block
├── discoverURL.js          — re-required in queue mode block
├── queueManager.js         — re-required in --resume mode
└── uichecksfull/cleanupReports.js — only if QA_CLEANUP_REPORTS=1
```

---

## Runtime npm Dependency

| Package | Used by |
|---------|---------|
| `playwright` | `uichecksfull/browser.js`, `uichecksfull/generatePdffull.js`, `discoverURL.js` (via browser), `queueManager.js` (via browser) |

All other imports are Node.js built-ins (`fs`, `path`, `readline`).

---

## Files Copied

### Root scripts (8)
- `runFullSiteUI.js` — CLI entry
- `discoverURL.js` — URL crawler/discovery (BFS)
- `crawlConfig.js` — crawl settings
- `urlNormalizer.js` — URL canonicalization
- `urlFilter.js` — href/asset filtering
- `queueManager.js` — sequential queue processor
- `resumeManager.js` — resume state reader
- `tracker.js` — job progress tracker

### uichecksfull/ (7)
- `uichecksfull/browser.js` — Playwright browser launcher
- `uichecksfull/config.js` — timeouts, devices, reports root
- `uichecksfull/uiChecksfull.js` — per-page QA checks
- `uichecksfull/generateReportfull.js` — HTML report generator (inline template)
- `uichecksfull/generatePdffull.js` — PDF export
- `uichecksfull/cleanupReports.js` — optional report cleanup
- `uichecksfull/utils/reportUtils.js` — JSON I/O helpers

### Configuration (2)
- `package.json` — minimal; only `playwright` dependency
- `reports/job-tracker.json` — empty tracker seed (runtime writes here)

### Folders created at runtime (not copied)
- `reports/<runId>/` — crawl queue, screenshots, qaReport.json
- `qa-report.html` — generated HTML report (package root)

---

## Folders Copied

| Folder | Contents |
|--------|----------|
| `Sunday Project/` | Root scripts + package.json |
| `Sunday Project/uichecksfull/` | QA engine modules |
| `Sunday Project/uichecksfull/utils/` | reportUtils.js |
| `Sunday Project/reports/` | job-tracker.json seed only |

---

## Files Excluded

### Application layers (not used by terminal script)

| Path | Reason |
|------|--------|
| `frontend/` | React/Vite UI — not imported by CLI |
| `backend/` | Express API server + Backstop legacy — spawned separately, not required by `runFullSiteUI.js` |
| `backend/server.js` | Web server entry — excluded |

### Infrastructure / queue workers

| Path | Reason |
|------|--------|
| `worker.js` | BullMQ worker — Redis infrastructure |
| `queue.js` | BullMQ queue |
| `redis.js` | Redis client |
| `jobManager.js` | BullMQ job orchestration |
| `crawler.js` | Alternate discovery for BullMQ path only |
| `localRunner.js` | Worker subprocess runner |
| `recovery.js` | Stuck-job recovery for BullMQ |

### Unused within CLI chain

| Path | Reason |
|------|--------|
| `src/modules/dataLoader.js` | Zero `require()` references in crawler chain |
| `uichecksfull/utils/screenshotUtils.js` | Zero imports anywhere in project |
| `mcps/` (Sunday Project) | MCP tool descriptors — not loaded at runtime |
| `mcps/` (root) | MCP server configs — not used by script |

### Dev / test tooling

| Path | Reason |
|------|--------|
| `tests/` | Playwright test specs — separate from crawler CLI |
| `playwright.config.js` | `@playwright/test` config — crawler uses `playwright` package directly |
| `TODO.md` | Documentation only |

### Generated artifacts (recreated at runtime)

| Path | Reason |
|------|--------|
| `qa-report.html` (original root) | Output artifact |
| `report.pdf` (original root) | Output artifact |
| `reports/<runId>/` (original) | Past run data |
| `terminals/` | IDE session logs |
| `docs/` | Documentation |
| `node_modules/` (original) | Reinstalled via `npm install` in Sunday Project |

### Uncertain — kept out (verified not needed for saucedemo run)

| Path | Notes |
|------|-------|
| `uichecksfull/utils/screenshotUtils.js` | No import chain; excluded after grep verification |

---

## Dynamic Dependencies Discovered

| Trigger | Module loaded |
|---------|---------------|
| Default queue mode | `crawlConfig.js`, `discoverURL.js` (inline re-require in `runFullSiteUI.js`) |
| `--resume <runId>` | `queueManager.js` (inline re-require) |
| `QA_CLEANUP_REPORTS=1` | `uichecksfull/cleanupReports.js` |
| First run | `reports/job-tracker.json` auto-created if missing |
| Each run | `reports/<runId>/urlQueue.jsonl`, `seenUrls.txt`, `qaReport.json`, screenshots |

---

## Verification Results

| Check | Result |
|-------|--------|
| Startup | ✅ `runTest(queue)` started |
| Crawl/discovery | ✅ 1 URL found for saucedemo.com |
| Queue processing | ✅ 1/1 URL tested |
| Missing imports | ✅ None |
| Missing modules | ✅ `playwright` installed |
| Missing assets | ✅ HTML template is inline in generateReportfull.js |
| Path resolution | ✅ reports/, qa-report.html written correctly |
| Exit code | ✅ 0 |

---

## Usage

```bash
cd "Sunday Project"
npm install
node runFullSiteUI.js https://example.com/
node runFullSiteUI.js https://example.com/ local
node runFullSiteUI.js --resume <runId>
```

Optional env vars:
- `QA_CLEANUP_REPORTS=1` — enable report cleanup after run
- `QA_DEBUG=1` — verbose QA logging
- `QA_BROWSER_RESTART_EVERY=N` — browser restart interval (default 50)

---

## Package Size

~17 source files + `package.json` + `node_modules/playwright` (installed separately).

Original project excluded: frontend (~44 files), backend (~4000+ files), infrastructure scripts, and ~3.9 GB of Backstop bitmap artifacts.