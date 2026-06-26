# QA Dashboard — Web UI

Next.js 15 dashboard for the QA toolkit. This is the **only** user-facing UI — the legacy static `frontend/` folder has been removed.

## Development

Run from the **repository root** (not this folder alone):

```bash
npm install
npm run playwright          # Chromium + Firefox + WebKit for local UI tests
npm run dev
```

- **UI:** http://localhost:3001
- **API:** http://localhost:3000 (proxied from the UI via `next.config.ts`)

## Production build

```bash
npm run build:web   # from repo root
```

Output: `web/.next/standalone` (used by `scripts/start-production.js` and Docker).

## Pages

| Route | Module |
|-------|--------|
| `/dashboard` | Overview stats |
| `/ui-testing` | Single-page + full-site UI checks |
| `/seo-testing` | SEO audits |
| `/keyword-radar` | Keyword crawl |
| `/link-radar` | Broken links / pages |
| `/history` | Run history |
| `/reports` | Report center |

Legacy URLs (`/modules/ui-check`, etc.) redirect to the routes above — see `next.config.ts`.

## Key paths

```
web/src/
├── app/              # Next.js App Router pages
├── components/       # UI components (device-selector, ui-testing-workspace, …)
├── lib/              # api.ts, session, validation helpers
└── store/            # Zustand stores (scan, execution, dashboard)
```