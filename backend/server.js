const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
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

const app = express();
const PORT = process.env.PORT || 3000;
const WEB_APP_URL = (process.env.WEB_APP_URL || 'http://localhost:3001').replace(/\/$/, '');
let server = null;

ensureStorageDirs();

// Middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({
    limit: '50mb',
    verify: (req, _res, buf) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
        uptime: process.uptime(),
        ui: WEB_APP_URL
    });
});

// API 404
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: `API route not found: ${req.method} ${req.path}` });
});

/** Map legacy Express UI paths to Next.js routes */
const UI_PATH_MAP = {
    '/': '/dashboard',
    '/linkradar': '/link-radar'
};

function redirectToWebApp(req, res) {
    const mapped = UI_PATH_MAP[req.path] || req.path;
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(302, `${WEB_APP_URL}${mapped}${query}`);
}

// API-only on this port — all browser UI lives on the Next.js app (WEB_APP_URL)
app.get('/', redirectToWebApp);
app.get(['/dashboard', '/ui-testing', '/seo-testing', '/keyword-radar', '/linkradar', '/link-radar', '/history', '/reports'], redirectToWebApp);
app.get(/^\/modules\/.*/, redirectToWebApp);
app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'API route not found' });
    }
    redirectToWebApp(req, res);
});

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

    const staleScans = await stateService.cleanupStaleScansOnStartup();
    const jobResult = await jobQueue.cleanupOnStartup();

    if (staleScans > 0 || jobResult.cancelled > 0 || jobResult.recovered > 0) {
        console.log(
            `Startup cleanup: ${staleScans} keyword scan(s) stopped, ` +
            `${jobResult.cancelled} job(s) cancelled, ${jobResult.recovered} job(s) re-queued`
        );
    }
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
    console.log(`API server running on port ${PORT}`);
    console.log(`UI dashboard: ${WEB_APP_URL}`);
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