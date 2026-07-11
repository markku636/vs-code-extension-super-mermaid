// Generates docs/images/markdown-preview.png — the full Markdown document
// preview screenshot referenced by README.md.
//
// Drives the real webview bundle (dist/markdownDocument.js) inside headless
// Chrome via test/markdown-document-harness.html. The demo markdown below is
// rendered with the same markdown-it + highlight.js pipeline the extension
// host uses, so the shot is exactly what users see.
//
// Usage:  npm run build && node scripts/genMarkdownDocImage.mjs
// Output: docs/images/markdown-preview.png
//
// Requires a local Chrome or Edge (no browser download); override the
// auto-detected path with CHROME_PATH.

import hljs from 'highlight.js';
import MarkdownIt from 'markdown-it';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'docs', 'images');

// ─── Demo document (what the screenshot shows) ───────────────────────────────

const DEMO_MD = `# Payment Service — Deposit Flow

> How a deposit travels from the player's click to a confirmed balance,
> and which services touch it along the way.

## Architecture

\`\`\`mermaid
flowchart LR
    Player((Player)) --> FE[Member Site]
    FE --> PS[Payment Service]
    PS --> GW[Payment Gateway]
    GW -->|signed callback| PS
    PS --> DB[(Siebog DB)]
    PS --> MQ[[Settle Queue]]
\`\`\`

The gateway calls us back **server-to-server** — the browser redirect is only
cosmetic. Every callback is verified against the stored signature *before* any
balance is touched.

## Callback verification

\`\`\`ts
export function verifyCallback(payload: CallbackPayload, secret: string): boolean {
  const expected = hmacSha256(payload.raw, secret);
  return timingSafeEqual(expected, payload.signature);
}
\`\`\`

## Status mapping

| Gateway status | Our status | Player balance |
| --- | --- | --- |
| \`PAID\` | \`Success\` | credited |
| \`PENDING\` | \`Processing\` | untouched |
| \`EXPIRED\` | \`Failed\` | untouched |

## Sequence

\`\`\`mermaid
sequenceDiagram
    Player->>PaymentService: CreateDeposit()
    PaymentService->>Gateway: order + signature
    Gateway-->>Player: hosted payment page
    Gateway->>PaymentService: callback (signed)
    PaymentService->>DB: credit balance
\`\`\`
`;

// ─── Host-side rendering (mirrors MarkdownPreviewPanel.createMarkdownIt) ─────

function renderMarkdown(source) {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: false,
    highlight: (str, lang) => {
      if (!lang || lang === 'mermaid' || lang === 'mmd') {
        return '';
      }
      if (hljs.getLanguage(lang)) {
        try {
          const out = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
          return `<pre class="hljs"><code class="language-${lang}">${out}</code></pre>`;
        } catch {
          /* fall through to default escaping */
        }
      }
      return '';
    },
  });
  md.core.ruler.push('source_line', (state) => {
    for (const token of state.tokens) {
      if (token.map && token.level === 0 && token.type !== 'fence') {
        token.attrSet('data-line', String(token.map[0]));
      }
    }
    return false;
  });
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const html = defaultFence(tokens, idx, options, env, self);
    const line = tokens[idx].map?.[0];
    return line == null ? html : html.replace(/^<pre/, `<pre data-line="${line}"`);
  };
  return md.render(source);
}

// ─── Static file server + browser helpers (same as genDemoImages.mjs) ────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
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

// ─── Main ────────────────────────────────────────────────────────────────────

const html = renderMarkdown(DEMO_MD);
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
  await page.goto(`http://127.0.0.1:${port}/test/markdown-document-harness.html`, {
    waitUntil: 'networkidle0',
  });
  // The webview announces readiness like it would to the extension host.
  await page.waitForFunction(() => window.__messages.some((m) => m.type === 'ready'), {
    timeout: 15_000,
  });

  // Post the same 'update' message MarkdownPreviewPanel would send.
  await page.evaluate((renderedHtml) => {
    window.postMessage({ type: 'update', fileName: 'deposit-flow.md', html: renderedHtml }, '*');
  }, html);

  // Both mermaid blocks rendered to SVG.
  await page.waitForFunction(
    () => document.querySelectorAll('#md-content svg').length >= 2,
    { timeout: 30_000 },
  );

  // Open the outline so the shot shows the TOC sidebar.
  await page.evaluate(() => document.getElementById('md-toc-toggle').click());
  await page.waitForFunction(() => !document.getElementById('md-toc').hidden, { timeout: 5_000 });
  await sleep(600); // fonts + layout settle

  await page.screenshot({ path: join(OUT_DIR, 'markdown-preview.png') });
  console.log('saved markdown-preview.png');
} finally {
  await browser.close();
  server.close();
}
