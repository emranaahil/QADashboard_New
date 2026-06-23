const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

async function generatePdf({ htmlPath, pdfPath }) {
   console.log('[PDF] htmlPath =', htmlPath);
  console.log('[PDF] pdfPath =', pdfPath);
  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  try {
    const page = await browser.newPage();

    const fileUrl = `file://${path.resolve(htmlPath)}`;
    console.log('[PDF] fileUrl =', fileUrl);

    console.log('[PDF] Loading HTML...');
    await page.goto(fileUrl, {
      waitUntil: 'load',
      timeout: 60000
    });

    console.log('[PDF] HTML loaded');

    await page.waitForTimeout(1000);

    console.log('[PDF] Generating PDF...');

    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm'
      }
    });
     console.log('[PDF] PDF generated successfully');
  } catch (err) {
    console.error('[PDF] ERROR:', err);
    throw err; // important
  } finally {
    await browser.close();
  }
}

module.exports = generatePdf;

