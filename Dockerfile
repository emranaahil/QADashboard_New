# Stage 1 — build Next.js UI (web/, port 3001 in dev)
FROM node:20-bookworm AS web-builder

WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
ENV API_URL=http://127.0.0.1:3000
RUN npm run build

# Stage 2 — production image (Express API + Playwright + Next.js standalone)
FROM mcr.microsoft.com/playwright:v1.61.0-jammy

WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY backend ./backend
COPY scripts ./scripts

# Next.js standalone output (served on PORT — public UI)
COPY --from=web-builder /app/web/.next/standalone ./
COPY --from=web-builder /app/web/.next/static ./web/.next/static
COPY --from=web-builder /app/web/public ./web/public

ENV NODE_ENV=production
ENV PORT=10000
ENV API_PORT=3000
ENV API_URL=http://127.0.0.1:3000
ENV STORAGE_ROOT=/app/data
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_CHROMIUM_SANDBOX=false

RUN mkdir -p /app/data

# Verify Playwright browsers shipped with the base image (Chromium, Firefox, WebKit).
RUN node -e "const pw=require('playwright'); Promise.all([pw.chromium.launch().then(b=>b.close()),pw.firefox.launch().then(b=>b.close()),pw.webkit.launch().then(b=>b.close())]).then(()=>console.log('Playwright browsers OK')).catch(e=>{console.error(e);process.exit(1)})"

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD node scripts/healthcheck.js

CMD ["node", "scripts/start-production.js"]