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
  {
    type: 'journey',
    source: 'journey\n  title 我的一天\n  section 早上\n    起床: 3: 我\n    通勤: 2: 我, 同事\n  section 下午\n    寫程式: 5: 我\n',
    edge: false,
  },
  {
    type: 'gantt',
    source:
      'gantt\n  title 專案\n  dateFormat YYYY-MM-DD\n  section 設計\n' +
      '    需求 :a1, 2026-01-01, 7d\n    UI :after a1, 5d\n  section 開發\n    後端 :b1, 2026-01-10, 2026-01-25\n',
    edge: false,
  },
  { type: 'pie', source: 'pie showData title 語言\n    "TypeScript" : 55\n    "Python" : 30\n', edge: false },
  {
    type: 'xychart',
    source:
      'xychart-beta\n    title "營收"\n    x-axis [一月, 二月, 三月]\n    y-axis "萬元" 0 --> 100\n' +
      '    bar [30, 55, 80]\n    line [30, 55, 80]\n',
    edge: false,
  },
  {
    type: 'architecture',
    source:
      'architecture-beta\n    group api(cloud)[API]\n    service db(database)[資料庫] in api\n' +
      '    service server(server)[伺服器] in api\n    db:L -- R:server\n',
    edge: true,
  },
  {
    type: 'block',
    source: 'block-beta\n  columns 3\n  前端["前端"] 後端["後端"] db[("資料庫")]\n  前端 --> 後端\n',
    edge: false,
  },
  {
    type: 'packet',
    source: 'packet-beta\ntitle TCP 封包\n0-15: "來源埠"\n16-31: "目的埠"\n32-63: "序號"\n',
    edge: false,
  },
  {
    type: 'gitgraph',
    source:
      'gitGraph\n   commit id: "初始"\n   branch feature\n   commit id: "開發"\n' +
      '   checkout main\n   commit id: "修正"\n   merge feature tag: "v1.0"\n',
    edge: false,
  },
];

// ─── 拖曳劇本:把第一個節點往某方向拖,檢查輸出「該變 / 不該變」───────────────────────
// 這些圖種的位置**就是資料**,所以拖完文字必須跟著變;流程圖則相反 —— 位置只是排版,
// 拖動它不可以改動任何一個字(否則就是把版面資訊污染進使用者的原始碼了)。
const DRAG_CASES = [
  {
    type: 'kanban 卡片換欄',
    source: 'kanban\n  todo[待辦]\n    [設計稿]\n  doing[進行中]\n  done[完成]\n',
    dx: 300,
    dy: 0,
    expectChange: true,
    dropHint: true,
  },
  {
    type: 'journey 任務換階段',
    source: 'journey\n  title 我的一天\n  section 早上\n    起床: 3: 我\n  section 下午\n',
    dx: 300,
    dy: 0,
    expectChange: true,
    dropHint: true,
  },
  {
    type: 'quadrant 點改值',
    source:
      'quadrantChart\n  x-axis 低 --> 高\n  y-axis 低 --> 高\n  quadrant-1 一\n  quadrant-2 二\n' +
      '  quadrant-3 三\n  quadrant-4 四\n  A: [0.3, 0.6]\n',
    dx: 120,
    dy: 0,
    expectChange: true,
  },
  {
    type: 'gantt 長條改日期',
    source:
      'gantt\n  title 專案\n  dateFormat YYYY-MM-DD\n  section 設計\n    需求 :a1, 2026-01-01, 7d\n    UI :b1, 2026-01-10, 5d\n',
    dx: 120,
    dy: 0,
    expectChange: true,
  },
  {
    type: 'xychart 點改數值',
    source:
      'xychart-beta\n    title "營收"\n    x-axis [一月, 二月, 三月]\n    y-axis "萬元" 0 --> 100\n    bar [30, 55, 80]\n',
    dx: 0,
    dy: -80,
    expectChange: true,
  },
  {
    // 第一個提交往右拖過後面幾個 → 順序改變 → 指令流跟著重排。
    // 提交要夠多:圖太小時畫布會自動放大到 3 倍以上,320px 的手勢在世界座標裡連一格都跨不過去。
    type: 'gitgraph 提交改順序',
    source:
      'gitGraph\n   commit id: "A"\n   commit id: "B"\n   commit id: "C"\n   commit id: "D"\n' +
      '   commit id: "E"\n   commit id: "F"\n   commit id: "G"\n   commit id: "H"\n',
    dx: 400,
    dy: 0,
    expectChange: true,
    dropHint: true,
  },
  {
    // 往下拖到第二條泳道 = 換分支;輸出要多一個 checkout。
    type: 'gitgraph 提交換分支',
    source:
      'gitGraph\n   commit id: "A"\n   branch feature\n   commit id: "B"\n   commit id: "C"\n' +
      '   commit id: "D"\n   commit id: "E"\n   commit id: "F"\n   commit id: "G"\n',
    dx: 0,
    dy: 120,
    expectChange: true,
    dropHint: true,
  },
  {
    type: 'flowchart 位置不入原始碼',
    source: 'flowchart TD\n  A[開始] --> B[結束]\n',
    dx: 140,
    dy: 90,
    expectChange: false,
  },
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
editor.registerJourneyAdapter();
editor.registerGanttAdapter();
editor.registerPieAdapter();
editor.registerXychartAdapter();
editor.registerArchitectureAdapter();
editor.registerBlockAdapter();
editor.registerPacketAdapter();
editor.registerGitgraphAdapter();
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
  // #app 必須有實際尺寸:編輯器的 fit() 是依容器大小算縮放的,高度 0 會讓節點縮到量不到,
  // 拖曳測試就會拖了個寂寞。
  writeFileSync(
    join(WORK, 'index.html'),
    '<!doctype html><meta charset="utf-8"><style>html,body{margin:0}#app{width:1200px;height:760px}</style>' +
      '<body><div id="app"></div><script src="bundle.js"></script></body>',
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
  await page.setViewport({ width: 1280, height: 860 });
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
        // 型別要真的被認出來:少註冊一個 adapter 會靜靜退回 flowchart,建出來的圖照樣
        // 通得過 mermaid.parse —— 沒有這一行,漏註冊就是一次「全綠的假通過」。
        const got = h.getScene().diagramType;
        out.push({
          type: c.type,
          shapes: (caps?.shapes ?? []).length,
          text,
          parseError,
          typeError: got === c.type ? null : `圖種被判成 ${got}(adapter 沒註冊?)`,
        });
      } catch (err) {
        // 連文字都一起帶回來:例外多半就是序列化出了 mermaid 不吃的東西,看不到文字很難查。
        let text = '';
        try {
          text = h.toMermaid();
        } catch {
          /* ignore */
        }
        out.push({ type: c.type, text, fatal: String(err && err.message ? err.message : err) });
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

  // C. 拖曳:用**真的**滑鼠事件把節點拖到別的地方,再看序列化出來的文字有沒有跟著變。
  //    A / B 兩組只證明「序列化正確」,證明不了「拖得動」—— 而拖得動正是這些圖種的重點。
  for (const c of DRAG_CASES) {
    const rect = await page.evaluate(async (src) => {
      const host = document.getElementById('app');
      host.innerHTML = '';
      // 存到 window:拖曳要跨好幾次 evaluate(量位置 → 移動滑鼠 → 讀結果)。
      window.__h?.destroy?.();
      window.__h = window.__editor.createDiagramEditor(host, { mermaid: { instance: window.__mermaid } });
      await window.__h.loadSource(src);
      return null;
    }, c.source);
    void rect;
    const before = await page.evaluate(() => {
      const el = document.querySelector('#app [data-node-id]');
      if (!el) return null;
      // 量「命中矩形」而不是整個群組:象限圖的點會把標籤畫在圓點下方(pointer-events:none),
      // 群組 bbox 的中心因此落在標籤上,對著那裡按下去等於點到空白處。
      const hit = el.querySelector('rect') ?? el;
      const b = hit.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, text: window.__h.toMermaid() };
    });
    if (!before) {
      results.push({ group: 'drag', type: c.type, fatal: '找不到可拖曳的節點' });
      continue;
    }
    await page.mouse.move(before.x, before.y);
    await page.mouse.down();
    // 分段移動:一步到位的話有些狀態機看不到 move 事件。
    for (let i = 1; i <= 6; i += 1) {
      await page.mouse.move(before.x + (c.dx * i) / 6, before.y + (c.dy * i) / 6);
    }
    // 手還按著的這一刻:位置即資料的圖種要看得到「放開會落在這一格」的提示。
    const dropHint = await page.evaluate(() => document.querySelectorAll('.rsm-drop-target').length);
    await page.mouse.up();
    const hintLeft = await page.evaluate(() => document.querySelectorAll('.rsm-drop-target').length);
    const after = await page.evaluate(() => ({
      text: window.__h.toMermaid(),
      sel: window.__h.getSelection(),
      nodes: window.__h.getScene().nodes.map((n) => `${n.id}@${Math.round(n.x)},${Math.round(n.y)}`),
    }));
    const changed = after.text !== before.text;
    const hintProblem =
      c.dropHint && dropHint === 0
        ? '拖曳中沒有顯示落點提示'
        : hintLeft > 0
          ? '放開後落點提示沒有收掉'
          : undefined;
    results.push({
      group: 'drag',
      type: c.type,
      text: `${after.text}\n  [選取 ${JSON.stringify(after.sel)} / 節點 ${after.nodes.join(' ')}]`,
      fatal:
        changed === c.expectChange
          ? hintProblem
          : c.expectChange
            ? '拖曳後輸出沒有變化'
            : '拖曳不該改變輸出但改了',
    });
  }
} finally {
  await browser.close();
  server.close();
  rmSync(WORK, { recursive: true, force: true });
}

// ─── 報告 ───────────────────────────────────────────────────────────────────
const verbose = process.argv.includes('--verbose');
let failed = 0;
for (const r of results) {
  const reason = r.fatal
    ? `爆例外:${r.fatal}`
    : r.typeError
      ? r.typeError
      : r.parseError
        ? `mermaid 不吃:${r.parseError}`
        : r.empty
          ? '輸出被清空'
          : null;
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
