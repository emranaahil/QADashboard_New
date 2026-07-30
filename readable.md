# Readable notes & wishlist

Product ideas and deferred work for the QA Dashboard. Not a full setup guide — see [README.md](./README.md) and [PROJECT_GUIDE.md](./PROJECT_GUIDE.md) for architecture and setup.

---

## Wishlist

### BrowserStack real-device UI Check (new module)

**Status:** Planned later (not started)

**Why:** Local **UI Testing** (`ui-check` / `full-ui-check`) runs Playwright on **emulated viewports** (Desktop / Tablet / “iPhone” width×height). That is good for daily speed, but it is **not** a real phone. BrowserStack real devices would run the **same layout/issue checks** on real mobile browsers in your BrowserStack account.

**Goal:** Same issue detection as local UI Check, different execution environment.

| Layer | Approach |
|--------|----------|
| Issue detection (`uiChecks`-style) | Reuse or copy the same checks (overflow, broken images, horizontal scroll, overlaps, touch targets, blank page, contrast, CLS, JS/console, screenshots, etc.) |
| Browser launch / job runner | **New path** — connect to BrowserStack Automate with credentials and device capabilities (not local `chromium.launch`) |
| Reports | **Keep the same** shape (`qaReport.json`, `qa-report.html`, screenshots, same issue names) so users read one kind of report |
| Local UI Check | **Keep as-is** for everyday fast runs |

**Credentials (server only):**

- `BROWSERSTACK_USERNAME`
- `BROWSERSTACK_ACCESS_KEY`

**Suggested product shape:**

1. **New module** (e.g. “BrowserStack UI Check” / “Real Device UI Check”) — do not silently overload local UI Check.
2. **Device list API** — auth to BrowserStack, return only real mobiles (`real_mobile === true`) as `{ displayName, os, os_version, device }` (plus caps for the runner).
3. **Frontend** — device dropdown on mount (loading / error), save selected device capabilities for the job.
4. **Runner** — open remote browser session → `goto` URL(s) → run shared/copied UI checks → write same report files → always close session.
5. **Limits (v1)** — 1 URL and 1–2 real devices (or a small smoke pack: e.g. latest iPhone + mid Android); hard cap on devices per job for cost and time.
6. **Ops** — longer timeouts than local, low concurrency (often 1 session), clear errors if keys/quota missing, optional BrowserStack session link in the report.

**Workflow:**

1. Daily / dev → **Local UI Check** (emulated).
2. Release / client proof → **BrowserStack UI Check** (real devices).
3. Fix verification → local first, then re-run BrowserStack on the failing device.

**Out of scope for v1:** full-site crawl on many devices, native App Automate, replacing local UI Check.

**Pragmatic build note:** Copy the existing UI Check module structure and adapt only launch + device config for BrowserStack; keep detection and reports aligned. Longer term, share one detection engine and two runners (local vs BrowserStack).

**Related context:** Current UI Check uses `loadRuntimeDevices` / `{ label, width, height }` only — no BrowserStack wiring today. A dropdown alone does not hit real devices until the job runner connects to Automate.

---

## Wishlist template (for future items)

```markdown
### Title
**Status:** Planned | In progress | Done
**Why:** …
**Goal:** …
**Notes:** …
```
