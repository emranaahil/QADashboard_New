# Production image for QA Dashboard (Express API + static frontend + Playwright)
# Uses Microsoft's Playwright image — Chromium and system deps pre-installed.
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app

# Production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Application source (API + Express-served frontend)
COPY backend ./backend
COPY frontend ./frontend
COPY scripts ./scripts

ENV NODE_ENV=production
ENV PORT=10000
ENV STORAGE_ROOT=/app/data
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_CHROMIUM_SANDBOX=false

RUN mkdir -p /app/data

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD node scripts/healthcheck.js

CMD ["node", "backend/server.js"]