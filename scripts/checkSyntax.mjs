// 問 mermaid：這段語法你到底吃不吃?
//
// 加新圖種時反覆需要這個答案 —— 而且答案常常出乎意料(requirement 的名稱不吃中文、
// sankey 連加了引號的中文都不吃、architecture 的 [標籤] 也有自己的規矩)。用猜的會做出
// 「看起來對、實際上渲染不出來」的序列化,所以一律直接問。
//
// 用法:
//   node scripts/checkSyntax.mjs cases.json     # [{name, code}, …]
//   node scripts/checkSyntax.mjs --file a.mmd   # 單一檔案

import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = join(ROOT, '.verify-syntax');

const args = process.argv.slice(2);
const fileIdx = args.indexOf('--file');
const cases =
  fileIdx >= 0
    ? [{ name: args[fileIdx + 1], code: readFileSync(args[fileIdx + 1], 'utf8') }]
    : JSON.parse(readFileSync(args[0], 'utf8'));

const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
async function serve() {
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = normalize(join(ROOT, urlPath));
    if (!file.startsWith(ROOT) || !existsSync(file)) return void res.writeHead(404).end('not found');
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

function findChrome() {
  const c = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  const f = c.find((p) => existsSync(p));
  if (!f) throw new Error('找不到 Chrome/Edge —— 請設定 CHROME_PATH。');
  return f;
}

mkdirSync(WORK, { recursive: true });
writeFileSync(
  join(WORK, 'entry.mjs'),
  "import mermaid from 'mermaid';\nmermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });\nwindow.__mermaid = mermaid;\nwindow.__ready = true;",
);
await build({
  entryPoints: [join(WORK, 'entry.mjs')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: join(WORK, 'bundle.js'),
  logLevel: 'warning',
});
writeFileSync(join(WORK, 'index.html'), '<!doctype html><meta charset="utf-8"><body><script src="bundle.js"></script></body>');

const server = await serve();
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: 'new', args: ['--disable-gpu'] });
let failed = 0;
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/.verify-syntax/index.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 30000 });
  const out = await page.evaluate(async (cs) => {
    const r = [];
    for (const c of cs) {
      try {
        await window.__mermaid.parse(c.code);
        r.push({ name: c.name, ok: true });
      } catch (e) {
        r.push({ name: c.name, ok: false, error: String((e && e.message) || e).split(/\r?\n/)[0] });
      }
    }
    return r;
  }, cases);
  for (const r of out) {
    if (!r.ok) failed += 1;
    console.log(`[${r.ok ? ' OK ' : 'FAIL'}] ${r.name}${r.ok ? '' : ` — ${r.error}`}`);
  }
} finally {
  await browser.close();
  server.close();
  rmSync(WORK, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
