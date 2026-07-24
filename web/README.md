# QA Dashboard — Web UI

Next.js 15 dashboard for the QA toolkit. This is the **only** user-facing UI.

Full product overview: **[../README.md](../README.md)** · Architecture: **[../PROJECT_GUIDE.md](../PROJECT_GUIDE.md)**

## Development

Run from the **repository root** (not this folder alone):

```bash
npm install
npm run playwright          # browsers for local UI / SEO Playwright jobs
npm run dev
```

| Service | URL |
|---------|-----|
| **UI** | http://localhost:**3011** (`npm run dev` uses `-p 3011`) |
| **API** | http://localhost:**3000** (proxied via `next.config.ts`) |

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
| `/seo-testing` | **Seo/Geo Audit** (SEO, GEO, headers; optional PageSpeed & Rich Results) |
| `/keyword-radar` | Keyword crawl |
| `/link-radar` | Broken links / pages |
| `/sitemap-check` | Sitemap Audit |
| `/image-audit` | Image Audit |
| `/security-audit` | Security Audit |
| `/reports` | Report center |
| `/history` | Run history (if enabled in nav) |

Legacy URLs (`/modules/ui-check`, etc.) redirect — see `next.config.ts`.

## Seo/Geo workspace notes

- Toggles: **Google PageSpeed** (API key), **Google Rich Results** (Playwright best-effort + tool link).
- Rich Results screenshots may show a Google login / soft-block page under automation; manual browser often works for the same URL. Local GEO/Schema remains the automated authority.

## Key paths

```
web/src/
├── app/              # Next.js App Router pages
├── components/       # layout, modules, UI
├── lib/              # api.ts, modules, export helpers
├── hooks/            # job runner, busy state
└── store/            # Zustand (scan, execution, dashboard)
```
