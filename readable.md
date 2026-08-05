# Readable notes & wishlist

Product ideas and deferred work for the QA Dashboard. Not a full setup guide — see [README.md](./README.md) and [PROJECT_GUIDE.md](./PROJECT_GUIDE.md) for architecture and setup.

---

## Wishlist

### BrowserStack real-device UI Check (new module)

**Status:** Planned later (not started)  
**Priority:** Separate scripts only — do **not** mix into local `ui-check` / `full-ui-check` runners.

**Why:** Local **UI Testing** (`ui-check` / `full-ui-check`) runs Playwright on **emulated viewports** (Desktop / Tablet / “iPhone” width×height). That is good for daily speed, but it is **not** a real phone. BrowserStack real devices would run the **same layout/issue checks** on real mobile browsers in your BrowserStack account.

**Goal:** Same issue detection as local UI Check, different execution environment — with **different scripts** so nothing gets messy.

#### Why separate scripts (required)

Local UI Check today is a self-contained stack (`browser.js` local launch, `runJob.js`, `uiChecks.js`, `generateReport.js`, `/ui-testing` page).

If BrowserStack is forced into the same `runJob.js` / `browser.js` with `if (browserstack)` branches:

- Every local fix risks breaking remote
- Every remote timeout/credential edge case pollutes local

**Rule:** New module + new runner only. Leave local UI Check untouched for v1.

#### Separation matrix

| Layer | Local | BrowserStack | Shared in v1? |
|--------|--------|--------------|----------------|
| Job runner | `backend/ui-check/runJob.js` | **New** `backend/browserstack-ui-check/runJob.js` | No |
| Browser launch | `backend/ui-check/browser.js` | **New** `browserstackBrowser.js` (connect only) | No |
| Device list | viewport width/height | **New** devices API (`real_mobile === true`) | No |
| Module id / jobs dir | `ui-check` / `full-ui-check` | **New** e.g. `browserstack-ui-check` | No |
| Frontend | `/ui-testing` | **New** e.g. `/browserstack-ui` or “Real Device UI Check” | Prefer separate page |
| Issue detection | `uiChecks.js` | **Copy** into new folder (or thin import later) | Optional later only |
| Report shape | existing HTML/JSON | Same field names / UX; store under new job dir | Shape only |

**v1 preference:** Copy detection + report into the new folder. Do **not** refactor local `uiChecks.js` in the first delivery. After BrowserStack is stable, optionally extract a shared detection engine.

#### Planned folder layout (not built yet)

```
backend/browserstack-ui-check/
  runJob.js                 # only entry jobStore knows for this module
  browserstackBrowser.js    # Playwright connect to BrowserStack Automate
  config.js                 # timeouts, max devices, session name prefix
  devicesApi.js             # list real devices (server-side credentials)
  runSingleUrl.js           # BS navigation + check orchestration
  uiChecks.js               # copy of checks (v1) — evolve independently
  generateReport.js         # same report UX + BS device/session fields
  reportReader.js
  jobs/                     # storage under this module only

web/src/app/browserstack-ui/   # or “Real Device” under app shell
  page.tsx
```

#### Credentials (server only — never expose to browser)

- `BROWSERSTACK_USERNAME`
- `BROWSERSTACK_ACCESS_KEY`

#### Product / UX (v1)

1. **New module + separate page/nav** — e.g. “BrowserStack UI Check” / “Real Device UI Check”. Do **not** overload Single/Full website toggles with BrowserStack options.
2. **Device list API** — auth on server, return only real mobiles (`real_mobile === true`) as `{ displayName, os, os_version, device }` (+ caps for the runner).
3. **Frontend** — device dropdown on mount (loading / error), save selected device capabilities for the job.
4. **Inputs** — 1 URL (v1); 1–2 real devices max; optional project/build name for BrowserStack dashboard.
5. **Runner** — open remote session → `goto` URL → run copied UI checks → write same report files under **this** module’s job dir → always close session in `finally`.
6. **Report extras (BrowserStack-only)** — device display name, OS, OS version, BrowserStack session public URL (if available); same issue names as local for easy compare.
7. **Ops** — longer timeouts than local; concurrency often 1 session; hard caps on devices/URLs for cost; fail fast if keys/quota missing; cancel closes remote session.

#### Workflow

1. Daily / dev → **Local UI Check** (emulated).
2. Release / client proof → **BrowserStack UI Check** (real devices).
3. Fix verification → local first, then re-run BrowserStack on the failing device only.

#### Out of scope for v1

- Full-site crawl on many real devices
- Native App Automate
- Replacing or changing local UI Check
- Mixing BrowserStack into `backend/ui-check/runJob.js` or `browser.js`
- Parallel multi-device storm (cost/timeout risk)

#### Implementation phases (when building)

| Phase | Deliverable |
|--------|-------------|
| **P1** | Module skeleton + `runJob` + BrowserStack connect + credentials + 1 device + 1 URL smoke |
| **P2** | Device list API + UI page + job create/history |
| **P3** | Port/copy UI checks + screenshots + HTML report with device/session metadata |
| **P4** | Limits, cancel, errors, optional 2nd device, env docs |

#### Related context

Current UI Check uses `loadRuntimeDevices` / `{ label, width, height }` only — no BrowserStack wiring today. A dropdown alone does not hit real devices until the job runner connects to Automate.

**Bottom line:** Separate module, separate scripts, local UI Check stays as-is. Same report *shape*, different job storage and runner so nothing gets messy.

---

## Wishlist template (for future items)

```markdown
### Title
**Status:** Planned | In progress | Done
**Why:** …
**Goal:** …
**Notes:** …
```
