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
    }

    // Initialize queue with a starting URL
    initialize(startUrl) {
        this.queue = [startUrl];
        this.visited = new Set();
        this.discovered = new Set();
        this.discovered.add(startUrl);
        this.isProcessing = false;
    }

    // Add URL to queue if not already visited or queued
    addUrl(url) {
        if (this.visited.has(url)) return false;
        if (this.discovered.has(url)) return false;
        
        this.discovered.add(url);
        this.queue.push(url);
        return true;
    }

    // Add multiple URLs at once
    addUrls(urls) {
        let count = 0;
        for (const url of urls) {
            if (this.addUrl(url)) {
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
            const url = this.queue.shift();
            if (url) {
                batch.push(url);
            }
        }
        
        return batch;
    }

    // Mark URLs as visited
    markVisited(urls) {
        for (const url of urls) {
            this.visited.add(url);
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
            concurrency: this.concurrency
        };
    }

    // Deserialize state from checkpoint
    deserialize(state) {
        this.queue = state.queue || [];
        this.visited = new Set(state.visited || []);
        this.discovered = new Set(state.discovered || []);
        this.batchSize = state.batchSize || 50;
        this.concurrency = state.concurrency || 5;
    }

    // Reset the queue
    reset() {
        this.queue = [];
        this.visited = new Set();
        this.discovered = new Set();
        this.isProcessing = false;
    }
}

// Export singleton instance
const queueService = new QueueService();

module.exports = queueService;