const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const { createRateLimiter, buildCorsOptions } = require('./shared/securityMiddleware');
const scanRoutes = require('./routes/scanRoutes');
const modulesRouter = require('./routes/modulesRouter');
const jobsRouter = require('./routes/jobsRouter');
const testStatusRouter = require('./routes/testStatusRouter');
const configRouter = require('./routes/configRouter');
const dashboardRouter = require('./routes/dashboardRouter');
const historyRouter = require('./routes/historyRouter');
const reportCenterRouter = require('./routes/reportCenterRouter');
const executionRouter = require('./routes/executionRouter');
const uiTestingRouter = require('./routes/uiTestingRouter');
const seoTestingRouter = require('./routes/seoTestingRouter');
const jobQueue = require('./shared/jobQueue');
const errorCheckService = require('./error-check/errorCheckService');
const stateService = require('./keyword-check/stateService');
const { ensureStorageDirs } = require('./shared/storagePaths');
const { seedBundledStorageSync } = require('./shared/seedBundledStorage');
const { refreshBundledManifestSync } = require('./shared/bundledReportsManifest');
const ephemeralLiveReports = require('./shared/ephemeralLiveReports');
const { reconcileStaleJobs } = require('./shared/staleJobService');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const rawWebAppUrl = process.env.WEB_APP_URL;
const WEB_APP_URL = rawWebAppUrl ? rawWebAppUrl.replace(/\/$/, '') : 'http://localhost:3001';
let server = null;
const SERVER_STARTED_AT = new Date().toISOString();

seedBundledStorageSync();
if (process.env.STORAGE_ROOT) {
    refreshBundledManifestSync();
}
ensureStorageDirs();

app.set('trust proxy', 1);

// Middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(cors(buildCorsOptions({ apiOnly: IS_PRODUCTION, webAppUrl: WEB_APP_URL })));
app.use(compression({
  filter: (req, res) => {
    if (req.path?.endsWith('/events')) return false;
    if (res.getHeader('Content-Type') === 'text/event-stream') return false;
    return compression.filter(req, res);
  }
}));
app.use(morgan('combined'));
const RATE_LIMIT_MAX = Number(process.env.API_RATE_LIMIT_MAX || (IS_PRODUCTION ? 120 : 600));
app.use('/api', createRateLimiter({
  windowMs: 60_000,
  max: RATE_LIMIT_MAX,
  skip: (req) => req.path === '/health' || req.path.endsWith('/events')
}));
app.use(express.json({
    limit: '10mb',
    verify: (req, _res, buf) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// API Routes
app.use('/api', scanRoutes);
app.use('/api/test-status', testStatusRouter);
app.use('/api/config', configRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/history', historyRouter);
app.use('/api/reports-center', reportCenterRouter);
app.use('/api/execution', executionRouter);
app.use('/api/ui-testing', uiTestingRouter);
app.use('/api/seo-testing', seoTestingRouter);
app.use('/api/modules', jobsRouter);
app.use('/api/modules', modulesRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        startedAt: SERVER_STARTED_AT,
        uptime: process.uptime(),
        ui: IS_PRODUCTION ? 'next' : WEB_APP_URL,
        api: `http://localhost:${PORT}/api`,
        mode: IS_PRODUCTION ? 'production' : 'development'
    });
});

// API 404
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: `API route not found: ${req.method} ${req.path}` });
});

// Development only — redirect browser traffic on the API port to the Next.js app (port 3001)
if (!IS_PRODUCTION) {
    const UI_PATH_MAP = {
        '/': '/dashboard',
        '/linkradar': '/link-radar'
    };

    function redirectToWebApp(req, res) {
        const mapped = UI_PATH_MAP[req.path] || req.path;
        const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        res.redirect(302, `${WEB_APP_URL}${mapped}${query}`);
    }

    app.get('/', redirectToWebApp);
    app.get(['/dashboard', '/ui-testing', '/seo-testing', '/keyword-radar', '/linkradar', '/link-radar', '/history', '/reports'], redirectToWebApp);
    app.get(/^\/modules\/.*/, redirectToWebApp);
    app.get('*', (req, res) => {
        if (req.path.startsWith('/api')) {
            return res.status(404).json({ error: 'NOT_FOUND', message: 'API route not found' });
        }
        redirectToWebApp(req, res);
    });
}

// Error handling middleware
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({
            error: 'INVALID_JSON',
            message: 'Malformed JSON in request body'
        });
    }

    console.error(`[${req.method} ${req.path}]`, err);
    const status = err.status || err.statusCode || 500;
    res.status(status).json({
        error: err.code || 'INTERNAL_ERROR',
        message: err.message || 'Internal Server Error'
    });
});

async function runStartupCleanup() {
    if (typeof errorCheckService.resetProgress === 'function') {
        errorCheckService.resetProgress();
    }

    const scanMigration = await stateService.migrateLegacyScanFilenames();
    if (scanMigration.renamed > 0) {
        console.log(`Keyword scan filename migration: renamed ${scanMigration.renamed} legacy file(s)`);
    }

    const staleScans = await stateService.cleanupStaleScansOnStartup();
    const jobResult = await jobQueue.cleanupOnStartup();

    let seoMigration = null;
    try {
        const { migrateSeoReportLayoutOnce } = require('./SEO/seoReportStorage');
        seoMigration = await migrateSeoReportLayoutOnce();
        if (seoMigration && !seoMigration.skipped) {
            console.log(
                'SEO report layout migration: cleared legacy reports — ' +
                `${seoMigration.removed.flatFiles} flat file(s), ` +
                `${seoMigration.removed.jobArtifacts} job artifact(s), ` +
                `${seoMigration.removed.jobsUpdated} job record(s) updated`
            );
        }
    } catch (err) {
        console.error('SEO report layout migration failed:', err.message);
    }

    if (staleScans > 0 || jobResult.cancelled > 0 || jobResult.recovered > 0) {
        console.log(
            `Startup cleanup: ${staleScans} keyword scan(s) stopped, ` +
            `${jobResult.cancelled} job(s) cancelled, ${jobResult.recovered} job(s) re-queued`
        );
    }

    if (ephemeralLiveReports.isEnabled()) {
        const ephemeral = await ephemeralLiveReports.cleanupExpiredReports();
        ephemeralLiveReports.startCleanupSchedule();
        console.log(
            `Ephemeral live reports enabled — TTL ${Math.round(ephemeralLiveReports.getTtlMs() / 60000)} min ` +
            `(startup removed ${ephemeral.removedJobs} job(s), ${ephemeral.removedArtifacts} artifact group(s))`
        );
    }

    const stale = await reconcileStaleJobs();
    if (stale.marked > 0) {
        console.log(`Stale job cleanup: marked ${stale.marked} interrupted job(s)`);
    }
    startStaleJobSchedule();
}

let staleJobTimer = null;

function startStaleJobSchedule() {
    if (staleJobTimer) return;
    const tick = () => {
        reconcileStaleJobs().catch((err) => {
            console.error('Stale job sweep failed:', err.message);
        });
    };
    tick();
    staleJobTimer = setInterval(tick, 60_000);
    if (typeof staleJobTimer.unref === 'function') staleJobTimer.unref();
}

function shutdown(signal) {
    console.log(`${signal} received. Shutting down gracefully...`);
    if (!server) {
        process.exit(0);
        return;
    }
    server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
    });
    setTimeout(() => {
        console.warn('Forced shutdown after timeout.');
        process.exit(1);
    }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
});

server = app.listen(PORT, '0.0.0.0', async () => {
    try {
        await runStartupCleanup();
    } catch (err) {
        console.error('Startup cleanup failed:', err.message);
    }
    console.log(`API server running on port ${PORT} (started ${SERVER_STARTED_AT})`);
    if (!IS_PRODUCTION) {
        console.log(`UI dashboard: ${WEB_APP_URL}`);
        console.log('Dev tip: use http://localhost:3001 — production port will not show latest UI changes.');
        console.log('Restart anytime: npm run dev:restart');
    }
    console.log(`API base: http://localhost:${PORT}/api`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Stop the other process or set PORT to a different value.`);
    } else {
        console.error('Server failed to start:', err);
    }
    process.exit(1);
});

module.exports = app;