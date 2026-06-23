/**
 * Report Service
 * Generates professional PDF reports using PDFKit
 */

const PDFDocument = require('pdfkit');
const fs = require('fs-extra');
const path = require('path');

const { keywordStorageDir } = require('../shared/storagePaths');
const REPORTS_DIR = keywordStorageDir('reports');

// Ensure reports directory exists
fs.ensureDirSync(REPORTS_DIR);

/**
 * Generate a professional PDF report
 * @param {Object} scanData - The scan data object
 * @returns {string} - Path to the generated PDF
 */
async function generatePDF(scanData) {
    return new Promise((resolve, reject) => {
        try {
            const filename = `keyword-audit-report-${scanData.id}.pdf`;
            const filePath = path.join(REPORTS_DIR, filename);
            
            // Create PDF document
            const doc = new PDFDocument({
                size: 'A4',
                margins: {
                    top: 80,
                    bottom: 60,
                    left: 40,
                    right: 40
                },
                info: {
                    Title: 'Website Keyword Audit Report',
                    Author: 'Website Keyword Auditor',
                    Subject: 'Keyword Audit',
                    CreationDate: new Date()
                }
            });
            
            // Pipe to file
            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);
            
            // Track page height for footer/header
            let pageNumber = 1;
            const pageHeight = doc.page.height;
            const bottomMargin = 60;
            const topMargin = 80;
            
            // Colors
            const primaryColor = '#2563eb';
            const textColor = '#1f2937';
            const lightGray = '#6b7280';
            const tableHeaderBg = '#f3f4f6';
            
            // Header function
            function addHeader() {
                doc.fontSize(10)
                   .fillColor(lightGray)
                   .text('Website Keyword Audit Report', 40, 40, { align: 'center' })
                   .moveDown(0.5);
            }
            
            // Footer function
            function addFooter() {
                const footerY = pageHeight - 40;
                
                // Footer line
                doc.strokeColor(lightGray)
                   .lineWidth(0.5)
                   .moveTo(40, footerY - 10)
                   .lineTo(doc.page.width - 40, footerY - 10)
                   .stroke();
                
                // Footer text
                doc.fontSize(9)
                   .fillColor(lightGray)
                   .text('Website Keyword Auditor', 40, footerY, { align: 'left' })
                   .text(`QA Done By: Md Imran`, doc.page.width - 40, footerY, { align: 'right', width: 200 });
                
                // Page number
                doc.text(`Page ${pageNumber}`, doc.page.width / 2, footerY, { align: 'center' });
            }
            
            // Add header on first page
            addHeader();
            
            // Title
            doc.fontSize(24)
               .fillColor(primaryColor)
               .text('WEBSITE KEYWORD AUDIT REPORT', 0, 70, { align: 'center' })
               .moveDown(1);
            
            // Report metadata
            const startDate = new Date(scanData.startedAt).toLocaleString();
            const endDate = scanData.completedAt ? new Date(scanData.completedAt).toLocaleString() : 'N/A';
            
            doc.fontSize(11)
               .fillColor(textColor);
            
            // Info box
            const infoY = doc.y;
            const infoBoxWidth = doc.page.width - 80;
            
            doc.rect(40, infoY, infoBoxWidth, 130)
               .fillAndStroke('#f9fafb', '#e5e7eb');
            
            const col1X = 50;
            const col2X = doc.page.width / 2;
            const labelY = infoY + 15;
            const valueY = infoY + 35;
            
            doc.fillColor(lightGray).text('Website:', col1X, labelY);
            doc.fillColor(textColor).text(scanData.url, col1X, valueY, { width: infoBoxWidth / 2 - 10 });
            
            doc.fillColor(lightGray).text('QA Done By:', col2X, labelY);
            doc.fillColor(textColor).text('Md Imran', col2X, valueY);
            
            doc.fillColor(lightGray).text('Generated:', col1X, labelY + 40);
            doc.fillColor(textColor).text(endDate, col1X, valueY + 40);
            
            doc.fillColor(lightGray).text('Pages Crawled:', col2X, labelY + 40);
            doc.fillColor(textColor).text(scanData.stats.urlsProcessed.toString(), col2X, valueY + 40);
            
            doc.fillColor(lightGray).text('Matches Found:', col1X, labelY + 80);
            doc.fillColor(primaryColor).text(scanData.stats.matchesFound.toString(), col1X, valueY + 80);
            
            doc.fillColor(lightGray).text('URLs Discovered:', col2X, labelY + 80);
            doc.fillColor(textColor).text(scanData.stats.urlsDiscovered.toString(), col2X, valueY + 80);
            
            doc.y = infoY + 145;
            
            // Keywords section
            doc.fontSize(14)
               .fillColor(primaryColor)
               .text('Search Keywords', 40, doc.y)
               .moveDown(0.5);
            
            doc.fontSize(10)
               .fillColor(textColor);
            
            const keywordsText = (scanData.keywords || []).join(', ') || 'None';
            doc.text(keywordsText, 40, doc.y, {
                width: doc.page.width - 80,
                align: 'left'
            });
            
            doc.moveDown(1);
            
            // Results table header
            doc.fontSize(14)
               .fillColor(primaryColor)
               .text('Results', 40, doc.y)
               .moveDown(0.5);
            
            // Prefer structured results (new format) over flat matches
            const reportItems = (scanData.results && scanData.results.length > 0)
                ? scanData.results
                : (scanData.matches || []).map(m => ({ url: m.url, matchedKeywords: [m.keyword] }));

            // Table setup
            const tableTop = doc.y;
            const urlColWidth = (doc.page.width - 80) * 0.62;
            const statusColWidth = (doc.page.width - 80) * 0.15;
            const keywordColWidth = (doc.page.width - 80) * 0.23;
            
            // Table header
            doc.rect(40, tableTop, urlColWidth, 25).fillAndStroke(tableHeaderBg, '#d1d5db');
            doc.rect(40 + urlColWidth, tableTop, statusColWidth, 25).fillAndStroke(tableHeaderBg, '#d1d5db');
            doc.rect(40 + urlColWidth + statusColWidth, tableTop, keywordColWidth, 25).fillAndStroke(tableHeaderBg, '#d1d5db');
            
            doc.fontSize(10)
               .fillColor(textColor)
               .text('URL', 45, tableTop + 7)
               .text('STATUS', 45 + urlColWidth, tableTop + 7)
               .text('KEYWORDS', 45 + urlColWidth + statusColWidth, tableTop + 7);
            
            let currentY = tableTop + 25;
            const rowHeight = 20;
            const maxY = pageHeight - bottomMargin - 20;
            
            // Table rows
            for (const item of reportItems) {
                const hasMatches = item.matchedKeywords && item.matchedKeywords.length > 0;
                const statusText = hasMatches ? 'Matched' : 'No matches';
                const keywordsText = hasMatches ? item.matchedKeywords.join(', ') : '—';

                // Check if we need a new page
                if (currentY + rowHeight > maxY) {
                    // Add footer to current page
                    addFooter();
                    pageNumber++;
                    
                    // New page
                    doc.addPage();
                    addHeader();
                    
                    // Reset Y for new table
                    currentY = topMargin;
                    
                    // Redraw table header
                    doc.rect(40, currentY, urlColWidth, 25).fillAndStroke(tableHeaderBg, '#d1d5db');
                    doc.rect(40 + urlColWidth, currentY, statusColWidth, 25).fillAndStroke(tableHeaderBg, '#d1d5db');
                    doc.rect(40 + urlColWidth + statusColWidth, currentY, keywordColWidth, 25).fillAndStroke(tableHeaderBg, '#d1d5db');
                    
                    doc.fontSize(10)
                       .fillColor(textColor)
                       .text('URL', 45, currentY + 7)
                       .text('STATUS', 45 + urlColWidth, currentY + 7)
                       .text('KEYWORDS', 45 + urlColWidth + statusColWidth, currentY + 7);
                    
                    currentY += 25;
                }
                
                // Draw row
                doc.rect(40, currentY, urlColWidth, rowHeight).fillAndStroke('#ffffff', '#e5e7eb');
                doc.rect(40 + urlColWidth, currentY, statusColWidth, rowHeight).fillAndStroke('#ffffff', '#e5e7eb');
                doc.rect(40 + urlColWidth + statusColWidth, currentY, keywordColWidth, rowHeight).fillAndStroke('#ffffff', '#e5e7eb');
                
                doc.fontSize(8)
                   .fillColor(textColor)
                   .text(truncateUrl(item.url, urlColWidth - 10), 45, currentY + 5, { width: urlColWidth - 10 });
                
                if (hasMatches) {
                    doc.fillColor('#10b981').text(statusText, 45 + urlColWidth, currentY + 5);
                } else {
                    doc.fillColor('#6b7280').text(statusText, 45 + urlColWidth, currentY + 5);
                }
                
                doc.fillColor(textColor)
                   .text(keywordsText, 45 + urlColWidth + statusColWidth, currentY + 5, { width: keywordColWidth - 8 });
                
                currentY += rowHeight;
            }
            
            // Add final footer
            addFooter();
            
            // Finalize PDF
            doc.end();
            
            stream.on('finish', () => {
                resolve(filePath);
            });
            
            stream.on('error', (err) => {
                reject(err);
            });
            
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Truncate URL to fit in cell
 */
function truncateUrl(url, maxWidth) {
    const maxLength = 80;
    if (url.length <= maxLength) return url;
    
    // Try to truncate intelligently
    const start = url.substring(0, 40);
    const end = url.substring(url.length - 35);
    
    return start + '...' + end;
}

/**
 * Get report file path
 */
function getReportPath(scanId) {
    return path.join(REPORTS_DIR, `keyword-audit-report-${scanId}.pdf`);
}

/**
 * Check if report exists
 */
async function reportExists(scanId) {
    const filePath = getReportPath(scanId);
    return fs.pathExists(filePath);
}

/**
 * Delete report
 */
async function deleteReport(scanId) {
    const filePath = getReportPath(scanId);
    await fs.remove(filePath);
}

module.exports = {
    generatePDF,
    getReportPath,
    reportExists,
    deleteReport
};