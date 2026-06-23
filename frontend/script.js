/**
 * Website Keyword Auditor - Frontend JavaScript
 */

class KeywordAuditor {
    constructor() {
        // DOM Elements
        this.websiteUrlInput = document.getElementById('websiteUrl');
        this.keywordsInput = document.getElementById('keywords');
        this.startScanBtn = document.getElementById('startScanBtn');
        this.clearBtn = document.getElementById('clearBtn');
        this.retryBtn = document.getElementById('retryBtn');
        
        // Sections
        this.progressSection = document.getElementById('progressSection');
        this.resultsSection = document.getElementById('resultsSection');
        this.errorSection = document.getElementById('errorSection');
        
        // Stats
        this.urlsDiscoveredEl = document.getElementById('urlsDiscovered');
        this.urlsProcessedEl = document.getElementById('urlsProcessed');
        this.currentBatchEl = document.getElementById('currentBatch');
        this.matchesFoundEl = document.getElementById('matchesFound');
        this.progressFill = document.getElementById('progressFill');
        this.progressText = document.getElementById('progressText');
        this.statusDot = document.getElementById('statusDot');
        this.statusText = document.getElementById('statusText');
        
        // Results
        this.resultsBody = document.getElementById('resultsBody');
        this.resultsCount = document.getElementById('resultsCount');
        this.noResultsMessage = document.getElementById('noResultsMessage');
        this.errorMessage = document.getElementById('errorMessage');
        
        // State
        this.currentScanId = null;
        this.statusInterval = null;
        this.lastStats = null;
        
        // Bind events
        this.bindEvents();
    }
    
    bindEvents() {
        this.startScanBtn.addEventListener('click', () => this.startScan());
        this.clearBtn.addEventListener('click', () => this.clearAll());
        this.retryBtn.addEventListener('click', () => this.retry());
        
        // Enter key to start scan
        this.websiteUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.startScan();
        });
    }
    
    async startScan() {
        const url = this.websiteUrlInput.value.trim();
        const keywordsText = this.keywordsInput.value.trim();
        
        // Validation
        if (!url) {
            this.showError('Please enter a website URL');
            return;
        }
        
        if (!keywordsText) {
            this.showError('Please enter at least one keyword');
            return;
        }
        
        // Parse keywords
        const keywords = keywordsText
            .split('\n')
            .map(k => k.trim())
            .filter(k => k.length > 0);
        
        if (keywords.length === 0) {
            this.showError('Please enter at least one valid keyword');
            return;
        }
        
        // Disable buttons
        this.setButtonsDisabled(true);
        
        // Show progress
        this.showProgress();
        this.updateStatus('starting', 'Starting scan...');
        
        try {
            const response = await fetch('/api/scan/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url, keywords })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to start scan');
            }
            
            this.currentScanId = data.scanId;
            this.updateStatus('running', 'Scan started, crawling website...');
            
            // Start polling for status
            this.startStatusPolling();
            
        } catch (error) {
            this.showError(error.message);
            this.setButtonsDisabled(false);
        }
    }
    
    startStatusPolling() {
        // Clear any existing interval
        if (this.statusInterval) {
            clearInterval(this.statusInterval);
        }
        
        // Poll every 2 seconds
        this.statusInterval = setInterval(() => this.checkStatus(), 2000);
    }
    
    stopStatusPolling() {
        if (this.statusInterval) {
            clearInterval(this.statusInterval);
            this.statusInterval = null;
        }
    }
    
    async checkStatus() {
        if (!this.currentScanId) return;
        
        try {
            const response = await fetch(`/api/scan/${this.currentScanId}/status`);
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to get status');
            }
            
            // Update stats
            this.updateStats(data.stats);
            
            // Update live recent URLs
            if (data.recentUrls && data.recentUrls.length > 0) {
                this.updateRecentUrls(data.recentUrls);
            }
            
            // Update status
            this.updateStatus(data.status, this.getStatusMessage(data));
            
            // Check if completed
            if (data.status === 'completed') {
                this.stopStatusPolling();
                await this.loadResults();
            } else if (data.status === 'failed') {
                this.stopStatusPolling();
                this.showError(data.error || 'Scan failed');
            }
            
        } catch (error) {
            this.stopStatusPolling();
            this.showError(error.message);
        }
    }
    
    updateStats(stats) {
        if (!stats) return;
        
        const setAnimatedValue = (el, newVal) => {
            const valStr = String(newVal || 0);
            if (el.textContent !== valStr) {
                el.textContent = valStr;
                el.classList.add('updated');
                
                // Also flash the parent stat-item for extra "live" feedback
                const item = el.closest('.stat-item');
                if (item) {
                    item.classList.add('updated');
                    setTimeout(() => {
                        item.classList.remove('updated');
                    }, 350);
                }
                
                setTimeout(() => {
                    el.classList.remove('updated');
                }, 300);
            }
        };
        
        setAnimatedValue(this.urlsDiscoveredEl, stats.urlsDiscovered);
        setAnimatedValue(this.urlsProcessedEl, stats.urlsProcessed);
        setAnimatedValue(this.currentBatchEl, stats.currentBatch);
        setAnimatedValue(this.matchesFoundEl, stats.matchesFound);
        
        // Calculate progress (based on discovered vs processed)
        const discovered = stats.urlsDiscovered || 0;
        const processed = stats.urlsProcessed || 0;
        
        if (discovered > 0) {
            const progress = Math.min(100, Math.round((processed / discovered) * 100));
            this.progressFill.style.width = `${progress}%`;
            this.progressText.textContent = `${progress}%`;
        }
        
        this.lastStats = stats;
    }

    updateRecentUrls(urls) {
        const container = document.getElementById('recentUrlsList');
        if (!container || !urls || urls.length === 0) return;

        // Keep a rolling list in the instance
        if (!this._recentUrls) this._recentUrls = [];

        // Append new ones, avoid duplicates in recent window
        urls.forEach(u => {
            if (!this._recentUrls.includes(u)) {
                this._recentUrls.push(u);
            }
        });

        // Keep only last 12
        if (this._recentUrls.length > 12) {
            this._recentUrls = this._recentUrls.slice(-12);
        }

        // Render
        container.innerHTML = '';
        this._recentUrls.forEach(url => {
            const div = document.createElement('div');
            div.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
            div.textContent = '→ ' + url;
            div.title = url;
            container.appendChild(div);
        });
    }
    
    updateStatus(status, message) {
        this.statusDot.className = 'status-dot';
        
        switch (status) {
            case 'starting':
                this.statusDot.classList.add('running');
                break;
            case 'running':
                this.statusDot.classList.add('running');
                break;
            case 'completed':
                this.statusDot.classList.add('completed');
                break;
            case 'failed':
                this.statusDot.classList.add('error');
                break;
        }
        
        this.statusText.textContent = message;
    }
    
    getStatusMessage(data) {
        switch (data.status) {
            case 'starting':
                return 'Initializing...';
            case 'running':
                return `Crawling... Batch ${data.stats?.currentBatch || 0}`;
            case 'completed':
                return 'Scan completed!';
            case 'failed':
                return 'Scan failed';
            default:
                return 'Processing...';
        }
    }
    
    async loadResults() {
        if (!this.currentScanId) return;
        
        try {
            const response = await fetch(`/api/scan/${this.currentScanId}/results`);
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to load results');
            }
            
            // Show results - now uses all checked URLs (with fallback for old scans)
            let displayResults = data.results;
            if (!displayResults || displayResults.length === 0) {
                // Legacy support: build from flat matches
                const legacyMatches = data.matches || [];
                const legacyMap = new Map();
                legacyMatches.forEach(m => {
                    if (!legacyMap.has(m.url)) legacyMap.set(m.url, []);
                    if (!legacyMap.get(m.url).includes(m.keyword)) {
                        legacyMap.get(m.url).push(m.keyword);
                    }
                });
                displayResults = Array.from(legacyMap.entries()).map(([url, kws]) => ({
                    url,
                    matchedKeywords: kws,
                    statusCode: 200,
                    isError: false,
                    errorType: null
                }));
            }
            
            // Store scan metadata for the HTML report
            this._scanMetadata = {
                url: data.url,
                keywords: data.keywords || [],
                startedAt: data.startedAt,
                completedAt: data.completedAt
            };
            
            this.showResults(displayResults);
            
            this.setButtonsDisabled(false);
            
            // Update final status
            this.updateStatus('completed', 'Scan completed!');
            this.progressFill.style.width = '100%';
            this.progressText.textContent = '100%';
            
        } catch (error) {
            this.showError(error.message);
        }
    }
    
    showResults(urlResults) {
        this.resultsSection.classList.remove('hidden');
        this._currentResults = urlResults || [];
        
        const totalChecked = this._currentResults.length;
        const matchedCount = this._currentResults.filter(r => r.matchedKeywords && r.matchedKeywords.length > 0).length;
        const errorCount = this._currentResults.filter(r => r.isError || (r.statusCode && r.statusCode >= 400)).length;
        
        if (totalChecked === 0) {
            this.noResultsMessage.classList.remove('hidden');
            this.resultsCount.textContent = '0 pages checked';
            this._hidePagination();
            return;
        }
        
        this.noResultsMessage.classList.add('hidden');
        this.resultsCount.textContent = `${totalChecked} pages checked • ${matchedCount} with matches • ${errorCount} errors`;
        
        // Sort: matched URLs first, then alphabetically
        this._sortedResults = [...this._currentResults].sort((a, b) => {
            const aMatched = (a.matchedKeywords && a.matchedKeywords.length > 0) ? 0 : 1;
            const bMatched = (b.matchedKeywords && b.matchedKeywords.length > 0) ? 0 : 1;
            if (aMatched !== bMatched) return aMatched - bMatched;
            return a.url.localeCompare(b.url);
        });
        
        // Initialize pagination
        this._currentPage = 1;
        this._itemsPerPage = 50;
        
        const pageSizeSelect = document.getElementById('pageSizeSelect');
        if (pageSizeSelect) {
            this._itemsPerPage = parseInt(pageSizeSelect.value) || 50;
            pageSizeSelect.onchange = () => {
                this._itemsPerPage = parseInt(pageSizeSelect.value) || 50;
                this._currentPage = 1;
                this._applyFilterAndRender();
            };
        }
        
        this._applyFilterAndRender();
        
        // Setup live filters
        const filterInput = document.getElementById('resultsFilter');
        const statusFilter = document.getElementById('statusFilter');
        
        const applyFilters = () => {
            this._currentPage = 1;
            this._applyFilterAndRender();
        };
        
        if (filterInput) {
            filterInput.oninput = applyFilters;
        }
        if (statusFilter) {
            statusFilter.onchange = applyFilters;
        }

        // Setup action buttons
        const printBtn = document.getElementById('printHtmlReportBtn');
        if (printBtn) printBtn.onclick = () => this._generateHtmlReport();

        const copyBtn = document.getElementById('copyUrlsBtn');
        if (copyBtn) copyBtn.onclick = () => this._copyCurrentUrls();

        const exportBtn = document.getElementById('exportCsvBtn');
        if (exportBtn) exportBtn.onclick = () => this._exportCurrentAsCSV();
    }
    
    _applyFilterAndRender() {
        const filterInput = document.getElementById('resultsFilter');
        const statusFilter = document.getElementById('statusFilter');
        
        const term = filterInput ? filterInput.value.toLowerCase().trim() : '';
        const statusMode = statusFilter ? statusFilter.value : 'all';
        
        let filtered = this._sortedResults || [];
        
        // Text filter
        if (term) {
            filtered = filtered.filter(r => r.url.toLowerCase().includes(term));
        }
        
        // Status filter
        if (statusMode === 'ok') {
            filtered = filtered.filter(r => {
                const code = r.statusCode || 0;
                return code === 200 && !(r.isError || code >= 400);
            });
        } else if (statusMode === 'errors') {
            filtered = filtered.filter(r => {
                const code = r.statusCode || 0;
                return r.isError || code >= 400 || code === 0;
            });
        }
        
        this._filteredResults = filtered;
        this._renderPaginatedResults();
    }
    
    _renderPaginatedResults() {
        const tbody = this.resultsBody;
        tbody.innerHTML = '';
        
        const filtered = this._filteredResults || [];
        const total = filtered.length;
        
        if (total === 0) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 3;
            cell.textContent = 'No URLs match the filter.';
            cell.style.color = 'var(--text-light)';
            row.appendChild(cell);
            tbody.appendChild(row);
            this._updatePaginationUI(0, 0);
            return;
        }
        
        const start = (this._currentPage - 1) * this._itemsPerPage;
        const end = Math.min(start + this._itemsPerPage, total);
        const pageItems = filtered.slice(start, end);
        
        for (const item of pageItems) {
            const row = document.createElement('tr');
            
            const hasMatches = item.matchedKeywords && item.matchedKeywords.length > 0;
            const isError = item.isError || (item.statusCode && item.statusCode >= 400);
            
            if (isError) {
                row.style.backgroundColor = '#fef2f2';
            } else if (!hasMatches) {
                row.style.opacity = '0.78';
            }
            
            // URL cell (clickable)
            const urlCell = document.createElement('td');
            const link = document.createElement('a');
            link.href = item.url;
            link.textContent = item.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.style.wordBreak = 'break-all';
            link.title = item.url;
            urlCell.appendChild(link);
            
            // Page Status cell
            const statusCell = document.createElement('td');
            const statusPill = document.createElement('span');
            
            const statusCode = item.statusCode || 0;
            
            if (isError) {
                statusPill.className = 'status-pill';
                statusPill.style.cssText = 'background:#ef4444;color:white;padding:2px 8px;border-radius:9999px;font-size:0.72rem;font-weight:600;';
                const errorLabel = item.errorType || statusCode || 'Error';
                statusPill.textContent = errorLabel;
            } else if (statusCode === 200) {
                statusPill.className = 'status-pill';
                statusPill.style.cssText = 'background:#10b981;color:white;padding:2px 8px;border-radius:9999px;font-size:0.72rem;font-weight:600;';
                statusPill.textContent = '200 OK';
            } else {
                statusPill.className = 'status-pill';
                statusPill.style.cssText = 'background:#f59e0b;color:white;padding:2px 8px;border-radius:9999px;font-size:0.72rem;font-weight:600;';
                statusPill.textContent = statusCode ? `${statusCode}` : 'Unknown';
            }
            
            statusCell.appendChild(statusPill);
            
            // Keywords cell
            const kwCell = document.createElement('td');
            if (hasMatches) {
                kwCell.innerHTML = item.matchedKeywords
                    .map(kw => `<span style="background:#e0e7ff;color:#3730a3;padding:1px 5px;border-radius:3px;font-size:0.75rem;margin-right:3px;">${kw}</span>`)
                    .join(' ');
            } else {
                kwCell.textContent = '—';
                kwCell.style.color = 'var(--text-light)';
            }
            
            row.appendChild(urlCell);
            row.appendChild(statusCell);
            row.appendChild(kwCell);
            tbody.appendChild(row);
        }
        
        this._updatePaginationUI(this._currentPage, Math.ceil(total / this._itemsPerPage));
    }
    
    _updatePaginationUI(current, totalPages) {
        const info = document.getElementById('pageInfo');
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');
        
        if (info) info.textContent = `Page ${current} of ${Math.max(1, totalPages)}`;
        
        if (prevBtn) {
            prevBtn.disabled = current <= 1;
            prevBtn.onclick = () => {
                if (this._currentPage > 1) {
                    this._currentPage--;
                    this._renderPaginatedResults();
                }
            };
        }
        
        if (nextBtn) {
            nextBtn.disabled = current >= totalPages;
            nextBtn.onclick = () => {
                const maxPage = Math.ceil((this._filteredResults || []).length / this._itemsPerPage);
                if (this._currentPage < maxPage) {
                    this._currentPage++;
                    this._renderPaginatedResults();
                }
            };
        }
        
        const controls = document.getElementById('paginationControls');
        if (controls) controls.style.display = totalPages > 1 ? 'flex' : 'none';
    }
    
    _hidePagination() {
        const controls = document.getElementById('paginationControls');
        if (controls) controls.style.display = 'none';
    }

    _generateHtmlReport() {
        if (!this._currentResults || this._currentResults.length === 0) {
            alert('No results available to generate report.');
            return;
        }

        const meta = this._scanMetadata || {};
        const matchedCount = this._currentResults.filter(r => r.matchedKeywords && r.matchedKeywords.length > 0).length;
        const noMatchCount = this._currentResults.length - matchedCount;

        const now = new Date().toLocaleString();
        const scannedUrl = meta.url || 'N/A';
        const keywordsList = (meta.keywords || []).join(', ') || 'N/A';
        const scanDate = meta.completedAt ? new Date(meta.completedAt).toLocaleString() : now;

        // Calculate scan duration
        let duration = 'N/A';
        if (meta.startedAt && meta.completedAt) {
            const start = new Date(meta.startedAt);
            const end = new Date(meta.completedAt);
            const diffMs = end - start;
            const minutes = Math.floor(diffMs / 60000);
            const seconds = Math.floor((diffMs % 60000) / 1000);
            duration = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
        }

        let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Website Keyword Audit Report</title>
<style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 40px; color: #1f2937; line-height: 1.5; }
    h1 { color: #2563eb; border-bottom: 3px solid #2563eb; padding-bottom: 8px; }
    .meta { background: #f8fafc; padding: 16px; border-radius: 8px; margin-bottom: 24px; }
    .meta p { margin: 4px 0; }
    .stats { display: flex; gap: 24px; margin: 20px 0; }
    .stat { background: white; border: 1px solid #e5e7eb; padding: 12px 18px; border-radius: 6px; }
    .stat strong { display: block; font-size: 1.1rem; color: #2563eb; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; }
    th { background: #f3f4f6; font-weight: 600; }
    tr:nth-child(even) { background: #fafafa; }
    .status-matched { background: #10b981; color: white; padding: 2px 10px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
    .status-nomatch { background: #6b7280; color: white; padding: 2px 10px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
    .kw-pill { background: #e0e7ff; color: #3730a3; padding: 1px 6px; border-radius: 3px; font-size: 0.8rem; margin-right: 4px; }
    .footer { margin-top: 40px; font-size: 0.85rem; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 12px; }
    @media print {
        body { margin: 20px; }
        .no-print { display: none; }
        table { page-break-inside: auto; }
        tr { page-break-inside: avoid; page-break-after: auto; }
    }
</style>
</head>
<body>
    <h1>Website Keyword Audit Report</h1>
    
    <div class="meta">
        <p><strong>Scanned URL:</strong> ${scannedUrl}</p>
        <p><strong>Keywords Searched:</strong> ${keywordsList}</p>
        <p><strong>Scan Started:</strong> ${meta.startedAt ? new Date(meta.startedAt).toLocaleString() : 'N/A'}</p>
        <p><strong>Scan Completed:</strong> ${scanDate}</p>
        <p><strong>Duration:</strong> ${duration}</p>
        <p><strong>Generated:</strong> ${now}</p>
        <p><strong>QA Performed By:</strong> Md Imran</p>
    </div>

    <div class="stats">
        <div class="stat"><strong>${this._currentResults.length}</strong> Pages Checked</div>
        <div class="stat"><strong>${matchedCount}</strong> With Matches</div>
        <div class="stat"><strong>${this._currentResults.filter(r => r.isError || (r.statusCode >= 400)).length}</strong> Failed / Error</div>
    </div>

    <table>
        <thead>
            <tr>
                <th>URL</th>
                <th>Page Status</th>
                <th>Keywords Found</th>
            </tr>
        </thead>
        <tbody>`;

        this._currentResults.forEach(item => {
            const hasMatches = item.matchedKeywords && item.matchedKeywords.length > 0;
            const isError = item.isError || (item.statusCode && item.statusCode >= 400);
            
            let pageStatusHtml = '';
            const statusCode = item.statusCode || 0;
            
            if (isError) {
                const errorLabel = item.errorType || statusCode || 'Error';
                pageStatusHtml = `<span style="background:#ef4444;color:white;padding:2px 8px;border-radius:999px;font-size:0.75rem;font-weight:600;">${errorLabel}</span>`;
            } else if (statusCode === 200) {
                pageStatusHtml = `<span style="background:#10b981;color:white;padding:2px 8px;border-radius:999px;font-size:0.75rem;font-weight:600;">200 OK</span>`;
            } else {
                pageStatusHtml = `<span style="background:#f59e0b;color:white;padding:2px 8px;border-radius:999px;font-size:0.75rem;font-weight:600;">${statusCode || 'Unknown'}</span>`;
            }
            
            const kws = hasMatches 
                ? item.matchedKeywords.map(k => `<span class="kw-pill">${k}</span>`).join(' ') 
                : '—';

            // Escape for safe insertion into template literal and HTML
            const safeUrl = String(item.url || '').replace(/`/g, '\\`').replace(/\$/g, '\\$');
            const safeUrlAttr = String(item.url || '').replace(/"/g, '&quot;');

            html += `
            <tr>
                <td style="word-break: break-all;"><a href="${safeUrlAttr}" target="_blank">${safeUrl}</a></td>
                <td>${pageStatusHtml}</td>
                <td>${kws}</td>
            </tr>`;
        });

        html += `</tbody></table>

    <div class="footer">
        Report generated by <strong>Website Keyword Auditor</strong><br>
        Use your browser's Print function (Ctrl/Cmd + P) and choose "Save as PDF" for a clean PDF version.
    </div>

    <div class="no-print" style="margin-top:30px;">
        <button onclick="window.print()" style="padding:10px 20px; background:#2563eb; color:white; border:none; border-radius:6px; cursor:pointer; font-size:1rem;">
            Print / Save as PDF
        </button>
        <button onclick="window.close()" style="margin-left:12px; padding:10px 20px;">Close</button>
    </div>

    <script>
        // Try to fill scan URL if available (from opener if possible)
        console.log('%c[Report] Print this page or use Save as PDF', 'color:#666');
    </script>
</body>
</html>`;

        const reportWindow = window.open('', '_blank');
        if (reportWindow) {
            // Use Blob + location for more reliable loading (avoids blank popup issues)
            const blob = new Blob([html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            reportWindow.location = url;
            reportWindow.focus();
        } else {
            alert('Please allow pop-ups to view the HTML report.');
        }
    }

    _copyCurrentUrls() {
        const results = this._filteredResults || this._currentResults || [];
        if (results.length === 0) {
            alert('No URLs to copy.');
            return;
        }

        const urls = results.map(r => r.url).join('\n');
        
        navigator.clipboard.writeText(urls).then(() => {
            const btn = document.getElementById('copyUrlsBtn');
            if (btn) {
                const oldText = btn.textContent;
                btn.textContent = '✅ Copied!';
                setTimeout(() => {
                    if (btn) btn.textContent = oldText;
                }, 1800);
            } else {
                alert(`Copied ${results.length} URLs to clipboard`);
            }
        }).catch(() => {
            // Fallback
            const textarea = document.createElement('textarea');
            textarea.value = urls;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            alert(`Copied ${results.length} URLs (fallback method)`);
        });
    }

    _exportCurrentAsCSV() {
        const results = this._filteredResults || this._currentResults || [];
        if (results.length === 0) {
            alert('No data to export.');
            return;
        }

        const headers = ['URL', 'Status', 'Keywords Found'];
        let csv = headers.join(',') + '\n';

        results.forEach(item => {
            const hasMatches = item.matchedKeywords && item.matchedKeywords.length > 0;
            const status = hasMatches ? 'Matched' : 'No matches';
            const keywords = hasMatches ? item.matchedKeywords.join('; ') : '';
            
            // Escape quotes and commas for CSV
            const safeUrl = `"${item.url.replace(/"/g, '""')}"`;
            const safeKeywords = `"${keywords.replace(/"/g, '""')}"`;
            
            csv += `${safeUrl},${status},${safeKeywords}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `keyword-audit-results-${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
    
    showProgress() {
        this.progressSection.classList.remove('hidden');
        this.errorSection.classList.add('hidden');
        this.resultsSection.classList.add('hidden');
        
        // Reset stats
        this.urlsDiscoveredEl.textContent = '0';
        this.urlsProcessedEl.textContent = '0';
        this.currentBatchEl.textContent = '0';
        this.matchesFoundEl.textContent = '0';
        this.progressFill.style.width = '0%';
        this.progressText.textContent = '0%';

        // Clear recent URLs
        this._recentUrls = [];
        const recentList = document.getElementById('recentUrlsList');
        if (recentList) recentList.innerHTML = '';
    }
    
    showError(message) {
        this.errorSection.classList.remove('hidden');
        this.progressSection.classList.add('hidden');
        this.resultsSection.classList.add('hidden');
        this.errorMessage.textContent = message;
        this.updateStatus('failed', 'Error occurred');
        this.setButtonsDisabled(false);
    }
    
    clearAll() {
        this.stopStatusPolling();
        this.currentScanId = null;
        this.lastStats = null;
        this._currentResults = [];
        this._sortedResults = [];
        this._filteredResults = [];
        this._scanMetadata = null;
        
        // Clear inputs
        this.websiteUrlInput.value = '';
        this.keywordsInput.value = '';
        
        // Hide sections
        this.progressSection.classList.add('hidden');
        this.resultsSection.classList.add('hidden');
        this.errorSection.classList.add('hidden');
        
        // Reset buttons
        this.setButtonsDisabled(false);
        
        // Reset stats display
        this.urlsDiscoveredEl.textContent = '0';
        this.urlsProcessedEl.textContent = '0';
        this.currentBatchEl.textContent = '0';
        this.matchesFoundEl.textContent = '0';
        this.progressFill.style.width = '0%';
        this.progressText.textContent = '0%';
        
        // Reset filter
        const filter = document.getElementById('resultsFilter');
        if (filter) filter.value = '';

        // Clear recent URLs list
        this._recentUrls = [];
        const recentList = document.getElementById('recentUrlsList');
        if (recentList) recentList.innerHTML = '';
    }
    
    retry() {
        this.errorSection.classList.add('hidden');
        this.startScan();
    }
    
    setButtonsDisabled(disabled) {
        this.startScanBtn.disabled = disabled;
        this.clearBtn.disabled = disabled;
    }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    window.auditor = new KeywordAuditor();
});