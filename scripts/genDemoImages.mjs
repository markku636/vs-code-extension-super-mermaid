// Generates the demo images referenced by README.md and docs/DEMO.md.
//
// Drives the real webview export pipeline (dist/webview.js, Colorful theme,
// 2x PNG) inside headless Chrome via test/harness.html, so the output is
// exactly what users get from the extension's Export menu. Also captures two
// dark-mode page screenshots (preview panel + gallery).
//
// Usage:  npm run build && node scripts/genDemoImages.mjs
// Output: docs/images/*.png
//
// Requires a local Chrome or Edge (no browser download); override the
// auto-detected path with CHROME_PATH.

import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'docs', 'images');

// ─── Demo blocks: every ```mermaid block in examples/demo.md + the .mmd file ─

function stripFrontmatter(source) {
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return m ? source.slice(m[0].length) : source;
}

function frontmatterTitle(source) {
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return undefined;
  const t = m[1].match(/^title:\s*(.+)$/m);
  return t ? t[1].trim() : undefined;
}

function diagramType(source) {
  const first = stripFrontmatter(source).trimStart().split(/\s/, 1)[0].toLowerCase();
  return first
    .replace(/diagram(-v2)?$/, '') // sequenceDiagram / erDiagram / stateDiagram-v2 …
    .replace(/[^a-z]/g, '');
}

function loadBlocks() {
  const md = readFileSync(join(ROOT, 'examples', 'demo.md'), 'utf8');
  const blocks = [];
  const seen = new Map();
  for (const m of md.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)) {
    const source = m[1].replace(/\r\n/g, '\n').trimEnd();
    const type = diagramType(source) || 'diagram';
    const n = (seen.get(type) ?? 0) + 1;
    seen.set(type, n);
    blocks.push({
      name: n > 1 ? `${type}-${n}` : type,
      source,
      title: frontmatterTitle(source) ?? type,
    });
  }
  const mmd = readFileSync(join(ROOT, 'examples', 'architecture.mmd'), 'utf8')
    .replace(/\r\n/g, '\n')
    .trimEnd();
  blocks.push({ name: 'architecture', source: mmd, title: frontmatterTitle(mmd) ?? 'architecture' });
  return blocks;
}

// ─── Tiny static file server for the harness (browsers block file:// modules) ─

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function serveRoot() {
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = normalize(join(ROOT, urlPath));
    if (!file.startsWith(ROOT) || !existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

// ─── Browser helpers ─────────────────────────────────────────────────────────

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error('No Chrome/Edge found — set CHROME_PATH to a Chromium-based browser.');
  }
  return found;
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Waits for the serialized render/export queue to drain (no pending error). */
async function waitRendered(page) {
  await page.waitForFunction(
    () => {
      const svg = document.querySelector('#diagram svg');
      const err = document.getElementById('error');
      return svg !== null && (err === null || err.hidden);
    },
    { timeout: 30_000 },
  );
}

/** Clicks an export menu item and returns the new export's decoded bytes. */
async function exportPng(page, expectedCount) {
  await page.evaluate(() => {
    document.querySelector('#export-menu .menu-item[data-format="png"]').click();
  });
  await page.waitForFunction((n) => window.__exports.length >= n, { timeout: 60_000 }, expectedCount);
  const dataUrl = await page.evaluate((n) => window.__exports[n - 1].data, expectedCount);
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  return Buffer.from(base64, 'base64');
}

// ─── Main ────────────────────────────────────────────────────────────────────

const blocks = loadBlocks();
console.log(`Loaded ${blocks.length} demo blocks: ${blocks.map((b) => b.name).join(', ')}`);
mkdirSync(OUT_DIR, { recursive: true });

const server = await serveRoot();
const port = server.address().port;
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'new',
  args: ['--disable-gpu', '--force-device-scale-factor=2'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1480, height: 760, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.goto(`http://127.0.0.1:${port}/test/harness.html`, { waitUntil: 'networkidle0' });
  await waitRendered(page); // harness's own sample finished rendering

  // Swap in our demo blocks (same 'update' message PreviewPanel would send).
  await page.evaluate((demoBlocks) => {
    window.postMessage(
      {
        type: 'update',
        uri: 'file:///demo/demo.md',
        version: 2,
        fileName: 'demo.md',
        blocks: demoBlocks.map((b, i) => ({
          source: b.source,
          title: b.title,
          label: `${i + 1} · ${b.title}`,
        })),
        activeIndex: 0,
      },
      '*',
    );
  }, blocks);
  await page.waitForFunction(
    (n) => document.getElementById('block-select').options.length === n,
    { timeout: 30_000 },
    blocks.length,
  );
  await waitRendered(page);
  await sleep(400);

  // 1) Dark-mode page screenshots: single-diagram preview + gallery wall.
  await page.keyboard.press('0'); // fit to view
  await sleep(300);
  await page.screenshot({ path: join(OUT_DIR, 'preview-panel.png') });
  console.log('saved preview-panel.png');

  // Gallery now lives inside the hidden "More" menu, so click the button
  // programmatically rather than via a viewport hit-test.
  await page.evaluate(() => document.getElementById('gallery-toggle').click());
  await page.waitForFunction(
    (n) => document.querySelectorAll('#gallery .gallery-card-body svg').length === n,
    { timeout: 60_000 },
    blocks.length,
  );
  await sleep(300);
  await page.screenshot({ path: join(OUT_DIR, 'gallery.png') });
  console.log('saved gallery.png');
  await page.evaluate(() => document.getElementById('gallery-toggle').click()); // back to single view

  // 2) Light mode for the exported diagram images (white background).
  await page.evaluate(() => {
    document.body.className = 'vscode-light';
  });
  await sleep(600); // MutationObserver re-inits mermaid + re-renders
  await waitRendered(page);
  await page.evaluate(() => {
    const scale = document.getElementById('png-scale');
    scale.value = '2';
    scale.dispatchEvent(new Event('change'));
  });

  let exportCount = 0;
  const setTheme = async (value) => {
    await page.evaluate((v) => {
      const sel = document.getElementById('theme-select');
      sel.value = v;
      sel.dispatchEvent(new Event('change'));
    }, value);
    await sleep(400);
    await waitRendered(page);
  };

  // Plain default theme first — the README "before" shot (flowchart, index 0).
  await setTheme('default');
  writeFileSync(join(OUT_DIR, 'theme-default-flowchart.png'), await exportPng(page, ++exportCount));
  console.log('saved theme-default-flowchart.png');

  // Sketch (hand-drawn) — README theme comparison.
  await setTheme('sketch');
  writeFileSync(join(OUT_DIR, 'theme-sketch-flowchart.png'), await exportPng(page, ++exportCount));
  console.log('saved theme-sketch-flowchart.png');

  // Colorful theme — every demo block.
  await setTheme('colorful');
  for (let i = 0; i < blocks.length; i++) {
    await page.evaluate((idx) => {
      const sel = document.getElementById('block-select');
      sel.value = String(idx);
      sel.dispatchEvent(new Event('change'));
    }, i);
    const file = `demo-${blocks[i].name}.png`;
    writeFileSync(join(OUT_DIR, file), await exportPng(page, ++exportCount));
    console.log(`saved ${file}`);
  }

  console.log(`\nDone — ${exportCount + 2} images in docs/images/`);
} finally {
  await browser.close();
  server.close();
}
