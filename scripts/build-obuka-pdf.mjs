// Build the agent-training deck PDF from the self-contained HTML slide deck.
//
//   node scripts/build-obuka-pdf.mjs
//
// Renders obuka/Elyon-Obuka-Agenti.html through headless Chromium (Playwright,
// already a devDependency) and prints one landscape 16:9 slide per page.
//
// First run only — install the browser binary:
//   npx playwright install chromium
//
// Output: obuka/Elyon-Obuka-Agenti.pdf

import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const htmlPath = resolve(root, 'obuka', 'Elyon-Obuka-Agenti.html');
const pdfPath = resolve(root, 'obuka', 'Elyon-Obuka-Agenti.pdf');

if (!existsSync(htmlPath)) {
  console.error(`✗ HTML not found: ${htmlPath}`);
  process.exit(1);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });

  // Print media → the @media print rules reveal every slide, one per page.
  await page.emulateMedia({ media: 'print' });

  const slideCount = await page.locator('.slide').count();

  await page.pdf({
    path: pdfPath,
    width: '1280px',
    height: '720px',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
    pageRanges: '',
  });

  console.log(`✓ Wrote ${pdfPath}`);
  console.log(`  ${slideCount} slides → ${slideCount} landscape pages (1280×720).`);
} finally {
  await browser.close();
}
