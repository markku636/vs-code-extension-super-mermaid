// 整份 Markdown 文件預覽的 webview 端。host 用 markdown-it 渲染 HTML(已含 highlight.js 上色與
// data-line 行號)後送進來,本檔負責:
//  1. 把 ```mermaid 區塊渲染成自動上色的 SVG(離屏渲染 + 依 source 快取 → 打字不閃爍)
//  2. Editor↔Preview 雙向捲動同步、雙擊預覽跳回原始碼
//  3. 文件大綱(TOC)側欄 + scrollspy
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import mermaid from 'mermaid';
import { boostLegibility, colorizeDiagram, ensureLegibilityStyles } from './colorize';

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

const toolbar = document.getElementById('md-toolbar')!;
const layout = document.getElementById('md-layout')!;
const content = document.getElementById('md-content')!;
const tocAside = document.getElementById('md-toc')!;
const filenameEl = document.getElementById('md-filename')!;
const tocToggle = document.getElementById('md-toc-toggle') as HTMLButtonElement;
const wideBtn = document.getElementById('md-wide') as HTMLButtonElement;
const lockBtn = document.getElementById('md-lock') as HTMLButtonElement;
const refreshBtn = document.getElementById('md-refresh') as HTMLButtonElement;
const exitBtn = document.getElementById('md-exit') as HTMLButtonElement;
const zoomLevelEl = document.getElementById('md-zoom-level')!;
const zoomInBtn = document.getElementById('md-zoom-in') as HTMLButtonElement;
const zoomOutBtn = document.getElementById('md-zoom-out') as HTMLButtonElement;
const ctxMenu = document.getElementById('md-context-menu')!;
const ctxGoto = document.getElementById('md-ctx-goto') as HTMLButtonElement;
const ctxCopy = document.getElementById('md-ctx-copy') as HTMLButtonElement;
const themeSelect = document.getElementById('md-theme') as HTMLSelectElement;
const exportBtn = document.getElementById('md-export') as HTMLButtonElement;
const exportMenu = document.getElementById('md-export-menu')!;
const exportOverlay = document.getElementById('md-export-overlay')!;

let seq = 0;
let rendering = false;
let pendingHtml: string | undefined;
let lastHtml = '';
let lastDark = false; // 在 applyTheme 首次套用時設定;追蹤 VSCode 明暗變化用。
let locked = false;
let tocOpen = false;
let booting = true; // 初始化期間不回寫偏好(見 persistState)。
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.1;

/**
 * 內建預覽主題:配色衍生自 Dracula PRO 各 flavor(已改名,避免商標)。
 * 暗色 flavor 共用同一組強調色(粉 / 黃 / 紫 / 綠 / 青);只有底色與註解色不同。daylight 為亮色版。
 */
interface PreviewTheme {
  label: string;
  dark: boolean;
  bg: string;
  fg: string;
  muted: string;
  accent: string;
}
const THEMES: Record<string, PreviewTheme> = {
  velvet: { label: 'Velvet', dark: true, bg: '#22212C', fg: '#F8F8F2', muted: '#7970A9', accent: '#9580FF' },
  jade: { label: 'Jade', dark: true, bg: '#212C2A', fg: '#F8F8F2', muted: '#70A99F', accent: '#80FFEA' },
  orchid: { label: 'Orchid', dark: true, bg: '#2A212C', fg: '#F8F8F2', muted: '#9F70A9', accent: '#FF80BF' },
  amber: { label: 'Amber', dark: true, bg: '#2C2A21', fg: '#F8F8F2', muted: '#A99F70', accent: '#FFCA80' },
  ember: { label: 'Ember', dark: true, bg: '#2C2122', fg: '#F8F8F2', muted: '#A97079', accent: '#FF9580' },
  abyss: { label: 'Abyss', dark: true, bg: '#0B0D0F', fg: '#F8F8F2', muted: '#708CA9', accent: '#9580FF' },
  daylight: { label: 'Daylight', dark: false, bg: '#F5F5F5', fg: '#1F1F1F', muted: '#635D97', accent: '#644AC9' },
};
const HL_DARK = { keyword: '#FF80BF', string: '#FFFF80', number: '#9580FF', title: '#8AFF80', type: '#80FFEA' };
const HL_LIGHT = { keyword: '#A3144D', string: '#846E15', number: '#644AC9', title: '#14710A', type: '#036A96' };

// 初始偏好優先用 host 由 globalState 帶進來的 data-initial-*(跨開關 / 重啟記住);
// 退而求其次用 webview 自己的 state;再不然用預設(淺色 Light)。
const ds = document.body.dataset;
// 優先序:webview 自己的 state(本 panel 最新)→ host 由 globalState 帶進的 data-initial(跨 panel/重啟)→ 預設。
const savedState = vscode.getState() as
  | { zoom?: number; theme?: string; wide?: boolean }
  | undefined;
const initialZoom = parseFloat(ds.initialZoom ?? '');
let zoom =
  typeof savedState?.zoom === 'number'
    ? savedState.zoom
    : Number.isFinite(initialZoom)
      ? initialZoom
      : 1;
const wantTheme = savedState?.theme || ds.initialTheme || 'velvet';
/** 'editor' = 跟隨 VSCode 主題;其餘為 THEMES 的 key。預設 Dark Purple(velvet)。 */
let currentTheme: string =
  wantTheme === 'editor' || wantTheme in THEMES ? wantTheme : 'velvet';
/** 全寬模式:撐滿預覽寬度(寬表格不被裁切)。 */
let wide = typeof savedState?.wide === 'boolean' ? savedState.wide : ds.initialWide === '1';

/** 已渲染的 mermaid SVG 快取(source → 上色後的 innerHTML),source 沒變就直接重用,打字不閃。 */
const mermaidCache = new Map<string, string>();
/** data-line 行號 → 元素,依行號排序,供捲動同步定位。 */
let lineEls: { line: number; el: HTMLElement }[] = [];
let tocHeadings: { id: string; el: HTMLElement }[] = [];
/** 此刻之前的捲動事件是程式觸發的(同步來的),不要回報給 host,避免回授迴圈。 */
let programmaticScrollUntil = 0;
let lastPostedLine = -1;
let scrollRaf = 0;

function isDarkTheme(): boolean {
  const cls = document.body.className;
  if (cls.includes('vscode-high-contrast-light')) {
    return false;
  }
  return cls.includes('vscode-dark') || cls.includes('vscode-high-contrast');
}

/** 目前生效的明暗:選了內建預覽主題時用該主題的明暗,否則跟隨 VSCode。mermaid 上色依此決定。 */
function effectiveDark(): boolean {
  if (currentTheme !== 'editor') {
    return THEMES[currentTheme].dark;
  }
  return isDarkTheme();
}

function initMermaid(): void {
  ensureLegibilityStyles();
  mermaid.initialize({
    startOnLoad: false,
    theme: effectiveDark() ? 'dark' : 'default',
    fontFamily:
      getComputedStyle(document.body).getPropertyValue('--vscode-font-family').trim() ||
      'sans-serif',
    flowchart: { nodeSpacing: 60, rankSpacing: 65, padding: 12 },
    sequence: { actorMargin: 70, boxMargin: 12 },
  });
}

function makeBlock(svgHtml: string, dataLine: string | null): HTMLElement {
  const container = document.createElement('div');
  container.className = 'mermaid-preview-block';
  container.innerHTML = svgHtml;
  if (dataLine != null) {
    container.setAttribute('data-line', dataLine);
  }
  return container;
}

/** 在指定容器(可離屏)內把 mermaid 區塊渲染成 SVG;source 命中快取就秒換,沒命中才 async 渲染。 */
async function renderMermaidInto(root: ParentNode): Promise<void> {
  initMermaid();
  const codes = Array.from(
    root.querySelectorAll<HTMLElement>('pre > code.language-mermaid, pre > code.language-mmd'),
  );
  for (const code of codes) {
    const pre = code.parentElement;
    const source = (code.textContent ?? '').trim();
    if (!pre || !source) {
      continue;
    }
    const dataLine = pre.getAttribute('data-line');
    const cached = mermaidCache.get(source);
    if (cached) {
      pre.replaceWith(makeBlock(cached, dataLine));
      continue;
    }
    const id = `md-doc-mmd-${++seq}`;
    try {
      const { svg } = await mermaid.render(id, source);
      const container = makeBlock(svg, dataLine);
      const svgEl = container.querySelector('svg');
      if (svgEl) {
        colorizeDiagram(svgEl, { dark: effectiveDark() });
        boostLegibility(svgEl);
      }
      mermaidCache.set(source, container.innerHTML);
      pre.replaceWith(container);
    } catch {
      // 不完整 / 語法錯誤的圖:清掉 mermaid 暫存節點,保留原始碼區塊。
      document.getElementById('d' + id)?.remove();
    }
  }
}

/**
 * 套用新 HTML:先在離屏容器把內容與 mermaid 都備好(未變的圖從快取秒出),再一次換進畫面 ——
 * 中途畫面不會出現「圖消失又冒出來」的閃爍。換完保留原本閱讀位置。
 */
async function applyHtml(html: string): Promise<void> {
  if (rendering) {
    pendingHtml = html; // 渲染中再進來的更新先存,結束後補做最新一份。
    return;
  }
  rendering = true;
  lastHtml = html;
  const anchorLine = getTopVisibleLine();
  const prevHeight = layout.scrollHeight;
  const prevTop = layout.scrollTop;
  try {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    await renderMermaidInto(temp);
    content.replaceChildren(...Array.from(temp.childNodes));
    rebuildLineIndex();
    buildToc();
    // 還原閱讀位置:優先用「換之前頂端那一行」對齊,否則退回等比例。
    if (anchorLine != null) {
      scrollToLine(anchorLine, false);
    } else if (prevHeight > 0) {
      layout.scrollTop = (prevTop / prevHeight) * layout.scrollHeight;
    }
  } finally {
    rendering = false;
    if (pendingHtml !== undefined) {
      const next = pendingHtml;
      pendingHtml = undefined;
      void applyHtml(next);
    }
  }
}

// ── 捲動同步 ───────────────────────────────────────────────────────────
function rebuildLineIndex(): void {
  lineEls = Array.from(content.querySelectorAll<HTMLElement>('[data-line]'))
    .map((el) => ({ line: parseInt(el.getAttribute('data-line') ?? '', 10), el }))
    .filter((x) => !Number.isNaN(x.line))
    .sort((a, b) => a.line - b.line);
}

/** 二分找出 data-line <= 目標行的最後一個元素索引。 */
function indexForLine(line: number): number {
  let lo = 0;
  let hi = lineEls.length - 1;
  let idx = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineEls[mid].line <= line) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx;
}

/** 目前畫面頂端對應的來源行(供回報 host / 換頁時定位)。 */
function getTopVisibleLine(): number | null {
  const top = layout.getBoundingClientRect().top;
  let best: number | null = null;
  for (const { line, el } of lineEls) {
    if (el.getBoundingClientRect().top - top <= 1) {
      best = line;
    } else {
      break;
    }
  }
  return best;
}

/** 把某來源行捲到畫面頂端(編輯器同步 / 換頁定位)。會在相鄰兩元素間內插以更精準。 */
function scrollToLine(line: number, smooth: boolean): void {
  if (!lineEls.length) {
    return;
  }
  const i = indexForLine(line);
  const cur = lineEls[i];
  const layoutTop = layout.getBoundingClientRect().top;
  let y = layout.scrollTop + (cur.el.getBoundingClientRect().top - layoutTop);
  const next = lineEls[i + 1];
  if (next && next.line > cur.line) {
    const frac = Math.min(1, Math.max(0, (line - cur.line) / (next.line - cur.line)));
    const curY = cur.el.getBoundingClientRect().top - layoutTop;
    const nextY = next.el.getBoundingClientRect().top - layoutTop;
    y = layout.scrollTop + curY + frac * (nextY - curY);
  }
  programmaticScrollUntil = Date.now() + 220;
  layout.scrollTo({ top: Math.max(0, y - 8), behavior: smooth ? 'smooth' : 'auto' });
}

function onLayoutScroll(): void {
  hideCtxMenu();
  updateTocActive();
  if (Date.now() < programmaticScrollUntil) {
    return; // 程式觸發的捲動,不回報,免回授。
  }
  const line = getTopVisibleLine();
  if (line != null && line !== lastPostedLine) {
    lastPostedLine = line;
    vscode.postMessage({ type: 'previewScrolled', line });
  }
}

layout.addEventListener(
  'scroll',
  () => {
    if (!scrollRaf) {
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        onLayoutScroll();
      });
    }
  },
  { passive: true },
);

// 右鍵 → 自訂選單「Go to source line」(跳回原始碼對應行)。刻意不用雙擊,避免讀文件時誤觸把
// 編輯器拉走(尤其獨立視窗模式)。若有選取文字,另外提供 Copy,免得自訂選單擋掉原生複製。
let ctxLine: number | null = null;
let ctxSelection = '';

function hideCtxMenu(): void {
  ctxMenu.hidden = true;
}

content.addEventListener('contextmenu', (e) => {
  const el = (e.target as HTMLElement)?.closest('[data-line]');
  const line = el ? parseInt(el.getAttribute('data-line') ?? '', 10) : NaN;
  ctxLine = Number.isNaN(line) ? null : line;
  ctxSelection = window.getSelection()?.toString() ?? '';
  if (ctxLine == null && !ctxSelection) {
    hideCtxMenu();
    return; // 沒對應行也沒選取 → 不顯示自訂選單。
  }
  e.preventDefault();
  ctxGoto.hidden = ctxLine == null;
  ctxCopy.hidden = !ctxSelection;
  ctxMenu.hidden = false;
  const w = ctxMenu.offsetWidth || 170;
  const h = ctxMenu.offsetHeight || 60;
  ctxMenu.style.left = `${Math.min(e.clientX, window.innerWidth - w - 4)}px`;
  ctxMenu.style.top = `${Math.min(e.clientY, window.innerHeight - h - 4)}px`;
});

ctxGoto.addEventListener('click', () => {
  if (ctxLine != null) {
    vscode.postMessage({ type: 'revealLine', line: ctxLine });
  }
  hideCtxMenu();
});
ctxCopy.addEventListener('click', () => {
  if (ctxSelection) {
    void navigator.clipboard?.writeText(ctxSelection);
  }
  hideCtxMenu();
});
window.addEventListener('click', hideCtxMenu);
window.addEventListener('blur', hideCtxMenu);

// ── 大綱 / 目錄(TOC)────────────────────────────────────────────────
function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\w一-鿿\- ]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-') || 'section'
  );
}

function buildToc(): void {
  const headings = Array.from(content.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'));
  tocHeadings = [];
  if (!headings.length) {
    tocAside.innerHTML = '<div class="md-toc-title">Outline</div><div class="md-toc-empty">No headings</div>';
    return;
  }
  const used = new Set<string>();
  const levels = headings.map((h) => parseInt(h.tagName[1], 10));
  const minLevel = Math.min(...levels);
  const rows: string[] = ['<div class="md-toc-title">Outline</div>'];
  headings.forEach((h, n) => {
    let id = h.id || slug(h.textContent ?? '');
    let unique = id;
    let k = 1;
    while (used.has(unique)) {
      unique = `${id}-${k++}`;
    }
    used.add(unique);
    h.id = unique;
    tocHeadings.push({ id: unique, el: h });
    const indent = (levels[n] - minLevel) * 12 + 10;
    rows.push(
      `<a class="md-toc-item" data-target="${unique}" style="padding-left:${indent}px" title="${escapeAttr(
        h.textContent ?? '',
      )}">${escapeHtml(h.textContent ?? '')}</a>`,
    );
  });
  tocAside.innerHTML = rows.join('');
}

function updateTocActive(): void {
  if (!tocOpen || !tocHeadings.length) {
    return;
  }
  const top = layout.getBoundingClientRect().top;
  let activeId = tocHeadings[0].id;
  for (const { id, el } of tocHeadings) {
    if (el.getBoundingClientRect().top - top <= 8) {
      activeId = id;
    } else {
      break;
    }
  }
  for (const a of Array.from(tocAside.querySelectorAll<HTMLElement>('.md-toc-item'))) {
    a.classList.toggle('active', a.getAttribute('data-target') === activeId);
  }
}

tocAside.addEventListener('click', (e) => {
  const item = (e.target as HTMLElement)?.closest('.md-toc-item');
  if (!item) {
    return;
  }
  const target = document.getElementById(item.getAttribute('data-target') ?? '');
  if (target) {
    const layoutTop = layout.getBoundingClientRect().top;
    programmaticScrollUntil = Date.now() + 220;
    layout.scrollTo({
      top: Math.max(0, layout.scrollTop + (target.getBoundingClientRect().top - layoutTop) - 8),
      behavior: 'smooth',
    });
  }
});

function setTocOpen(open: boolean): void {
  tocOpen = open;
  tocAside.hidden = !open;
  document.body.classList.toggle('toc-open', open);
  tocToggle.setAttribute('aria-pressed', String(open));
  tocToggle.classList.toggle('active', open);
  if (open) {
    updateTocActive();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persistState(): void {
  if (booting) {
    return; // 初始套用(套用記住的/預設值)不回寫,否則會把預設值固化、之後改預設無效。
  }
  vscode.setState({ zoom, theme: currentTheme, wide }); // webview 內部即時記住(reload 用)。
  // 跨開關 / 重啟靠 host 的 globalState;縮放可能連續變動,稍微 debounce 再寫。
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(
    () => vscode.postMessage({ type: 'persist', theme: currentTheme, zoom, wide }),
    400,
  );
}

/** 全寬切換:撐滿預覽寬度,寬表格不被裁切。 */
function applyWide(): void {
  document.body.classList.toggle('md-wide', wide);
  wideBtn.setAttribute('aria-pressed', String(wide));
  wideBtn.classList.toggle('active', wide);
  persistState();
}

wideBtn.addEventListener('click', () => {
  wide = !wide;
  applyWide();
});

// ── 主題(內建預覽配色)─────────────────────────────────────────────
const THEME_VARS = [
  '--md-bg',
  '--md-fg',
  '--md-border',
  '--md-muted',
  '--md-code-bg',
  '--md-link',
  '--md-link-active',
  '--md-accent',
  '--md-table-stripe',
  '--md-hover',
  '--md-hl-comment',
  '--md-hl-keyword',
  '--md-hl-string',
  '--md-hl-number',
  '--md-hl-title',
  '--md-hl-type',
];

/** 套用主題:'editor' 清掉 inline 覆寫 → 回到跟隨 VSCode;其餘把該配色的 --md-* inline 寫在 <body>。 */
function applyTheme(name: string): void {
  currentTheme = name;
  const s = document.body.style;
  if (name === 'editor' || !(name in THEMES)) {
    currentTheme = 'editor';
    for (const v of THEME_VARS) {
      s.removeProperty(v);
    }
  } else {
    const t = THEMES[name];
    const hl = t.dark ? HL_DARK : HL_LIGHT;
    // code 區塊底色 / 框線 / 表格斑馬紋用半透明疊色,亮暗皆可讀。
    const codeBg = t.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
    const border = t.dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.13)';
    const stripe = t.dark ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.03)';
    const hover = t.dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';
    s.setProperty('--md-bg', t.bg);
    s.setProperty('--md-fg', t.fg);
    s.setProperty('--md-border', border);
    s.setProperty('--md-muted', t.muted);
    s.setProperty('--md-code-bg', codeBg);
    s.setProperty('--md-link', t.accent);
    s.setProperty('--md-link-active', t.fg);
    s.setProperty('--md-accent', t.accent);
    s.setProperty('--md-table-stripe', stripe);
    s.setProperty('--md-hover', hover);
    s.setProperty('--md-hl-comment', t.muted);
    s.setProperty('--md-hl-keyword', hl.keyword);
    s.setProperty('--md-hl-string', hl.string);
    s.setProperty('--md-hl-number', hl.number);
    s.setProperty('--md-hl-title', hl.title);
    s.setProperty('--md-hl-type', hl.type);
  }
  // 抗鋸齒只在暗色開(亮底深字用 antialiased 會變淡);也記住目前明暗供 VSCode 主題變化比對。
  lastDark = effectiveDark();
  document.body.classList.toggle('md-theme-dark', lastDark);
  themeSelect.value = currentTheme;
  persistState();
}

themeSelect.addEventListener('change', () => {
  applyTheme(themeSelect.value);
  // 明暗可能變了 → mermaid 上色作廢重畫(以新主題明暗)。
  mermaidCache.clear();
  if (lastHtml) {
    void applyHtml(lastHtml);
  }
});

// ── 縮放(Ctrl + 滾輪 / 按鈕 / 鍵盤)──────────────────────────────────
function applyZoom(): void {
  // CSS zoom 會連文字、圖片、SVG 一起縮放並重排版面(transform: scale 不重排,故用 zoom)。
  content.style.setProperty('zoom', String(zoom));
  zoomLevelEl.textContent = `${Math.round(zoom * 100)}%`;
  persistState();
}

function setZoom(value: number): void {
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
  applyZoom();
}

layout.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey && !e.metaKey) {
      return;
    }
    e.preventDefault(); // 擋掉 VSCode webview 預設的字級縮放,改用我們自己的文件縮放。
    setZoom(zoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  },
  { passive: false },
);

zoomInBtn.addEventListener('click', () => setZoom(zoom + ZOOM_STEP));
zoomOutBtn.addEventListener('click', () => setZoom(zoom - ZOOM_STEP));
zoomLevelEl.addEventListener('click', () => setZoom(1));
applyTheme(currentTheme); // 套用已記住的主題(或預設 Dark Purple)。
applyZoom(); // 套用已記住的縮放(或預設 100%)。
applyWide(); // 套用已記住的全寬設定。
booting = false; // 之後的變更才回寫偏好。

// ── 連結 / 工具列 / 鍵盤 ───────────────────────────────────────────────
content.addEventListener('click', (e) => {
  const anchor = (e.target as HTMLElement)?.closest('a');
  if (!anchor) {
    return;
  }
  const href = anchor.getAttribute('href');
  if (!href) {
    return;
  }
  if (href.startsWith('#')) {
    const target = document.getElementById(href.slice(1));
    if (target) {
      e.preventDefault();
      const layoutTop = layout.getBoundingClientRect().top;
      programmaticScrollUntil = Date.now() + 220;
      layout.scrollTo({
        top: Math.max(0, layout.scrollTop + (target.getBoundingClientRect().top - layoutTop) - 8),
        behavior: 'smooth',
      });
    }
    return;
  }
  e.preventDefault();
  vscode.postMessage({ type: 'openLink', href });
});

tocToggle.addEventListener('click', () => setTocOpen(!tocOpen));
lockBtn.addEventListener('click', () => {
  locked = !locked;
  lockBtn.setAttribute('aria-pressed', String(locked));
  lockBtn.classList.toggle('active', locked);
  vscode.postMessage({ type: 'setLocked', locked });
});
refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
exitBtn.addEventListener('click', () => vscode.postMessage({ type: 'focusEditor' }));

// ── 匯出 PNG / PDF ──────────────────────────────────────────────────────
// 在 webview 端把整份 #md-content rasterize 成點陣圖(html2canvas 會原生渲染內嵌的 mermaid SVG、
// 表格、程式碼高亮),PNG 直接送出;PDF 用 jsPDF 把這張長圖依 A4 切頁。算好的位元組丟回 host 存檔。
let exporting = false;

function setExportMenuOpen(open: boolean): void {
  exportMenu.hidden = !open;
  exportBtn.setAttribute('aria-expanded', String(open));
}

/** 取得目前生效的底色(內建主題的 --md-bg 或跟隨 VSCode),作為匯出背景。 */
function exportBackground(): string {
  const bg = getComputedStyle(document.body).backgroundColor;
  return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' ? bg : '#ffffff';
}

/** 去掉副檔名後接上目標格式,作為存檔預設檔名。 */
function suggestedName(ext: string): string {
  const base = (filenameEl.textContent || 'document').replace(/\.(md|markdown)$/i, '');
  return `${base}.${ext}`;
}

async function captureContent(): Promise<HTMLCanvasElement> {
  // zoom 會干擾 html2canvas 的尺寸量測 → 暫時還原成 100% 再擷取,完成後復原(遮罩蓋住閃動)。
  const prevZoom = content.style.getPropertyValue('zoom');
  content.style.setProperty('zoom', '1');
  try {
    // 在量測到的自然高度下,把 scale 壓在合理上限,避免超長文件撐爆 canvas 尺寸限制。
    const naturalHeight = content.scrollHeight || 1;
    const scale = Math.max(1, Math.min(2, 14000 / naturalHeight));
    return await html2canvas(content, {
      backgroundColor: exportBackground(),
      scale,
      useCORS: true,
      logging: false,
      windowWidth: content.scrollWidth,
    });
  } finally {
    if (prevZoom) {
      content.style.setProperty('zoom', prevZoom);
    } else {
      content.style.removeProperty('zoom');
    }
  }
}

function canvasToPdf(canvas: HTMLCanvasElement): string {
  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;
  // 同一張長圖以負位移逐頁貼上(共用 alias 'doc',影像只內嵌一次,PDF 不會膨脹)。
  let position = 0;
  let heightLeft = imgH;
  pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH, 'doc', 'FAST');
  heightLeft -= pageH;
  while (heightLeft > 0) {
    position -= pageH;
    pdf.addPage();
    pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH, 'doc', 'FAST');
    heightLeft -= pageH;
  }
  return pdf.output('datauristring');
}

async function runExport(format: 'png' | 'pdf'): Promise<void> {
  if (exporting || !content.childNodes.length) {
    return;
  }
  exporting = true;
  exportOverlay.hidden = false;
  // 讓遮罩先上畫面再開始重運算(html2canvas 同步段會卡 UI)。
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    const canvas = await captureContent();
    const data = format === 'png' ? canvas.toDataURL('image/png') : canvasToPdf(canvas);
    vscode.postMessage({ type: 'export', format, data, suggestedName: suggestedName(format) });
  } catch (err) {
    vscode.postMessage({
      type: 'exportError',
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    exporting = false;
    exportOverlay.hidden = true;
  }
}

exportBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // 否則同一次點擊會被 window click 立刻關掉。
  setExportMenuOpen(exportMenu.hidden);
});
exportMenu.addEventListener('click', (e) => {
  const item = (e.target as HTMLElement)?.closest('.md-export-item');
  const format = item?.getAttribute('data-format');
  if (format === 'png' || format === 'pdf') {
    setExportMenuOpen(false);
    void runExport(format);
  }
});
window.addEventListener('click', () => setExportMenuOpen(false));

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === '=' || e.key === '+') {
      e.preventDefault();
      setZoom(zoom + ZOOM_STEP);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      setZoom(zoom - ZOOM_STEP);
    } else if (e.key === '0') {
      e.preventDefault();
      setZoom(1);
    }
    return;
  }
  if (e.key === 'Escape') {
    if (!ctxMenu.hidden) {
      hideCtxMenu(); // 選單開著時 Esc 先收選單,不要直接跳回編輯器。
      return;
    }
    if (!exportMenu.hidden) {
      setExportMenuOpen(false); // 匯出選單開著時 Esc 先收選單。
      return;
    }
    vscode.postMessage({ type: 'focusEditor' });
  } else if ((e.key === 'o' || e.key === 'w') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const t = e.target as HTMLElement;
    if (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') {
      if (e.key === 'o') {
        setTocOpen(!tocOpen);
      } else {
        wide = !wide;
        applyWide();
      }
    }
  }
});

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as
    | { type: 'update'; html: string; fileName: string }
    | { type: 'viewState'; exitVisible: boolean; locked: boolean }
    | { type: 'scrollToLine'; line: number };
  if (msg.type === 'update') {
    filenameEl.textContent = msg.fileName;
    void applyHtml(msg.html);
  } else if (msg.type === 'viewState') {
    exitBtn.hidden = !msg.exitVisible;
    locked = msg.locked;
    lockBtn.setAttribute('aria-pressed', String(locked));
    lockBtn.classList.toggle('active', locked);
  } else if (msg.type === 'scrollToLine') {
    scrollToLine(msg.line, false);
  }
});

// VSCode 主題切換:只在「跟隨 VSCode」(editor)且明暗真的變了時重畫(只看 isDarkTheme,
// 忽略我們自己 toggle 的 md-theme-dark class,避免回授)。選了內建預覽主題時配色固定。
new MutationObserver(() => {
  if (currentTheme !== 'editor') {
    return;
  }
  const dark = isDarkTheme();
  if (dark === lastDark) {
    return;
  }
  lastDark = dark;
  document.body.classList.toggle('md-theme-dark', dark);
  mermaidCache.clear();
  if (lastHtml) {
    void applyHtml(lastHtml);
  }
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

vscode.postMessage({ type: 'ready' });
