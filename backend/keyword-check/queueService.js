/**
 * Queue Service
 * Manages the URL queue for crawling with batch processing support
 */

class QueueService {
    constructor() {
        this.queue = [];
        this.visited = new Set();
        this.discovered = new Set();
        this.isProcessing = false;
        this.batchSize = 50;
        this.concurrency = 5;
        this.normalizeUrl = null;
        this.maxDepth = null;
    }

    // Initialize queue with a starting URL and optional seed URLs
    initialize(startUrl, options = {}) {
        const { seedUrls = [], normalizeUrl = null, maxDepth = null } = options;
        this.normalizeUrl = typeof normalizeUrl === 'function' ? normalizeUrl : null;
        this.maxDepth = Number.isFinite(maxDepth) ? maxDepth : null;

        const normalizedStart = this._normalize(startUrl);
        this.queue = normalizedStart ? [{ url: normalizedStart, depth: 0 }] : [];
        this.visited = new Set();
        this.discovered = new Set();

        if (normalizedStart) {
            this.discovered.add(normalizedStart);
        }

        for (const seedUrl of seedUrls) {
            this.addUrl(seedUrl, 1);
        }

        this.isProcessing = false;
    }

    _normalize(url) {
        if (!url) return null;
        if (this.normalizeUrl) {
            return this.normalizeUrl(url);
        }
        return url;
    }

    // Add URL to queue if not already visited or queued
    addUrl(url, depth = 0) {
        const normalized = this._normalize(url);
        if (!normalized) return false;
        if (this.maxDepth != null && depth > this.maxDepth) return false;
        if (this.visited.has(normalized)) return false;
        if (this.discovered.has(normalized)) return false;

        this.discovered.add(normalized);
        this.queue.push({ url: normalized, depth });
        return true;
    }

    // Add multiple URLs at once
    addUrls(urls, depth = 0) {
        let count = 0;
        for (const url of urls) {
            if (this.addUrl(url, depth)) {
                count++;
            }
        }
        return count;
    }

    // Get next batch of URLs to process
    getNextBatch() {
        const batch = [];
        const batchSize = Math.min(this.batchSize, this.queue.length);

        for (let i = 0; i < batchSize; i++) {
            const item = this.queue.shift();
            if (item && item.url) {
                batch.push(item);
            }
        }

        return batch;
    }

    // Mark URLs as visited
    markVisited(urls) {
        for (const entry of urls) {
            const url = typeof entry === 'string' ? entry : entry?.url;
            if (!url) continue;
            const normalized = this._normalize(url) || url;
            this.visited.add(normalized);
        }
    }

    // Get queue size
    getQueueSize() {
        return this.queue.length;
    }

    // Get visited count
    getVisitedCount() {
        return this.visited.size;
    }

    // Get discovered count (visited + queued)
    getDiscoveredCount() {
        return this.discovered.size;
    }

    // Check if queue is empty
    isEmpty() {
        return this.queue.length === 0;
    }

    // Get total discovered URLs
    getTotalDiscovered() {
        return this.discovered.size;
    }

    // Serialize state for checkpoint
    serialize() {
        return {
            queue: this.queue,
            visited: Array.from(this.visited),
            discovered: Array.from(this.discovered),
            batchSize: this.batchSize,
            concurrency: this.concurrency,
            maxDepth: this.maxDepth
        };
    }

    // Deserialize state from checkpoint
    deserialize(state) {
        this.queue = (state.queue || []).map((item) => {
            if (typeof item === 'string') {
                return { url: item, depth: 0 };
            }
            return {
                url: item.url,
                depth: Number.isFinite(item.depth) ? item.depth : 0
            };
        }).filter((item) => item.url);

        this.visited = new Set(state.visited || []);
        this.discovered = new Set(state.discovered || []);
        this.batchSize = state.batchSize || 50;
        this.concurrency = state.concurrency || 5;
        this.maxDepth = Number.isFinite(state.maxDepth) ? state.maxDepth : this.maxDepth;
    }

    // Reset the queue
    reset() {
        this.queue = [];
        this.visited = new Set();
        this.discovered = new Set();
        this.isProcessing = false;
        this.normalizeUrl = null;
        this.maxDepth = null;
    }
}

// Export singleton instance
const queueService = new QueueService();

module.exports = queueService;