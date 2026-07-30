# Stage 1 — build Next.js UI (web/, port 3001 in dev)
FROM node:20-bookworm AS web-builder

WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
ENV API_URL=http://127.0.0.1:3000
# Baked into Next.js client/metadata at build time (override via docker build --build-arg)
ARG NEXT_PUBLIC_SITE_URL=https://qadashboard.onrender.com
ARG NEXT_PUBLIC_BRAND_NAME=Md Imran
ARG NEXT_PUBLIC_GEO_REGION=IN
ARG NEXT_PUBLIC_GEO_PLACENAME=India
ARG NEXT_PUBLIC_GEO_LAT=22.5726
ARG NEXT_PUBLIC_GEO_LON=88.3639
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_BRAND_NAME=$NEXT_PUBLIC_BRAND_NAME \
    NEXT_PUBLIC_GEO_REGION=$NEXT_PUBLIC_GEO_REGION \
    NEXT_PUBLIC_GEO_PLACENAME=$NEXT_PUBLIC_GEO_PLACENAME \
    NEXT_PUBLIC_GEO_LAT=$NEXT_PUBLIC_GEO_LAT \
    NEXT_PUBLIC_GEO_LON=$NEXT_PUBLIC_GEO_LON
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

HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=5 \
  CMD node scripts/healthcheck.js

CMD ["node", "scripts/start-production.js"]