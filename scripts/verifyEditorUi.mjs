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
/** --dark:以深色主題跑一輪。webview 會跟著 VS Code 主題走,深色壞掉等於一半使用者看到壞的。 */
const DARK = process.argv.includes('--dark');

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
  {
    type: 'pie',
    source: 'pie showData title 語言使用比例\n    "TypeScript" : 55\n    "Python" : 30\n    "Rust" : 15\n',
    expect: ['pieSlice'],
    forbid: ['rectangle', 'diamond', 'classBox'],
  },
  {
    type: 'xychart',
    source:
      'xychart-beta\n    title "季度營收"\n    x-axis [Q1, Q2, Q3, Q4]\n    y-axis "萬元" 0 --> 100\n' +
      '    bar [30, 55, 80, 62]\n    line [30, 55, 80, 62]\n',
    expect: ['xyPoint'],
    forbid: ['rectangle', 'diamond', 'classBox'],
  },
  {
    type: 'architecture',
    source:
      'architecture-beta\n    group api(cloud)[API 區]\n    service db(database)[資料庫] in api\n' +
      '    service server(server)[伺服器] in api\n    service disk(disk)[儲存] in api\n' +
      '    db:L -- R:server\n    disk:T -- B:server\n',
    expect: ['archNode'],
    forbid: ['diamond', 'classBox', 'entity'],
  },
  {
    type: 'block',
    source:
      'block-beta\n  columns 3\n  前端["前端"] 後端["後端"] db[("資料庫")]\n' +
      '  快取(("快取")):2 佇列{"佇列"}\n  前端 --> 後端\n',
    expect: ['rectangle', 'circle', 'diamond'],
    forbid: ['classBox', 'entity', 'state'],
  },
  {
    type: 'packet',
    source: 'packet-beta\ntitle TCP 封包\n0-15: "來源埠"\n16-31: "目的埠"\n32-63: "序號"\n64-95: "確認號"\n',
    expect: ['packetField'],
    forbid: ['rectangle', 'diamond', 'classBox'],
  },
  {
    type: 'gitgraph',
    source:
      'gitGraph\n   commit id: "初始"\n   branch feature\n   commit id: "開發"\n' +
      '   checkout main\n   commit id: "修正"\n   merge feature tag: "v1.0"\n',
    expect: ['gitCommit'],
    forbid: ['rectangle', 'diamond', 'classBox'],
  },
];

/**
 * 拖曳手勢的驗證。
 *
 * 上面那組驗的是「工具列給的按鈕對不對」,這組驗的是「拖得動嗎、而且拖的時候看得見嗎」——
 * 兩件會各自壞掉的事。0.25.1 修的正是後者:renderer 把 Overlay 的圖層一起清掉,
 * 於是拖曳照常生效、原始碼照常改變,但選取框與插入指示線全畫進脫離 DOM 的節點,
 * 使用者看到的是一張凍住的圖。只斷言「原始碼有變」的測試會全綠地放它過去。
 *
 * 所以每個案例兩個條件都要成立:放手後**狀態真的變了**(手勢接上了),且拖曳中 overlay 真的有東西
 * (回饋看得見)。pick 與 probe 都在頁面裡跑,必須自給自足、不能引用外部變數。
 * probe 拿什麼當「狀態」依圖種而定:序列圖改的是順序,看得到原始碼變;
 * 流程圖的節點座標不進 mermaid 文字,只能看節點在畫面上有沒有真的移動。
 */
const DRAG_CASES = [
  {
    name: 'sequence 訊息換序',
    source:
      'sequenceDiagram\n  participant U as 使用者\n  participant F as 前端\n  participant A as API\n' +
      '  U->>F: 點擊登入\n  F->>A: POST /login\n  A->>F: 回傳結果\n',
    pick: () => {
      const msgs = [...document.querySelectorAll('#app [data-seq-msg]')];
      if (msgs.length < 3) return null;
      const last = msgs[msgs.length - 1].getBoundingClientRect();
      const first = msgs[0].getBoundingClientRect();
      return {
        from: { x: last.x + last.width / 2, y: last.y + last.height / 2 },
        to: { x: last.x + last.width / 2, y: first.y - 6 },
      };
    },
    probe: () => {
      const p = window.__posted ?? [];
      for (let i = p.length - 1; i >= 0; i -= 1) if (p[i]?.type === 'mermaidchange') return p[i].text;
      return null;
    },
  },
  {
    name: 'sequence 生命線換序',
    source:
      'sequenceDiagram\n  participant U as 使用者\n  participant F as 前端\n  participant A as API\n' +
      '  U->>F: 點擊登入\n  F->>A: POST /login\n',
    pick: () => {
      const boxes = [...document.querySelectorAll('#app [data-node-id]')].map((g) => g.getBoundingClientRect());
      const msg = document.querySelector('#app [data-seq-msg]')?.getBoundingClientRect();
      if (boxes.length < 4 || !msg) return null;
      // 上排參與者框(y 最小的那排);生命線的可抓處 = 框正下方、第一則訊息上方那道空檔。
      const top = Math.min(...boxes.map((b) => b.y));
      const row = boxes.filter((b) => Math.abs(b.y - top) < 4).sort((a, b) => a.x - b.x);
      const y = (row[0].bottom + msg.y) / 2;
      return {
        from: { x: row[0].x + row[0].width / 2, y },
        to: { x: row[row.length - 1].x + row[row.length - 1].width / 2 + 8, y },
      };
    },
    probe: () => {
      const p = window.__posted ?? [];
      for (let i = p.length - 1; i >= 0; i -= 1) if (p[i]?.type === 'mermaidchange') return p[i].text;
      return null;
    },
  },
  {
    // 這個案例存在的唯一理由:overlay 圖層被清掉時,傷害會跨圖種延續。
    // 序列圖的渲染路徑清過一次、切走時的還原路徑又清一次,所以「先開序列圖再換流程圖」
    // 才是完整的重現步驟 —— 只測乾淨頁面載入流程圖,那個 bug 會整個測綠。
    name: 'flowchart 節點位移（先開過序列圖）',
    preload: 'sequenceDiagram\n  participant U as 使用者\n  participant F as 前端\n  U->>F: 點擊登入\n',
    source: 'flowchart TD\n  A[開始] --> B{判斷}\n  B --> C[結束]\n',
    pick: () => {
      const n = document.querySelector('#app [data-node-id]');
      if (!n) return null;
      const r = n.getBoundingClientRect();
      // 從節點正中央起拖:邊緣附近是連線錨點的地盤,按下去會變成拉線而不是位移。
      return {
        from: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
        to: { x: r.x + r.width / 2 + 90, y: r.y + r.height / 2 + 70 },
      };
    },
    probe: () => {
      const n = document.querySelector('#app [data-node-id]');
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return `${Math.round(r.x)},${Math.round(r.y)}`;
    },
  },
];

/** 拖曳中 overlay 畫了幾個元素(選取框 / 插入線 / 吸附線 / 橡皮筋加總)。-1 = 連容器都不見了。 */
function overlayBusy() {
  const ov = document.querySelector('#app .rsm-overlay');
  if (!ov) return -1;
  return [...ov.children].reduce((n, layer) => n + layer.children.length, 0);
}

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

/**
 * 節點內文字的對比檢查(在頁面裡跑,必須自給自足、不能引用外部變數)。
 *
 * 為什麼要有這條:節點的底色來自一組**固定的淺色盤**,不跟主題翻面。所以寫在節點上的字
 * 一旦用了「主題墨色」,深色模式就會變成淺字寫在淺底上 —— 字整個消失。這個錯誤在 0.19.1
 * 修過一次(C4 / 需求 / 圓餅),0.23.3 又因為甘特長條新增的字重演一次。兩次都是靠人眼看
 * 截圖才發現的,所以改成量出來:凡是**畫在節點框內**的文字,與該節點底色的對比低於門檻就報錯。
 *
 * 門檻取 2.0:足以抓到「淺灰寫在淺粉彩上」(約 1.2)與「白寫在白上」(1.0),
 * 又不會誤殺刻意壓低透明度的次要說明文字(深墨 0.65 透明度仍有 5 以上)。
 */
function checkNodeTextContrast() {
  const rgb = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return null;
    const p = m[1].split(',').map((v) => parseFloat(v));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const over = (fg, bg, alpha) => ({
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
  });
  const ratio = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const inside = (a, b) =>
    a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;

  const out = [];
  for (const g of document.querySelectorAll('#app [data-node-id]')) {
    // 節點自己畫出來的底:取第一個有實色填充、且大小接近整個節點的圖形。
    const box = g.getBoundingClientRect();
    let fill = null;
    let fillRect = null;
    for (const el of g.querySelectorAll('rect,circle,ellipse,path,polygon')) {
      const f = getComputedStyle(el).fill;
      const c = rgb(f);
      if (!c || c.a === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < box.width * 0.5 || r.height < box.height * 0.5) continue;
      fill = c;
      fillRect = r;
      break;
    }
    if (!fill || !fillRect) continue;
    for (const t of g.querySelectorAll('text,foreignObject div')) {
      const txt = (t.textContent || '').trim();
      if (!txt || t.children.length > 0) continue;
      const r = t.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // 只檢查真的疊在節點底色上的字;掛在節點外面的(甘特外掛標籤、架構圖服務名、
      // git 提交 id)背後是畫布,不適用這條規則。
      if (!inside(r, fillRect)) continue;
      const cs = getComputedStyle(t);
      const fg = rgb(cs.color);
      if (!fg) continue;
      const alpha = fg.a * parseFloat(cs.opacity || '1');
      const eff = over(fg, fill, alpha);
      const cr = ratio(eff, fill);
      if (cr < 2.0) {
        out.push({ id: g.getAttribute('data-node-id'), text: txt.slice(0, 12), ratio: Math.round(cr * 100) / 100 });
      }
    }
  }
  return out;
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
<style>html,body{margin:0;height:100%}${DARK ? "body{background:#1e1e1e}" : ""}</style></head>
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
const dragResults = [];
let shotDir = null;
if (SHOTS) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  shotDir = join(ROOT, 'outputs', `editor-ui${DARK ? '-dark' : ''}_${stamp}`);
  mkdirSync(shotDir, { recursive: true });
}
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 820, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  for (const c of CASES) {
    await page.goto(`http://127.0.0.1:${port}/.verify-ui/index.html`, { waitUntil: 'load' });
    // webview 是靠 host 的 'load' 訊息啟動的,這裡自己送一份。
    await page.evaluate(
      ({ source, dark }) => {
        window.postMessage({ type: 'load', source, dark }, '*');
      },
      { source: c.source, dark: DARK },
    );
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
    const faint = await page.evaluate(checkNodeTextContrast);
    results.push({
      type: c.type,
      offered,
      missing,
      leaked,
      nodes: ui.nodes,
      dirVisible: ui.dirVisible,
      faint,
    });
    if (shotDir) {
      await page.screenshot({ path: join(shotDir, `${c.type}.png`) });
    }
  }

  // ── 拖曳手勢 ── 用真實滑鼠輸入(page.mouse),不是合成事件:合成事件繞過命中測試,
  // 會漏掉「這裡其實蓋了別的東西」「這條線是 pointer-events:none」這類真正會擋住使用者的問題。
  for (const d of DRAG_CASES) {
    await page.goto(`http://127.0.0.1:${port}/.verify-ui/index.html`, { waitUntil: 'load' });
    for (const source of [d.preload, d.source].filter(Boolean)) {
      await page.evaluate(
        ({ src, dark }) => window.postMessage({ type: 'load', source: src, dark }, '*'),
        { src: source, dark: DARK },
      );
      await page.waitForFunction(
        () => document.querySelectorAll('#app .rsm-editor-svg [data-node-id], #app .rsm-editor-svg path').length > 0,
        { timeout: 20000 },
      );
      await new Promise((ok) => setTimeout(ok, 700));
    }

    const pts = await page.evaluate(d.pick);
    if (!pts) {
      dragResults.push({ name: d.name, problems: ['找不到可拖曳的目標'] });
      continue;
    }
    const before = await page.evaluate(d.probe);
    await page.mouse.move(pts.from.x, pts.from.y);
    await page.mouse.down();
    const STEPS = 8;
    let busy = 0;
    for (let i = 1; i <= STEPS; i += 1) {
      await page.mouse.move(
        pts.from.x + ((pts.to.x - pts.from.x) * i) / STEPS,
        pts.from.y + ((pts.to.y - pts.from.y) * i) / STEPS,
      );
      // 過了位移門檻之後才取樣:第一兩步還在「這可能只是點一下」的容差內,本來就不該畫東西。
      if (i >= 3) busy = Math.max(busy, await page.evaluate(overlayBusy));
    }
    await page.mouse.up();
    await new Promise((ok) => setTimeout(ok, 400));
    const after = await page.evaluate(d.probe);

    const problems = [];
    if (before === after) problems.push('放手後狀態沒變(手勢沒接上)');
    if (busy === -1) problems.push('overlay 容器不見了');
    else if (busy === 0) problems.push('拖曳中沒有任何視覺回饋');
    dragResults.push({ name: d.name, busy, problems });
  }

  // ── 點選 + Delete ── 「點下去要有被選到的感覺」跟「Delete 要刪得掉」是同一件事的兩半:
  // 選取集合裡沒有它,選取框畫不出來,Delete 也不知道要刪誰。所以一起驗。
  {
    const source =
      'sequenceDiagram\n  participant U as 使用者\n  participant F as 前端\n' +
      '  U->>F: 第一則\n  F->>U: 第二則\n  U->>F: 第三則\n';
    await page.goto(`http://127.0.0.1:${port}/.verify-ui/index.html`, { waitUntil: 'load' });
    await page.evaluate(({ src, dark }) => window.postMessage({ type: 'load', source: src, dark }, '*'), {
      src: source,
      dark: DARK,
    });
    await page.waitForFunction(() => document.querySelectorAll('#app [data-seq-msg]').length > 0, { timeout: 20000 });
    await new Promise((ok) => setTimeout(ok, 700));

    const at = await page.evaluate(() => {
      const els = [...document.querySelectorAll('#app [data-seq-msg]')];
      const r = els[1].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, count: els.length };
    });
    await page.mouse.click(at.x, at.y);
    await new Promise((ok) => setTimeout(ok, 300));
    const selBoxes = await page.evaluate(() => document.querySelector('#app .rsm-ov-sel')?.children.length ?? -1);
    await page.keyboard.press('Delete');
    await new Promise((ok) => setTimeout(ok, 400));
    const left = await page.evaluate(() => document.querySelectorAll('#app [data-seq-msg]').length);

    const problems = [];
    if (selBoxes <= 0) problems.push('點到訊息後沒有選取框(感覺不到被選取)');
    if (left !== at.count - 1) problems.push(`Delete 沒刪掉(${at.count} → ${left})`);
    dragResults.push({ name: 'sequence 點選 + Delete', busy: selBoxes, problems });
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
  if (r.faint?.length) {
    problems.push(
      `節點上的字看不見(對比 ${r.faint.map((f) => `${f.text}=${f.ratio}`).join(' ')})`,
    );
  }
  if (problems.length) failed += 1;
  console.log(
    `[${problems.length ? 'FAIL' : ' OK '}] ${r.type.padEnd(10)} 外形=${r.offered.join(',') || '(無)'} 節點=${r.nodes}` +
      (problems.length ? `  ← ${problems.join(' / ')}` : ''),
  );
}
for (const r of dragResults) {
  if (r.problems.length) failed += 1;
  console.log(
    `[${r.problems.length ? 'FAIL' : ' OK '}] ${r.name.padEnd(18)} overlay=${r.busy ?? '-'}` +
      (r.problems.length ? `  ← ${r.problems.join(' / ')}` : ''),
  );
}
if (shotDir) console.log(`\n截圖:${shotDir}`);
const total = results.length + dragResults.length;
console.log(`\n${total - failed}/${total} 通過`);
process.exit(failed ? 1 : 0);
