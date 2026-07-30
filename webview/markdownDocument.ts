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
const widthBtn = document.getElementById('md-width') as HTMLButtonElement;
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
const findBtn = document.getElementById('md-find-btn') as HTMLButtonElement;
const findBar = document.getElementById('md-find')!;
const findInput = document.getElementById('md-find-input') as HTMLInputElement;
const findCount = document.getElementById('md-find-count')!;
const findPrevBtn = document.getElementById('md-find-prev') as HTMLButtonElement;
const findNextBtn = document.getElementById('md-find-next') as HTMLButtonElement;
const findCloseBtn = document.getElementById('md-find-close') as HTMLButtonElement;

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
  daylight: { label: 'Daylight', dark: false, bg: '#F5F5F5', fg: '#1F1F1F', muted: '#4B5563', accent: '#0969DA' },
};
const HL_DARK = { keyword: '#FF80BF', string: '#FFFF80', number: '#9580FF', title: '#8AFF80', type: '#80FFEA' };
const HL_LIGHT = { keyword: '#A3144D', string: '#846E15', number: '#0550AE', title: '#14710A', type: '#036A96' };

// 初始偏好優先用 host 由 globalState 帶進來的 data-initial-*(跨開關 / 重啟記住);
// 退而求其次用 webview 自己的 state;再不然用預設(淺色 Light)。
const ds = document.body.dataset;
// 優先序:webview 自己的 state(本 panel 最新)→ host 由 globalState 帶進的 data-initial(跨 panel/重啟)→ 預設。
const savedState = vscode.getState() as
  | { zoom?: number; theme?: string; width?: string; exportLook?: string }
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
/** 內容寬度模式:auto=依視窗寬度自動切換 / full=真.全寬 / reading=920px 閱讀欄。 */
type WidthMode = 'auto' | 'full' | 'reading';
const WIDTH_MODES: WidthMode[] = ['auto', 'full', 'reading'];
const WIDTH_LABELS: Record<WidthMode, string> = { auto: 'Auto', full: 'Full', reading: 'Reading' };
function asWidthMode(v: unknown): WidthMode {
  return v === 'full' || v === 'reading' ? v : 'auto';
}
let widthMode: WidthMode = asWidthMode(savedState?.width ?? ds.initialWidth);
/** 匯出外觀:paper=白底文件版(預設,適合列印 / 分享);screen=沿用目前預覽主題。 */
type ExportLook = 'paper' | 'screen';
let exportLook: ExportLook = savedState?.exportLook === 'screen' ? 'screen' : 'paper';

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

function initMermaid(dark = effectiveDark()): void {
  ensureLegibilityStyles();
  mermaid.initialize({
    startOnLoad: false,
    theme: dark ? 'dark' : 'default',
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

/**
 * 在指定容器(可離屏)內把 mermaid 區塊渲染成 SVG;source 命中快取就秒換,沒命中才 async 渲染。
 * dark 可覆寫明暗(匯出時強制走亮色紙張配色);快取鍵帶明暗,避免兩種配色互相污染。
 */
async function renderMermaidInto(root: ParentNode, opts: { dark?: boolean } = {}): Promise<void> {
  const dark = opts.dark ?? effectiveDark();
  initMermaid(dark);
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
    const cacheKey = `${dark ? 'd' : 'l'}|${source}`;
    const cached = mermaidCache.get(cacheKey);
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
        colorizeDiagram(svgEl, { dark });
        boostLegibility(svgEl);
      }
      mermaidCache.set(cacheKey, container.innerHTML);
      pre.replaceWith(container);
    } catch {
      // 不完整 / 語法錯誤的圖:清掉 mermaid 暫存節點,保留原始碼區塊。
      document.getElementById('d' + id)?.remove();
    }
  }
  // 匯出用亮色渲染完後,把 mermaid 全域設定還原成畫面上的明暗,否則下一次畫面渲染會拿錯配色。
  if (dark !== effectiveDark()) {
    initMermaid();
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
    // 內容換新(打字 / 換主題)後標亮會被洗掉 → 若搜尋列開著就重套(不捲動,保留閱讀位置)。
    if (!findBar.hidden && findInput.value.trim()) {
      runFind(findInput.value, { scroll: false });
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
/**
 * 回寫偏好。immediate=true(離散變更:主題 / 寬度)立即送 host,避免使用者改完在 400ms 內關掉
 * 預覽導致 globalState 沒寫到、下次開預覽吃到舊值;縮放(連續變動)維持 debounce。
 * 訊息一律帶最新的 theme/zoom/width 三者,故立即送也不會漏掉尚未 flush 的 zoom。
 */
function persistState(immediate = false): void {
  if (booting) {
    return; // 初始套用(套用記住的/預設值)不回寫,否則會把預設值固化、之後改預設無效。
  }
  // webview 內部即時記住(reload 用);exportLook 只存這裡,不進 host globalState。
  vscode.setState({ zoom, theme: currentTheme, width: widthMode, exportLook });
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  const flush = () =>
    vscode.postMessage({ type: 'persist', theme: currentTheme, zoom, width: widthMode });
  if (immediate) {
    flush();
  } else {
    persistTimer = setTimeout(flush, 400);
  }
}

/** 套用內容寬度模式:切 body class、更新按鈕文字 / 高亮。 */
function applyWidth(): void {
  for (const m of WIDTH_MODES) {
    document.body.classList.toggle(`md-width-${m}`, m === widthMode);
  }
  widthBtn.textContent = WIDTH_LABELS[widthMode];
  widthBtn.title =
    `Content width: ${WIDTH_LABELS[widthMode]} — click / press w to cycle ` +
    '(Auto fits the window, Full = 100%, Reading = 920px)';
  widthBtn.classList.toggle('active', widthMode !== 'auto'); // 非預設(手動覆寫)時點亮。
  persistState(true); // 離散變更,立即回寫(免 <400ms 關閉預覽遺失)。
}

/** Auto → Full → Reading → Auto 循環。 */
function cycleWidth(): void {
  widthMode = WIDTH_MODES[(WIDTH_MODES.indexOf(widthMode) + 1) % WIDTH_MODES.length];
  applyWidth();
}

widthBtn.addEventListener('click', cycleWidth);

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
  persistState(true); // 離散變更,立即回寫(免 <400ms 關閉預覽遺失)。
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
applyWidth(); // 套用已記住的寬度模式(或預設 Auto)。
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
// 匯出不直接擷取畫面上的 #md-content,而是用原始 HTML 在離屏容器重排一份「文件版」:
//  * 配色走 Paper(白底黑字、深色高對比語法色、mermaid 亮色重繪),不會把螢幕上的深色主題印成一張黑紙;
//  * 版面鎖固定文件寬,程式碼/表格改成換行不裁切,長行不會被切掉;
//  * rasterize 走高倍率(依 A4 目標 DPI 反推),字才不糊;
//  * PDF 依「行框 / 區塊起點」挑分頁點,不會把一行字從中間切成兩半。
let exporting = false;

function setExportMenuOpen(open: boolean): void {
  exportMenu.hidden = !open;
  exportBtn.setAttribute('aria-expanded', String(open));
}

/** 去掉副檔名後接上目標格式,作為存檔預設檔名。 */
function suggestedName(ext: string): string {
  const base = (filenameEl.textContent || 'document').replace(/\.(md|markdown)$/i, '');
  return `${base}.${ext}`;
}

/**
 * 匯出固定排版寬度(px)。匯出時把內容鎖在這個寬度再擷取,版面就不會吃到目前面板/Auto/Full 的實際寬度
 * ——否則寬視窗下整份會被拉得很寬,縮成 A4 後字變小、表格欄距散開、整體「亂」。820 接近 A4 直印內容寬,
 * 縮放到頁面後幾乎 1:1,字級舒適、表格也排得整齊。
 */
const EXPORT_WIDTH = 820;
/** A4 直印尺寸與四邊留白(pt)。 */
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const PDF_MARGIN = 36;
/**
 * 目標倍率:820px 的內容寬貼到 A4 內文寬(523pt ≈ 7.26in)時,3x → 約 340 DPI,
 * 字邊緣才夠銳利(原本 1–2x 只有 99–198 DPI,縮到 A4 後就是使用者看到的「糊」)。
 */
const EXPORT_SCALE = 3;
/** canvas 上限保護:超長文件降倍率,避免瀏覽器直接回傳空白 canvas。 */
const MAX_CANVAS_PIXELS = 120_000_000;
const MAX_CANVAS_DIM = 32_000;

/** 依文件高度把倍率壓在瀏覽器 canvas 容量內(仍不低於 1x)。 */
function safeScale(heightPx: number): number {
  const byArea = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, EXPORT_WIDTH * heightPx));
  const byDim = MAX_CANVAS_DIM / Math.max(EXPORT_WIDTH, heightPx);
  return Math.max(1, Math.min(EXPORT_SCALE, byArea, byDim));
}

/** 等字型與圖片就緒:少了這步,html2canvas 會用 fallback 字型量測 / 畫出半載入的圖。 */
async function waitForAssets(root: HTMLElement): Promise<void> {
  try {
    await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
  } catch {
    /* 沒有 Font Loading API 就跳過。 */
  }
  const pending = Array.from(root.querySelectorAll('img')).map((img) =>
    img.complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        }),
  );
  await Promise.all(pending);
}

/**
 * 建一份離屏的匯出用文件:同一份原始 HTML,但套匯出樣式、mermaid 依匯出配色重畫。
 * 用複製件而不是動畫面上的節點 → 匯出期間畫面零閃動,也不會把搜尋標亮 / 捲動狀態帶進成品。
 */
async function buildExportDoc(look: ExportLook): Promise<HTMLElement> {
  const root = document.createElement('div');
  root.id = 'md-export-root';
  root.className = `markdown-body md-export-doc md-export-${look}`;
  root.style.width = `${EXPORT_WIDTH}px`;
  root.innerHTML = lastHtml;
  document.body.appendChild(root);
  await renderMermaidInto(root, { dark: look === 'paper' ? false : effectiveDark() });
  await waitForAssets(root);
  return root;
}

/** 匯出底色:paper 固定白底;screen 取目前主題底色。 */
function exportBackground(look: ExportLook): string {
  if (look === 'paper') {
    return '#ffffff';
  }
  const bg = getComputedStyle(document.body).backgroundColor;
  return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' ? bg : '#ffffff';
}

async function captureDoc(
  root: HTMLElement,
  look: ExportLook,
): Promise<{ canvas: HTMLCanvasElement; scale: number; heightPx: number }> {
  const heightPx = root.scrollHeight || 1;
  const scale = safeScale(heightPx);
  const canvas = await html2canvas(root, {
    backgroundColor: exportBackground(look),
    scale,
    useCORS: true,
    logging: false,
    width: EXPORT_WIDTH,
    height: heightPx,
    windowWidth: EXPORT_WIDTH,
  });
  return { canvas, scale, heightPx };
}

/**
 * 蒐集可以安全分頁的 y 座標(相對於文件頂端,CSS px):
 * 每個區塊元素的起點,加上葉節點的「每一行行框」起點 —— 有行框座標,分頁就永遠落在兩行之間,
 * 不會像固定切頁那樣把一行字攔腰切斷。表格只取列(tr)起點,避免從儲存格中間斷開。
 */
function collectBreakYs(root: HTMLElement): number[] {
  const rootTop = root.getBoundingClientRect().top;
  const ys = new Set<number>([0]);
  const ATOMIC = /^(IMG|SVG|CANVAS|HR|BR)$/;
  const walk = (el: Element, inTable: boolean): void => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName;
      if (ATOMIC.test(tag)) {
        continue;
      }
      const rect = child.getBoundingClientRect();
      if (rect.height <= 0) {
        continue;
      }
      ys.add(rect.top - rootTop);
      if (tag === 'TABLE' || inTable) {
        // 表格內只認列邊界(往下找 tbody/tr),不拆儲存格內的行。
        walk(child, true);
        continue;
      }
      const hasBlockChild = Array.from(child.children).some(
        (c) => !ATOMIC.test(c.tagName) && getComputedStyle(c).display !== 'inline',
      );
      if (hasBlockChild) {
        walk(child, false);
      } else {
        // 葉節點:用 Range 量出每一行行框的頂端當分頁點。
        const range = document.createRange();
        range.selectNodeContents(child);
        for (const r of Array.from(range.getClientRects())) {
          if (r.height > 0) {
            ys.add(r.top - rootTop);
          }
        }
      }
    }
  };
  walk(root, false);
  return Array.from(ys).sort((a, b) => a - b);
}

/** 依可用頁高與分頁候選點,算出每頁的起點 y(CSS px)。 */
function planPages(breaks: number[], totalH: number, usableH: number): number[] {
  const starts = [0];
  let y = 0;
  let guard = 0;
  while (y + usableH < totalH && guard++ < 2000) {
    const limit = y + usableH;
    const minFill = y + usableH * 0.5; // 別為了對齊就留下半頁以上的空白。
    let next = -1;
    for (const b of breaks) {
      if (b > minFill && b <= limit) {
        next = b;
      } else if (b > limit) {
        break;
      }
    }
    if (next <= y) {
      next = limit; // 找不到合適斷點(例如一張比整頁還高的圖)就硬切。
    }
    starts.push(next);
    y = next;
  }
  return starts;
}

/** 把長圖依 starts 切成一頁一張貼進 A4;每頁只放該頁內容,頁尾留白而不是硬切一行。 */
function canvasToPdf(
  canvas: HTMLCanvasElement,
  scale: number,
  totalH: number,
  starts: number[],
  look: ExportLook,
): string {
  const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4', compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const contentW = pageW - PDF_MARGIN * 2;
  const ptPerPx = contentW / EXPORT_WIDTH;
  const bg = exportBackground(look);
  const slice = document.createElement('canvas');
  const ctx = slice.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable.');
  }
  starts.forEach((startY, i) => {
    const endY = i + 1 < starts.length ? starts[i + 1] : totalH;
    const sliceH = Math.max(1, Math.round((endY - startY) * scale));
    if (i > 0) {
      pdf.addPage();
    }
    if (look !== 'paper') {
      pdf.setFillColor(bg);
      pdf.rect(0, 0, pageW, pageH, 'F'); // 深色版連留白也要染色,否則四周是白框。
    }
    slice.width = canvas.width;
    slice.height = sliceH;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, -Math.round(startY * scale));
    pdf.addImage(
      slice.toDataURL('image/png'),
      'PNG',
      PDF_MARGIN,
      PDF_MARGIN,
      contentW,
      (endY - startY) * ptPerPx,
      `p${i}`,
      'FAST',
    );
  });
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
  const look = exportLook;
  let root: HTMLElement | undefined;
  try {
    root = await buildExportDoc(look);
    const { canvas, scale, heightPx } = await captureDoc(root, look);
    let data: string;
    if (format === 'png') {
      data = canvas.toDataURL('image/png');
    } else {
      // 一頁能放多少 CSS px 的內容:A4 內文高 ÷ (內文寬 / 匯出寬)。
      const usableH =
        ((A4_HEIGHT_PT - PDF_MARGIN * 2) * EXPORT_WIDTH) / (A4_WIDTH_PT - PDF_MARGIN * 2);
      const starts = planPages(collectBreakYs(root), heightPx, usableH);
      data = canvasToPdf(canvas, scale, heightPx, starts, look);
    }
    vscode.postMessage({ type: 'export', format, data, suggestedName: suggestedName(format) });
  } catch (err) {
    vscode.postMessage({
      type: 'exportError',
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    root?.remove();
    exporting = false;
    exportOverlay.hidden = true;
  }
}

/** 匯出外觀切換:更新選單上的勾選狀態並記住選擇。 */
function applyExportLook(look: ExportLook): void {
  exportLook = look;
  for (const btn of Array.from(exportMenu.querySelectorAll<HTMLElement>('.md-export-look'))) {
    const on = btn.getAttribute('data-look') === look;
    btn.setAttribute('aria-checked', String(on));
    btn.classList.toggle('checked', on);
  }
  persistState(true);
}

exportBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // 否則同一次點擊會被 window click 立刻關掉。
  setExportMenuOpen(exportMenu.hidden);
});
exportMenu.addEventListener('click', (e) => {
  const target = e.target as HTMLElement | null;
  const look = target?.closest('.md-export-look')?.getAttribute('data-look');
  if (look === 'paper' || look === 'screen') {
    e.stopPropagation(); // 選外觀不關選單,方便接著按匯出。
    applyExportLook(look);
    return;
  }
  const format = target?.closest('.md-export-item')?.getAttribute('data-format');
  if (format === 'png' || format === 'pdf') {
    setExportMenuOpen(false);
    void runExport(format);
  }
});
window.addEventListener('click', () => setExportMenuOpen(false));
applyExportLook(exportLook);

// ── 文件內搜尋(Find bar)─────────────────────────────────────────────
// 把命中的文字節點切開、包進 <mark>,跨整份文件(含 mermaid 節點的 foreignObject HTML 文字)標亮,
// 並可上下筆切換、捲到畫面中央。重渲染(打字 / 換主題)後會自動重套標亮。
const SVG_NS = 'http://www.w3.org/2000/svg';
let findMatches: HTMLElement[] = [];
let findCurrent = -1;

/** 此文字節點能否安全地用 HTML <mark> 包起來:純 SVG <text> 不行(會破壞向量),
 *  但 mermaid 節點標籤是 foreignObject 內的 HTML 文字,可以。 */
function isWrappableText(node: Text): boolean {
  let el = node.parentElement;
  while (el) {
    if (el.namespaceURI === SVG_NS) {
      if (el.localName === 'foreignObject') {
        return true; // foreignObject 之下是 HTML,可包。
      }
      if (el.localName === 'svg') {
        return false; // 一路到 svg 根都沒遇到 foreignObject → 是原生 SVG 文字,不包。
      }
    }
    el = el.parentElement;
  }
  return true;
}

/** 還原所有標亮:把 <mark class="md-find-hit"> 換回純文字並合併相鄰文字節點。 */
function clearFindHighlights(): void {
  for (const m of Array.from(content.querySelectorAll('mark.md-find-hit'))) {
    const parent = m.parentNode;
    if (!parent) {
      continue;
    }
    parent.replaceChild(document.createTextNode(m.textContent ?? ''), m);
    parent.normalize(); // 合併拆開的相鄰文字節點,避免越搜越碎。
  }
}

/** 把單一文字節點內所有命中(大小寫不敏感)包成 <mark>。 */
function highlightInTextNode(node: Text, lowerQuery: string): void {
  const text = node.nodeValue ?? '';
  const lower = text.toLowerCase();
  const frag = document.createDocumentFragment();
  let from = 0;
  let idx = lower.indexOf(lowerQuery, from);
  while (idx !== -1) {
    if (idx > from) {
      frag.appendChild(document.createTextNode(text.slice(from, idx)));
    }
    const mark = document.createElement('mark');
    mark.className = 'md-find-hit';
    mark.textContent = text.slice(idx, idx + lowerQuery.length); // 保留原始大小寫。
    frag.appendChild(mark);
    from = idx + lowerQuery.length;
    idx = lower.indexOf(lowerQuery, from);
  }
  if (from < text.length) {
    frag.appendChild(document.createTextNode(text.slice(from)));
  }
  node.parentNode?.replaceChild(frag, node);
}

function updateFindCount(): void {
  if (!findInput.value.trim()) {
    findCount.textContent = '';
    findCount.classList.remove('no-match');
    return;
  }
  const total = findMatches.length;
  findCount.textContent = total ? `${findCurrent + 1}/${total}` : 'No results';
  findCount.classList.toggle('no-match', total === 0);
}

/** 把目前這一筆命中捲到畫面中央(用 rect 數學,故不受 CSS zoom 影響)。 */
function scrollFindIntoView(el: HTMLElement): void {
  const layoutRect = layout.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const target =
    layout.scrollTop + (elRect.top - layoutRect.top) - layout.clientHeight / 2 + elRect.height / 2;
  programmaticScrollUntil = Date.now() + 220; // 別把這次捲動回報給編輯器,免回授。
  layout.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
}

function setFindCurrent(i: number, opts: { scroll?: boolean } = {}): void {
  if (!findMatches.length) {
    findCurrent = -1;
    updateFindCount();
    return;
  }
  if (findCurrent >= 0) {
    findMatches[findCurrent]?.classList.remove('current');
  }
  findCurrent = ((i % findMatches.length) + findMatches.length) % findMatches.length;
  const el = findMatches[findCurrent];
  el.classList.add('current');
  updateFindCount();
  if (opts.scroll !== false) {
    scrollFindIntoView(el);
  }
}

function runFind(query: string, opts: { scroll?: boolean } = {}): void {
  clearFindHighlights();
  findMatches = [];
  findCurrent = -1;
  const lowerQuery = query.trim().toLowerCase();
  if (!lowerQuery) {
    updateFindCount();
    return;
  }
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const value = node.nodeValue;
      if (!value || !value.toLowerCase().includes(lowerQuery)) {
        return NodeFilter.FILTER_REJECT;
      }
      const parent = (node as Text).parentElement;
      if (!parent || parent.closest('script, style')) {
        return NodeFilter.FILTER_REJECT;
      }
      return isWrappableText(node as Text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const targets: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    targets.push(n as Text);
    n = walker.nextNode();
  }
  // 由後往前處理同一輪收集到的節點,避免切割節點影響尚未處理者(本實作各自獨立,順序其實無妨)。
  for (const node of targets) {
    highlightInTextNode(node, lowerQuery);
  }
  findMatches = Array.from(content.querySelectorAll<HTMLElement>('mark.md-find-hit'));
  if (findMatches.length) {
    setFindCurrent(0, opts);
  } else {
    updateFindCount();
  }
}

function openFind(): void {
  findBar.hidden = false;
  findBtn.classList.add('active');
  findBtn.setAttribute('aria-pressed', 'true');
  findInput.focus();
  findInput.select();
  if (findInput.value.trim()) {
    runFind(findInput.value);
  }
}

function closeFind(): void {
  if (findBar.hidden) {
    return;
  }
  findBar.hidden = true;
  findBtn.classList.remove('active');
  findBtn.setAttribute('aria-pressed', 'false');
  clearFindHighlights();
  findMatches = [];
  findCurrent = -1;
  findCount.textContent = '';
  findCount.classList.remove('no-match');
}

findBtn.addEventListener('click', () => {
  if (findBar.hidden) {
    openFind();
  } else {
    closeFind();
  }
});
findInput.addEventListener('input', () => runFind(findInput.value));
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    setFindCurrent(findCurrent + (e.shiftKey ? -1 : 1));
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation(); // 別讓 Esc 冒泡到 document 直接跳回編輯器。
    closeFind();
  }
});
findPrevBtn.addEventListener('click', () => setFindCurrent(findCurrent - 1));
findNextBtn.addEventListener('click', () => setFindCurrent(findCurrent + 1));
findCloseBtn.addEventListener('click', closeFind);

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
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault(); // 接管 Ctrl+F → 自製 Find bar(host 已關掉原生 find widget)。
      openFind();
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
    if (!findBar.hidden) {
      closeFind(); // Find bar 開著時 Esc 先收搜尋。
      return;
    }
    vscode.postMessage({ type: 'focusEditor' });
  } else if ((e.key === 'o' || e.key === 'w') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const t = e.target as HTMLElement;
    // 焦點在表單控制項(含主題 <select> 的 type-ahead)、可編輯區或工具列內時不攔截單鍵快捷,
    // 否則會劫持原生輸入(例:在 Theme 下拉按 w 會被誤判成切換寬度)。
    if (
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) &&
      !t.isContentEditable &&
      !t.closest('#md-toolbar')
    ) {
      if (e.key === 'o') {
        setTocOpen(!tocOpen);
      } else {
        cycleWidth();
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
