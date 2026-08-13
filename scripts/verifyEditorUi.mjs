// 繪製編輯器的「看得到」的驗證:在 headless Chrome 裡用**與 webview 完全相同的**標記 + bundle
// 把編輯器跑起來,對每個圖種截圖,並斷言工具列真的只給出該圖種畫得出來的外形。
//
// 為什麼要一份跟 verifyRoundtrip 不同的腳本:那支驗的是「序列化出來的文字對不對」,這支驗的是
// 「使用者看到的按鈕與畫面對不對」。工具列是照 adapter 能力生成的,所以它會抓到
// 「類別圖上跑出菱形按鈕」這種只在 UI 層才看得見的迴歸。
//
// 用法:  npm run build && node scripts/verifyEditorUi.mjs [--shots]
//   --shots  另外把每個圖種的畫面存成 outputs/editor-ui_<日期>/<type>.png

import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = join(ROOT, '.verify-ui');
const SHOTS = process.argv.includes('--shots');

// 每個圖種:載入原始碼後,工具列**應該**出現哪些外形按鈕(= adapter 能力),以及絕不該出現哪些。
const CASES = [
  {
    type: 'flowchart',
    source: 'flowchart TD\n  A[開始] --> B{判斷}\n  B -->|是| C[處理]\n  B -->|否| D[結束]\n',
    expect: ['rectangle', 'diamond', 'cylinder'],
    forbid: ['classBox', 'entity', 'state'],
  },
  {
    type: 'state',
    source: 'stateDiagram-v2\n  [*] --> 閒置\n  閒置 --> 執行中: 啟動\n  執行中 --> [*]\n',
    expect: ['state', 'stateStart', 'choice', 'fork'],
    forbid: ['cylinder', 'trapezoid', 'classBox'],
  },
  {
    type: 'class',
    source: 'classDiagram\n  class 動物 {\n    +名稱 string\n    +移動()\n  }\n  動物 <|-- 狗\n',
    expect: ['classBox'],
    forbid: ['diamond', 'cylinder', 'stadium'],
  },
  {
    type: 'er',
    source: 'erDiagram\n  客戶 ||--o{ 訂單 : 下單\n  訂單 {\n    int id PK\n  }\n',
    expect: ['entity'],
    forbid: ['diamond', 'cylinder', 'rounded'],
  },
  {
    type: 'mindmap',
    source: 'mindmap\n  root((主題))\n    分支A\n    分支B\n      子項\n',
    expect: ['rounded', 'circle', 'hexagon'],
    forbid: ['cylinder', 'classBox', 'trapezoid'],
  },
  {
    type: 'sequence',
    source: 'sequenceDiagram\n  使用者->>系統: 請求\n  系統-->>使用者: 回應\n',
    expect: [],
    forbid: ['rectangle', 'diamond', 'classBox'],
  },
  {
    type: 'requirement',
    source:
      'requirementDiagram\n' +
      '  requirement login_req {\n    id: 1\n    text: Users must be able to log in.\n    risk: medium\n    verifymethod: test\n  }\n' +
      '  element auth_service {\n    type: service\n  }\n' +
      '  auth_service - satisfies -> login_req\n',
    expect: ['requirementBox', 'elementBox'],
    forbid: ['diamond', 'cylinder', 'classBox'],
  },
  {
    type: 'kanban',
    source:
      'kanban\n  todo[待辦]\n    [設計稿]\n    [寫規格]\n  doing[進行中]\n' +
      '    slice[切版]@{ assigned: \'mark\', priority: \'High\' }\n  done[完成]\n    [需求訪談]\n',
    expect: ['kanbanCard'],
    forbid: ['rectangle', 'diamond', 'classBox'],
  },
  {
    type: 'c4',
    source:
      'C4Context\n  title 系統情境圖\n  Person(customer, "顧客", "使用網站的人")\n' +
      '  System_Boundary(sb, "內部系統") {\n    System(shop, "購物系統", "線上商店")\n  }\n' +
      '  System_Ext(bank, "金流", "外部支付")\n  Rel(customer, shop, "瀏覽與下單", "HTTPS")\n' +
      '  Rel(shop, bank, "請款", "API")\n',
    expect: ['c4Person', 'c4Box', 'c4Db', 'c4Queue'],
    forbid: ['diamond', 'classBox', 'entity'],
  },
  {
    type: 'quadrant',
    source:
      'quadrantChart\n  title 專案評估\n  x-axis 低成本 --> 高成本\n  y-axis 低效益 --> 高效益\n' +
      '  quadrant-1 該做\n  quadrant-2 快贏\n  quadrant-3 別做\n  quadrant-4 再想想\n' +
      '  改版首頁: [0.3, 0.6]\n  導入 AI 客服: [0.75, 0.8]\n  換 logo: [0.2, 0.2]\n',
    expect: ['point'],
    forbid: ['rectangle', 'diamond', 'classBox'],
  },
  {
    type: 'sankey',
    // 刻意用 ASCII:mermaid 11 的 sankey lexer 不接受非 ASCII 名稱(見 round-trip/sankey 的註解)。
    source: 'sankey-beta\n\nGrid,Homes,30\nGrid,Industry,45\nIndustry,Waste heat,20\nIndustry,Product,25\n',
    expect: ['sankeyNode'],
    forbid: ['rectangle', 'diamond', 'classBox'],
  },
  {
    type: 'journey',
    source:
      'journey\n  title 我的一天\n  section 早上\n    起床: 3: 我\n    通勤: 2: 我, 同事\n' +
      '  section 下午\n    寫程式: 5: 我\n    開會: 1: 我, 主管\n',
    expect: ['journeyTask'],
    forbid: ['rectangle', 'diamond', 'classBox'],
  },
  {
    type: 'gantt',
    source:
      'gantt\n  title 專案時程\n  dateFormat YYYY-MM-DD\n  section 設計\n' +
      '    需求訪談 :done, a1, 2026-01-01, 7d\n    介面設計 :active, a2, after a1, 5d\n' +
      '  section 開發\n    後端 :b1, 2026-01-10, 2026-01-25\n    上線 :milestone, m1, 2026-01-26, 0d\n',
    expect: ['ganttBar'],
    forbid: ['rectangle', 'diamond', 'classBox'],
  },
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
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

/** 用同一份 EDITOR_BODY_HTML 組出頁面;acquireVsCodeApi 用假的頂替(webview 才有)。 */
async function buildPage() {
  mkdirSync(WORK, { recursive: true });
  // src/editorPanelHtml.ts 是純字串常數,直接 bundle 成一個回傳字串的模組。
  await build({
    entryPoints: [join(ROOT, 'src', 'editorPanelHtml.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile: join(WORK, 'body.mjs'),
    logLevel: 'warning',
  });
  const { EDITOR_BODY_HTML } = await import(`file:///${join(WORK, 'body.mjs').replace(/\\/g, '/')}`);
  writeFileSync(
    join(WORK, 'index.html'),
    `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<link rel="stylesheet" href="/media/editor.css">
<style>html,body{margin:0;height:100%}</style></head>
<body data-font-uri="/media/Excalifont.woff2">
<script>window.acquireVsCodeApi = () => ({ postMessage: (m) => { (window.__posted ||= []).push(m); } });</script>
${EDITOR_BODY_HTML}
<script src="/dist/diagramEditor.js"></script>
</body></html>`,
  );
}

await buildPage();
const server = await serve();
const { port } = server.address();
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: 'new', args: ['--disable-gpu'] });
const results = [];
let shotDir = null;
if (SHOTS) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  shotDir = join(ROOT, 'outputs', `editor-ui_${stamp}`);
  mkdirSync(shotDir, { recursive: true });
}
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 820, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  for (const c of CASES) {
    await page.goto(`http://127.0.0.1:${port}/.verify-ui/index.html`, { waitUntil: 'load' });
    // webview 是靠 host 的 'load' 訊息啟動的,這裡自己送一份。
    await page.evaluate((source) => {
      window.postMessage({ type: 'load', source, dark: false }, '*');
    }, c.source);
    await page.waitForFunction(
      () => document.querySelectorAll('#app .rsm-editor-svg [data-node-id], #app .rsm-editor-svg path').length > 0,
      { timeout: 20000 },
    );
    // applyTypeUI 在 loadSource 的 finally 才跑,等工具列安定。
    await new Promise((ok) => setTimeout(ok, 700));
    if (process.argv.includes('--dump-scene')) {
      const scene = await page.evaluate(() => {
        const svg = document.querySelector('#app .rsm-editor-svg');
        const boxes = [...(svg?.querySelectorAll('[data-node-id]') ?? [])].map((g) => {
          const b = g.getBBox ? g.getBBox() : { width: 0, height: 0 };
          return { id: g.getAttribute('data-node-id'), w: Math.round(b.width), h: Math.round(b.height) };
        });
        return boxes;
      });
      console.log(`  scene[${c.type}]`, JSON.stringify(scene));
    }
    const ui = await page.evaluate(() => ({
      shapes: [...document.querySelectorAll('#shape-group [data-shape]')]
        .filter((el) => el.offsetParent !== null)
        .map((el) => el.getAttribute('data-shape')),
      more: [...document.querySelectorAll('#shape-select option')].map((o) => o.value).filter(Boolean),
      moreVisible: document.getElementById('shape-select')?.offsetParent !== null,
      dirVisible: document.getElementById('dir-select')?.offsetParent !== null,
      nodes: document.querySelectorAll('#app [data-node-id]').length,
    }));
    const offered = [...ui.shapes, ...(ui.moreVisible ? ui.more : [])];
    const missing = c.expect.filter((s) => !offered.includes(s));
    const leaked = c.forbid.filter((s) => offered.includes(s));
    results.push({ type: c.type, offered, missing, leaked, nodes: ui.nodes, dirVisible: ui.dirVisible });
    if (shotDir) {
      await page.screenshot({ path: join(shotDir, `${c.type}.png`) });
    }
  }
} finally {
  await browser.close();
  server.close();
  rmSync(WORK, { recursive: true, force: true });
}

let failed = 0;
for (const r of results) {
  const problems = [];
  if (r.missing.length) problems.push(`少了外形 ${r.missing.join(',')}`);
  if (r.leaked.length) problems.push(`跑出不該有的外形 ${r.leaked.join(',')}`);
  if (r.nodes === 0) problems.push('畫布上沒有任何節點');
  if (problems.length) failed += 1;
  console.log(
    `[${problems.length ? 'FAIL' : ' OK '}] ${r.type.padEnd(10)} 外形=${r.offered.join(',') || '(無)'} 節點=${r.nodes}` +
      (problems.length ? `  ← ${problems.join(' / ')}` : ''),
  );
}
if (shotDir) console.log(`\n截圖:${shotDir}`);
console.log(`\n${results.length - failed}/${results.length} 通過`);
process.exit(failed ? 1 : 0);
