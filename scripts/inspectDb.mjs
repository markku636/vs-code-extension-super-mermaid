// 印出 mermaid 解析某段圖表後的 DB 內容(getXxx() 全打一遍)。
//
// 新增圖種 adapter 的第一步永遠是「mermaid 到底把這張圖存成什麼形狀」。這件事只能在瀏覽器裡問:
// mermaid 的 jison parser 在 node 裡跑得動,但 DB 要透過 mermaidAPI.getDiagramFromText 才會被填,
// 而那條路徑需要 DOM(DOMPurify / 量文字)。所以這支腳本把問題丟進 headless Chrome。
//
// 用法:
//   node scripts/inspectDb.mjs requirement      # 用內建範例
//   node scripts/inspectDb.mjs --file foo.mmd   # 用自己的檔

import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = join(ROOT, '.verify-db');

const SAMPLES = {
  requirement:
    'requirementDiagram\n' +
    '  requirement login_req {\n    id: 1\n    text: Users must be able to log in.\n    risk: medium\n    verifymethod: test\n  }\n' +
    '  functionalRequirement pw_req {\n    id: 1.1\n    text: Password rules apply.\n    risk: low\n    verifymethod: inspection\n  }\n' +
    '  element auth_service {\n    type: service\n    docref: docs/auth.md\n  }\n' +
    '  login_req - contains -> pw_req\n' +
    '  auth_service - satisfies -> login_req\n',
  c4:
    'C4Context\n  title 系統情境圖\n' +
    '  Person(customer, "顧客", "使用網站的人")\n' +
    '  System(shop, "購物系統", "線上商店")\n' +
    '  System_Ext(bank, "金流", "外部支付")\n' +
    '  Rel(customer, shop, "瀏覽與下單", "HTTPS")\n' +
    '  Rel(shop, bank, "請款", "API")\n',
  block:
    'block-beta\n  columns 3\n  前端["前端"] 空間:1 後端["後端"]\n  快取[("快取")] space 資料庫[("資料庫")]\n',
  architecture:
    'architecture-beta\n  group api(cloud)[API]\n  service db(database)[資料庫] in api\n  service server(server)[伺服器] in api\n  db:L -- R:server\n',
  journey:
    'journey\n  title 我的一天\n  section 早上\n    起床: 3: 我\n    通勤: 2: 我, 同事\n  section 下午\n    寫程式: 5: 我\n',
  gantt:
    'gantt\n  title 專案\n  dateFormat YYYY-MM-DD\n  section 設計\n    需求 :a1, 2026-01-01, 7d\n    UI   :after a1, 5d\n',
  pie: 'pie title 語言\n  "TypeScript" : 55\n  "Python" : 30\n  "Rust" : 15\n',
  quadrant:
    'quadrantChart\n  title 專案評估\n  x-axis 低成本 --> 高成本\n  y-axis 低效益 --> 高效益\n  quadrant-1 該做\n  quadrant-2 快贏\n  quadrant-3 別做\n  quadrant-4 再想想\n  A: [0.3, 0.6]\n  B: [0.45, 0.23]\n',
  gitgraph:
    'gitGraph\n  commit id: "init"\n  branch feature\n  checkout feature\n  commit id: "work"\n  checkout main\n  merge feature tag: "v1.0"\n',
  kanban: 'kanban\n  待辦\n    [設計稿]\n  進行中\n    [切版]\n  完成\n    [需求訪談]\n',
  sankey: 'sankey-beta\n\n電力,住宅,30\n電力,工業,45\n',
  xychart:
    'xychart-beta\n  title "營收"\n  x-axis [一月, 二月, 三月]\n  y-axis "萬元" 0 --> 100\n  bar [30, 55, 80]\n  line [30, 55, 80]\n',
};

const args = process.argv.slice(2);
const fileIdx = args.indexOf('--file');
const key = args.find((a, i) => !a.startsWith('--') && !(fileIdx >= 0 && i === fileIdx + 1));
const source = fileIdx >= 0 ? readFileSync(args[fileIdx + 1], 'utf8') : SAMPLES[key];
if (!source) {
  console.error(`用法:node scripts/inspectDb.mjs <${Object.keys(SAMPLES).join('|')}> | --file <path>`);
  process.exit(2);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
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
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  const f = c.find((p) => existsSync(p));
  if (!f) throw new Error('找不到 Chrome/Edge —— 請設定 CHROME_PATH。');
  return f;
}

mkdirSync(WORK, { recursive: true });
writeFileSync(
  join(WORK, 'entry.mjs'),
  `import mermaid from 'mermaid';
mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
window.__mermaid = mermaid;
window.__ready = true;`,
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
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/.verify-db/index.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 30000 });
  const out = await page.evaluate(async (src) => {
    const api = window.__mermaid.mermaidAPI ?? window.__mermaid;
    const d = await api.getDiagramFromText(src);
    const db = d.db ?? d;
    // Map / Set 轉成可序列化的形狀,深度有限以免噴出整份 config。
    const plain = (v, depth = 0) => {
      if (depth > 4) return '…';
      if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [k, plain(x, depth + 1)]));
      if (v instanceof Set) return [...v].map((x) => plain(x, depth + 1));
      if (Array.isArray(v)) return v.map((x) => plain(x, depth + 1));
      if (v && typeof v === 'object') {
        const o = {};
        for (const k of Object.keys(v)) o[k] = plain(v[k], depth + 1);
        return o;
      }
      return v;
    };
    const res = {};
    const names = new Set([...Object.keys(db), ...Object.getOwnPropertyNames(Object.getPrototypeOf(db) ?? {})]);
    for (const name of names) {
      if (!/^get/.test(name) || name === 'getConfig' || /AccTitle|AccDescription/.test(name)) continue;
      try {
        const v = db[name]();
        res[name] = plain(v);
      } catch (err) {
        res[name] = `ERR ${err.message}`;
      }
    }
    // 回傳字串而非物件:有些 DB 的值帶著不可序列化的東西(函式 / DOM / 循環參照),
    // 直接回物件會讓 puppeteer 靜默地把整包變成 undefined。
    try {
      return JSON.stringify(res);
    } catch (err) {
      return JSON.stringify({ __error: String(err) });
    }
  }, source);
  const parsed = JSON.parse(out ?? '{}');
  const empty = [];
  for (const [k, v] of Object.entries(parsed)) {
    const s = JSON.stringify(v);
    if (s === '{}' || s === '[]' || s === 'null' || s === undefined) {
      empty.push(k);
      continue;
    }
    console.log(`── ${k} ──\n${JSON.stringify(v, null, 1).slice(0, 4000)}`);
  }
  // 空的也列出來:知道「這個 getter 存在但這張圖沒東西」跟「根本沒有這個 getter」是兩回事。
  if (empty.length) console.log(`\n(空:${empty.join(', ')})`);
  if (!Object.keys(parsed).length) console.log('(這個 DB 沒有任何 getXxx() 可讀)');
} finally {
  await browser.close();
  server.close();
  rmSync(WORK, { recursive: true, force: true });
}
