// 繪製編輯器的自動驗證:所有圖種都跑「拖拉建圖 → 序列化 → mermaid 真的解析得動」。
//
// 為什麼要在瀏覽器裡跑:adapter.parse 走的是 mermaid 自己的 parser + DOM(getDiagramFromText),
// 在 node 裡連 mermaid 的 chunk 都 import 不起來(DOMPurify.addHook 需要 DOM)。所以這支腳本
// 用 esbuild 把「react-super-mermaid/editor + mermaid」打包成一份頁面腳本,丟進 headless Chrome
// 執行,拿到的結果就是使用者在 webview 裡會拿到的結果。
//
// 兩組檢查:
//   A. 建圖:對每個圖種,依 adapter 宣告的能力逐一放下每種外形 + 拉一條線,序列化後必須能被
//      mermaid.parse 接受(這正是「拖拉繪製」壞掉時最先崩的地方)。
//   B. 來回:src/templates.ts 的每份範本 loadSource → toMermaid,結果必須仍可解析、且不可變空。
//
// 用法:  npm run build && node scripts/verifyRoundtrip.mjs
// 需要本機 Chrome / Edge(不下載瀏覽器),可用 CHROME_PATH 指定。

import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = join(ROOT, '.verify');

// ─── 待驗圖種:各自的建圖劇本(shapes 由 adapter 能力決定,這裡只給圖種與是否連線)────────
const CASES = [
  { type: 'flowchart', source: 'flowchart TD\n  A[開始] --> B{判斷}\n', edge: true },
  { type: 'state', source: 'stateDiagram-v2\n  [*] --> 閒置\n  閒置 --> 執行中: 啟動\n', edge: true },
  { type: 'class', source: 'classDiagram\n  class 動物\n  動物 <|-- 狗\n', edge: true },
  { type: 'er', source: 'erDiagram\n  客戶 ||--o{ 訂單 : 下單\n', edge: true },
  { type: 'mindmap', source: 'mindmap\n  root((主題))\n    分支A\n', edge: false },
  { type: 'sequence', source: 'sequenceDiagram\n  使用者->>系統: 請求\n', edge: false },
  {
    type: 'requirement',
    source:
      'requirementDiagram\n  requirement login_req {\n    id: 1\n    text: Users must log in.\n    risk: medium\n    verifymethod: test\n  }\n',
    edge: true,
  },
  {
    type: 'kanban',
    source:
      'kanban\n  todo[待辦]\n    [設計稿]\n  doing[進行中]\n    slice[切版]@{ assigned: \'mark\', priority: \'High\' }\n  done[完成]\n    [需求訪談]\n',
    edge: false,
  },
  {
    type: 'c4',
    source:
      'C4Context\n  title 系統情境圖\n  Person(customer, "顧客", "使用網站的人")\n' +
      '  System(shop, "購物系統", "線上商店")\n  Rel(customer, shop, "瀏覽與下單", "HTTPS")\n',
    edge: true,
  },
  {
    type: 'quadrant',
    source:
      'quadrantChart\n  title 專案評估\n  x-axis 低成本 --> 高成本\n  y-axis 低效益 --> 高效益\n' +
      '  quadrant-1 該做\n  quadrant-2 快贏\n  quadrant-3 別做\n  quadrant-4 再想想\n  A: [0.3, 0.6]\n',
    edge: false,
  },
  // 刻意用 ASCII:mermaid 11 的 sankey lexer 不接受非 ASCII 名稱。
  { type: 'sankey', source: 'sankey-beta\n\nGrid,Homes,30\nGrid,Industry,45\n', edge: true },
];

// ─── 靜態伺服器 ──────────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
async function serve() {
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
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('找不到 Chrome/Edge —— 請設定 CHROME_PATH。');
  return found;
}

// ─── 頁面腳本:把引擎 + mermaid 掛到 window,實際檢查邏輯在 page.evaluate 裡 ────────────
const ENTRY = `
import mermaid from 'mermaid';
import * as editor from 'react-super-mermaid/editor';
mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
editor.registerFlowchartAdapter();
editor.registerStateAdapter();
editor.registerErAdapter();
editor.registerClassAdapter();
editor.registerMindmapAdapter();
editor.registerSequenceAdapter();
editor.registerRequirementAdapter();
editor.registerQuadrantAdapter();
editor.registerC4Adapter();
editor.registerKanbanAdapter();
editor.registerSankeyAdapter();
window.__editor = editor;
window.__mermaid = mermaid;
window.__ready = true;
`;

async function bundle() {
  mkdirSync(WORK, { recursive: true });
  writeFileSync(join(WORK, 'entry.mjs'), ENTRY);
  await build({
    entryPoints: [join(WORK, 'entry.mjs')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    outfile: join(WORK, 'bundle.js'),
    logLevel: 'warning',
  });
  writeFileSync(
    join(WORK, 'index.html'),
    '<!doctype html><meta charset="utf-8"><body><div id="app"></div><script src="bundle.js"></script></body>',
  );
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────
await bundle();
const server = await serve();
const { port } = server.address();
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: 'new', args: ['--disable-gpu'] });
const results = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.goto(`http://127.0.0.1:${port}/.verify/index.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 30000 });

  // A. 建圖:每個圖種、每種外形都放一顆,再拉一條線。
  const drawn = await page.evaluate(async (cases) => {
    const out = [];
    for (const c of cases) {
      const host = document.getElementById('app');
      host.innerHTML = '';
      const h = window.__editor.createDiagramEditor(host, { mermaid: { instance: window.__mermaid } });
      try {
        await h.loadSource(c.source);
        const caps = h.getCapabilities();
        for (const shape of caps?.shapes ?? []) h.addNode(shape);
        if (c.edge) {
          const scene = h.getScene();
          const ids = scene.nodes.map((n) => n.id);
          if (ids.length >= 2) {
            const e = window.__editor.makeEdgeFor(scene, 'ex1', ids[ids.length - 2], ids[ids.length - 1], {
              arrowEnd: caps?.defaults.arrowEnd ?? 'arrow',
            });
            h.loadScene({ ...scene, edges: [...scene.edges, e] });
          }
        }
        const text = h.toMermaid();
        let parseError = null;
        try {
          await window.__mermaid.parse(text);
        } catch (err) {
          parseError = String(err && err.message ? err.message : err).split(/\r?\n/)[0];
        }
        out.push({ type: c.type, shapes: (caps?.shapes ?? []).length, text, parseError });
      } catch (err) {
        out.push({ type: c.type, fatal: String(err && err.message ? err.message : err) });
      } finally {
        h.destroy();
      }
    }
    return out;
  }, CASES);
  results.push(...drawn.map((r) => ({ group: 'draw', ...r })));

  // B. 來回:範本原文 → 場景 → 文字,必須仍可解析且不可變空。
  const templates = readTemplates();
  if (templates.length === 0) throw new Error('src/templates.ts 解析不到任何範本 —— 檢查 readTemplates 的比對式');
  const round = await page.evaluate(async (tpls) => {
    const out = [];
    for (const t of tpls) {
      const host = document.getElementById('app');
      host.innerHTML = '';
      const h = window.__editor.createDiagramEditor(host, { mermaid: { instance: window.__mermaid } });
      try {
        await h.loadSource(t.code);
        const text = h.toMermaid();
        let parseError = null;
        try {
          await window.__mermaid.parse(text);
        } catch (err) {
          parseError = String(err && err.message ? err.message : err).split(/\r?\n/)[0];
        }
        out.push({ type: t.id, text, parseError, empty: text.trim().split(/\r?\n/).length < 2 });
      } catch (err) {
        out.push({ type: t.id, fatal: String(err && err.message ? err.message : err) });
      } finally {
        h.destroy();
      }
    }
    return out;
  }, templates);
  results.push(...round.map((r) => ({ group: 'roundtrip', ...r })));
} finally {
  await browser.close();
  server.close();
  rmSync(WORK, { recursive: true, force: true });
}

// ─── 報告 ───────────────────────────────────────────────────────────────────
const verbose = process.argv.includes('--verbose');
let failed = 0;
for (const r of results) {
  const reason = r.fatal ? `爆例外:${r.fatal}` : r.parseError ? `mermaid 不吃:${r.parseError}` : r.empty ? '輸出被清空' : null;
  if (reason) failed += 1;
  console.log(`[${reason ? 'FAIL' : ' OK '}] ${r.group.padEnd(9)} ${r.type.padEnd(20)}${reason ?? ''}`);
  if (reason && verbose && r.text) console.log(r.text.replace(/^/gm, '        '));
}
console.log(`\n${results.length - failed}/${results.length} 通過`);
process.exit(failed ? 1 : 0);

/**
 * 從 src/templates.ts 抓出每個範本的 id + body。body 是 VS Code snippet(帶 ${1:預設值} 佔位),
 * 要先還原成純 mermaid 才餵得進 parser。
 */
function readTemplates() {
  const src = readFileSync(join(ROOT, 'src', 'templates.ts'), 'utf8');
  const out = [];
  const re = /id:\s*'([^']+)'[\s\S]*?body:\s*`([\s\S]*?)`,\r?\n/g;
  let m;
  while ((m = re.exec(src))) {
    const code = m[2]
      .replace(/\\`/g, '`')
      .replace(/\\\$\{\d+:([^}]*)\}/g, '$1') // ${1:預設值} → 預設值
      .replace(/\\\$\{\d+\|([^|}]*)[^}]*\}/g, '$1') // ${1|a,b|} → a
      .replace(/\\\$\{\d+\}/g, '')
      .replace(/\$0/g, '');
    out.push({ id: m[1], code });
  }
  return out;
}
