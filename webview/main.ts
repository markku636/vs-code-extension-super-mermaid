import mermaid from 'mermaid';
import svgPanZoom from 'svg-pan-zoom';
import { colorizeDiagram } from './colorize';

type PanZoomInstance = ReturnType<typeof svgPanZoom>;

interface BlockData {
  source: string;
  title: string;
  label: string;
}

interface UpdateMessage {
  type: 'update';
  uri: string;
  version: number;
  fileName: string;
  blocks: BlockData[];
  activeIndex: number;
}

type InMessage =
  | UpdateMessage
  | { type: 'setActive'; index: number }
  | { type: 'exportAllStart' }
  | { type: 'exportAllCancel' };

type ThemePref = 'auto' | 'colorful' | 'sketch' | 'default' | 'dark' | 'neutral' | 'forest';
type RasterFormat = 'png' | 'jpg' | 'webp';

interface PersistedState {
  theme?: ThemePref;
  pngScale?: number;
  transparentBg?: boolean;
}

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): PersistedState | undefined;
  setState(state: PersistedState): void;
};

const vscodeApi = acquireVsCodeApi();

const canvasEl = document.getElementById('canvas') as HTMLDivElement;
const diagramEl = document.getElementById('diagram') as HTMLDivElement;
const galleryEl = document.getElementById('gallery') as HTMLDivElement;
const errorEl = document.getElementById('error') as HTMLDivElement;
const emptyEl = document.getElementById('empty') as HTMLDivElement;
const selectEl = document.getElementById('block-select') as HTMLSelectElement;
const zoomLabelEl = document.getElementById('zoom-level') as HTMLSpanElement;
const themeSelectEl = document.getElementById('theme-select') as HTMLSelectElement;
const scaleSelectEl = document.getElementById('png-scale') as HTMLSelectElement;
const bgCheckEl = document.getElementById('bg-transparent') as HTMLInputElement;
const galleryToggleBtn = document.getElementById('gallery-toggle') as HTMLButtonElement;
const exportMenuBtn = document.getElementById('export-menu-btn') as HTMLButtonElement;
const exportMenuEl = document.getElementById('export-menu') as HTMLDivElement;
const moreBtn = document.getElementById('more-btn') as HTMLButtonElement;
const moreMenuEl = document.getElementById('more-menu') as HTMLDivElement;
const menuLockLabelEl = document.getElementById('menu-lock-label') as HTMLSpanElement;
const toastEl = document.getElementById('toast') as HTMLDivElement;

const RASTER_MIME: Record<RasterFormat, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

let fileName = '';
let blocks: BlockData[] = [];
let activeIndex = 0;
let panZoom: PanZoomInstance | undefined;
let baseZoom = 1;
let renderSeq = 0;
let exportSeq = 0;
let darkTheme = false;
let themePref: ThemePref = 'colorful';
let pngScale = 2;
let transparentBg = false;
let locked = false;
let galleryMode = false;
let galleryGen = 0;
let exportAllInFlight = false;
let exportAllCancelled = false;

const saved = vscodeApi.getState() ?? {};
if (saved.theme && Array.from(themeSelectEl.options).some((o) => o.value === saved.theme)) {
  themePref = saved.theme;
}
if (
  saved.pngScale &&
  Array.from(scaleSelectEl.options).some((o) => o.value === String(saved.pngScale))
) {
  pngScale = saved.pngScale;
}
if (saved.transparentBg) {
  transparentBg = true;
}
themeSelectEl.value = themePref;
scaleSelectEl.value = String(pngScale);
bgCheckEl.checked = transparentBg;

function persist(): void {
  vscodeApi.setState({ theme: themePref, pngScale, transparentBg });
}

function isDarkTheme(): boolean {
  const cls = document.body.className;
  if (cls.includes('vscode-high-contrast-light')) {
    return false;
  }
  return cls.includes('vscode-dark') || cls.includes('vscode-high-contrast');
}

function resolvedTheme(): 'default' | 'dark' | 'neutral' | 'forest' {
  if (themePref === 'auto' || themePref === 'colorful' || themePref === 'sketch') {
    // Colorful renders on the auto base theme, then repaints nodes afterwards.
    // Sketch keeps the auto base theme too — the hand-drawn look does the rest.
    return isDarkTheme() ? 'dark' : 'default';
  }
  return themePref;
}

function uiFontFamily(): string {
  const value = getComputedStyle(document.body).getPropertyValue('--vscode-font-family').trim();
  return value || 'sans-serif';
}

type MermaidConfig = Parameters<typeof mermaid.initialize>[0];

function baseMermaidConfig(): MermaidConfig {
  const config: MermaidConfig = {
    startOnLoad: false,
    theme: resolvedTheme(),
    fontFamily: uiFontFamily(),
  };
  if (themePref === 'colorful') {
    // Commercial tools breathe: wider node/rank gaps make the same diagram
    // read dramatically cleaner.
    config.flowchart = { nodeSpacing: 60, rankSpacing: 65, padding: 12 };
    config.sequence = { actorMargin: 70, boxMargin: 12 };
  }
  if (themePref === 'sketch') {
    config.look = 'handDrawn';
    // Seed 0 means random — pin it so re-renders don't wobble.
    config.handDrawnSeed = 42;
  }
  return config;
}

function initMermaid(): void {
  darkTheme = isDarkTheme();
  mermaid.initialize(baseMermaidConfig());
}

// Renders and exports temporarily swap the global mermaid config, so everything
// that calls mermaid.render() runs through one serial queue.
let taskQueue: Promise<void> = Promise.resolve();
function enqueue(task: () => Promise<void>): void {
  taskQueue = taskQueue.then(task).catch(() => undefined);
}

function destroyPanZoom(): void {
  panZoom?.destroy();
  panZoom = undefined;
}

function updateZoomLabel(): void {
  const percent = Math.round(((panZoom?.getZoom() ?? baseZoom) / baseZoom) * 100);
  zoomLabelEl.textContent = `${percent}%`;
}

function resetView(): void {
  if (!panZoom) {
    return;
  }
  panZoom.resize();
  panZoom.fit();
  panZoom.center();
  baseZoom = panZoom.getZoom() || 1;
  updateZoomLabel();
}

function fitWidth(): void {
  if (!panZoom) {
    return;
  }
  panZoom.resize();
  const sizes = panZoom.getSizes();
  const margin = 24;
  const topMargin = 64; // keep the diagram top clear of the floating toolbar
  const targetReal = Math.max(0.01, (sizes.width - margin * 2) / sizes.viewBox.width);
  panZoom.zoomBy(targetReal / sizes.realZoom);
  const after = panZoom.getSizes();
  panZoom.pan({
    x: margin - after.viewBox.x * after.realZoom,
    y: topMargin - after.viewBox.y * after.realZoom,
  });
  updateZoomLabel();
}

function actualSize(): void {
  if (!panZoom) {
    return;
  }
  panZoom.zoom(baseZoom);
  updateZoomLabel();
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(text: string): void {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2000);
}

function showError(err: unknown, titleText = 'Mermaid syntax error'): void {
  const message = err instanceof Error ? err.message : String(err);
  errorEl.replaceChildren();
  const title = document.createElement('div');
  title.className = 'error-title';
  title.textContent = titleText;
  const body = document.createElement('div');
  body.textContent = message;
  errorEl.append(title, body);
  errorEl.hidden = false;
}

function updateSelect(): void {
  if (blocks.length < 2) {
    selectEl.hidden = true;
    return;
  }
  selectEl.replaceChildren(
    ...blocks.map((b, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = b.label;
      return option;
    }),
  );
  selectEl.value = String(activeIndex);
  selectEl.hidden = false;
}

// ─── Single-diagram rendering ───────────────────────────────────────────────

async function render(opts: { keepView?: boolean } = {}): Promise<void> {
  if (galleryMode) {
    return; // a queued single render must not rebuild behind the gallery
  }
  updateSelect();
  const block = blocks[activeIndex];
  if (!block || !block.source.trim()) {
    destroyPanZoom();
    diagramEl.replaceChildren();
    errorEl.hidden = true;
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  const seq = ++renderSeq;
  const id = `mmd-${seq}`;
  let svgText: string;
  try {
    svgText = (await mermaid.render(id, block.source)).svg;
  } catch (err) {
    // mermaid leaves a temp error node in the DOM when render throws
    document.getElementById('d' + id)?.remove();
    if (seq === renderSeq) {
      showError(err);
    }
    return;
  }
  if (seq !== renderSeq || galleryMode) {
    return;
  }

  const previousView =
    opts.keepView && panZoom ? { zoom: panZoom.getZoom(), pan: panZoom.getPan() } : undefined;
  destroyPanZoom();
  diagramEl.innerHTML = svgText;
  const svgEl = diagramEl.querySelector('svg');
  if (!svgEl) {
    return;
  }
  svgEl.style.maxWidth = 'none';
  svgEl.style.width = '100%';
  svgEl.style.height = '100%';
  if (themePref === 'colorful') {
    colorizeDiagram(svgEl, { dark: darkTheme });
  }
  panZoom = svgPanZoom(svgEl, {
    zoomEnabled: true,
    panEnabled: true,
    controlIconsEnabled: false,
    dblClickZoomEnabled: false,
    fit: true,
    center: true,
    minZoom: 0.05,
    maxZoom: 40,
    zoomScaleSensitivity: 0.25,
    onZoom: updateZoomLabel,
  });
  baseZoom = panZoom.getZoom() || 1;
  if (previousView) {
    panZoom.zoom(previousView.zoom);
    panZoom.pan(previousView.pan);
  }
  updateZoomLabel();
  errorEl.hidden = true;
  if (!searchBarEl.hidden && searchInputEl.value.trim()) {
    // Re-apply highlights on the fresh DOM, but don't yank the view around.
    runSearch(searchInputEl.value, { pan: false });
  }
}

function scheduleRender(opts: { keepView?: boolean } = {}): void {
  enqueue(() => render(opts));
}

// ─── Gallery mode ───────────────────────────────────────────────────────────

function enterGallery(): void {
  if (galleryMode) {
    return;
  }
  closeSearch();
  galleryMode = true;
  destroyPanZoom();
  diagramEl.replaceChildren();
  diagramEl.hidden = true;
  errorEl.hidden = true;
  galleryEl.hidden = false;
  document.body.classList.add('gallery-mode');
  galleryToggleBtn.classList.add('active');
  scheduleGallery();
}

function exitGallery(): void {
  if (!galleryMode) {
    return;
  }
  galleryMode = false;
  galleryGen++; // aborts any in-flight gallery loop at its next checkpoint
  galleryEl.replaceChildren();
  galleryEl.hidden = true;
  diagramEl.hidden = false;
  document.body.classList.remove('gallery-mode');
  galleryToggleBtn.classList.remove('active');
  scheduleRender();
}

function scheduleGallery(): void {
  enqueue(() => renderGallery());
}

async function renderGallery(): Promise<void> {
  if (!galleryMode) {
    return;
  }
  const gen = ++galleryGen;
  const snapshot = blocks.slice();
  const scrollTop = galleryEl.scrollTop;
  galleryEl.replaceChildren();

  if (snapshot.length === 0) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  const bodies: HTMLDivElement[] = [];
  snapshot.forEach((block, i) => {
    const card = document.createElement('div');
    card.className = 'gallery-card' + (i === activeIndex ? ' active' : '');
    card.dataset.index = String(i);
    const titleBar = document.createElement('div');
    titleBar.className = 'gallery-card-title';
    titleBar.textContent = block.title;
    const lineTag = document.createElement('span');
    lineTag.className = 'gallery-card-line';
    lineTag.textContent = block.label.match(/\(L\d+\)$/)?.[0] ?? '';
    titleBar.appendChild(lineTag);
    const body = document.createElement('div');
    body.className = 'gallery-card-body';
    body.innerHTML = '<span class="gallery-card-pending">Rendering…</span>';
    card.append(titleBar, body);
    card.addEventListener('click', () => {
      exitGallery();
      activeIndex = i;
      scheduleRender();
      vscodeApi.postMessage({ type: 'revealBlock', index: i });
    });
    galleryEl.appendChild(card);
    bodies.push(body);
  });
  galleryEl.scrollTop = scrollTop;

  for (let i = 0; i < snapshot.length; i++) {
    if (gen !== galleryGen || !galleryMode) {
      return;
    }
    const id = `mmd-g-${gen}-${i}`;
    try {
      const { svg } = await mermaid.render(id, snapshot[i].source);
      if (gen !== galleryGen || !galleryMode) {
        return;
      }
      bodies[i].innerHTML = svg;
      const svgEl = bodies[i].querySelector('svg');
      if (svgEl) {
        svgEl.style.maxWidth = 'none';
        svgEl.style.width = '100%';
        svgEl.style.height = '100%';
        if (themePref === 'colorful') {
          colorizeDiagram(svgEl, { dark: darkTheme });
        }
      }
    } catch (err) {
      document.getElementById('d' + id)?.remove();
      if (gen !== galleryGen || !galleryMode) {
        return;
      }
      const errBox = document.createElement('div');
      errBox.className = 'gallery-card-error';
      errBox.textContent = err instanceof Error ? err.message : String(err);
      bodies[i].replaceChildren(errBox);
    }
  }
}

function highlightGalleryCard(index: number): void {
  for (const card of Array.from(galleryEl.querySelectorAll<HTMLElement>('.gallery-card'))) {
    const isActive = card.dataset.index === String(index);
    card.classList.toggle('active', isActive);
    if (isActive) {
      card.scrollIntoView({ block: 'nearest' });
    }
  }
}

// ─── Click-to-source (preview → editor) ─────────────────────────────────────

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The enclosing element that maps back to one source statement, if any. */
function clickableGroupFor(target: Element): Element | undefined {
  const group = target.closest('g.node, g.cluster, g.mindmap-node, g[class*="timeline-node"]');
  if (group) {
    return group;
  }
  // Sequence-diagram actors: rect.actor / text.actor inside a plain <g>.
  const actor = target.closest('.actor');
  return actor?.parentElement ?? undefined;
}

/**
 * Best-effort lookup of the source line a rendered node came from. Mermaid
 * embeds the author's identifier in the element id ("flowchart-NodeId-12" →
 * "NodeId"); diagram types without such ids fall back to the label text.
 */
function sourceLineFor(group: Element, source: string): number | undefined {
  const lines = source.split('\n');
  const idMatch = group.id.match(/^[A-Za-z]\w*-(.+)-\d+$/);
  if (idMatch) {
    const re = new RegExp(`(^|[^\\w])${escapeRegExp(idMatch[1])}([^\\w]|$)`);
    const byId = lines.findIndex((l) => re.test(l));
    if (byId >= 0) {
      return byId;
    }
  }
  const label = group.querySelector('.nodeLabel, .label, text')?.textContent?.trim();
  if (label) {
    const byText = lines.findIndex((l) => l.includes(label));
    if (byText >= 0) {
      return byText;
    }
  }
  return undefined;
}

// svg-pan-zoom pans with the same button — only treat press+release in place
// as a click, so dragging never jumps the editor around.
let pointerDownAt: { x: number; y: number } | undefined;
diagramEl.addEventListener('pointerdown', (e) => {
  pointerDownAt = { x: e.clientX, y: e.clientY };
});
diagramEl.addEventListener('click', (e) => {
  if (
    pointerDownAt &&
    (Math.abs(e.clientX - pointerDownAt.x) > 4 || Math.abs(e.clientY - pointerDownAt.y) > 4)
  ) {
    return;
  }
  if (presentationMode) {
    presStep(1); // PowerPoint-style: click advances, never touches the editor
    return;
  }
  const block = blocks[activeIndex];
  if (!block || !(e.target instanceof Element)) {
    return;
  }
  const group = clickableGroupFor(e.target);
  if (!group) {
    return;
  }
  const line = sourceLineFor(group, block.source);
  if (line !== undefined) {
    vscodeApi.postMessage({ type: 'revealLine', index: activeIndex, line });
  } else {
    vscodeApi.postMessage({ type: 'revealBlock', index: activeIndex });
  }
});

// ─── Find in diagram ────────────────────────────────────────────────────────

const searchBarEl = document.getElementById('search-bar') as HTMLDivElement;
const searchInputEl = document.getElementById('search-input') as HTMLInputElement;
const searchCountEl = document.getElementById('search-count') as HTMLSpanElement;
const searchToggleBtn = document.getElementById('search-toggle') as HTMLButtonElement;

let searchMatches: Element[] = [];
let searchCurrent = -1;

const DIMMABLE_SELECTOR =
  'g.node, g.cluster, g.mindmap-node, g[class*="timeline-node"], .actor';

/** Same node-level granularity as click-to-source, falling back to the text itself. */
function highlightTargetFor(el: Element): Element {
  return clickableGroupFor(el) ?? el;
}

function clearSearchHighlights(): void {
  const svg = diagramEl.querySelector('svg');
  if (!svg) {
    return;
  }
  for (const el of Array.from(svg.querySelectorAll('.sm-dim, .sm-hit'))) {
    el.classList.remove('sm-dim', 'sm-hit');
  }
}

function setSearchCurrent(i: number, opts: { pan?: boolean } = {}): void {
  if (searchMatches.length === 0) {
    return;
  }
  if (searchCurrent >= 0) {
    searchMatches[searchCurrent]?.classList.remove('sm-hit');
  }
  searchCurrent = ((i % searchMatches.length) + searchMatches.length) % searchMatches.length;
  const el = searchMatches[searchCurrent];
  el.classList.add('sm-hit');
  searchCountEl.textContent = `${searchCurrent + 1}/${searchMatches.length}`;
  if (opts.pan !== false) {
    panToElement(el);
  }
}

/** Center an element in the view at the current zoom via svg-pan-zoom. */
function panToElement(el: Element): void {
  const svg = diagramEl.querySelector('svg');
  if (!panZoom || !svg) {
    return;
  }
  const vp = svg.querySelector<SVGGElement>('.svg-pan-zoom_viewport');
  const g = el as SVGGraphicsElement;
  if (!vp || typeof g.getBBox !== 'function') {
    return;
  }
  const vpCtm = vp.getCTM();
  const elCtm = g.getCTM();
  if (!vpCtm || !elCtm) {
    return;
  }
  let bb: DOMRect;
  try {
    bb = g.getBBox();
  } catch {
    return;
  }
  // el-local → viewBox coordinates; screen = viewBox * realZoom + pan.
  const m = vpCtm.inverse().multiply(elCtm);
  const c = new DOMPoint(bb.x + bb.width / 2, bb.y + bb.height / 2).matrixTransform(m);
  const sizes = panZoom.getSizes();
  panZoom.pan({
    x: sizes.width / 2 - c.x * sizes.realZoom,
    y: sizes.height / 2 - c.y * sizes.realZoom,
  });
}

function runSearch(query: string, opts: { pan?: boolean } = {}): void {
  clearSearchHighlights();
  searchMatches = [];
  searchCurrent = -1;
  const svg = galleryMode ? null : diagramEl.querySelector('svg');
  const q = query.trim().toLowerCase();
  if (!svg || !q) {
    searchCountEl.textContent = '';
    return;
  }
  const seen = new Set<Element>();
  for (const textEl of Array.from(svg.querySelectorAll('text, .nodeLabel'))) {
    if (!(textEl.textContent ?? '').toLowerCase().includes(q)) {
      continue;
    }
    const target = highlightTargetFor(textEl);
    if (!seen.has(target)) {
      seen.add(target);
      searchMatches.push(target);
    }
  }
  if (searchMatches.length === 0) {
    searchCountEl.textContent = '0';
    return;
  }
  for (const el of Array.from(svg.querySelectorAll(DIMMABLE_SELECTOR))) {
    const dimTarget = el.classList.contains('actor') ? (el.parentElement ?? el) : el;
    dimTarget.classList.add('sm-dim');
  }
  for (const match of searchMatches) {
    match.classList.remove('sm-dim');
  }
  setSearchCurrent(0, opts);
}

function openSearch(): void {
  if (galleryMode) {
    return; // v1 searches the current diagram only
  }
  searchBarEl.hidden = false;
  searchToggleBtn.classList.add('active');
  searchInputEl.focus();
  searchInputEl.select();
  runSearch(searchInputEl.value);
}

function closeSearch(): void {
  if (searchBarEl.hidden) {
    return;
  }
  searchBarEl.hidden = true;
  searchToggleBtn.classList.remove('active');
  clearSearchHighlights();
  searchMatches = [];
  searchCurrent = -1;
  searchCountEl.textContent = '';
}

searchToggleBtn.addEventListener('click', () => {
  if (searchBarEl.hidden) {
    openSearch();
  } else {
    closeSearch();
  }
});
searchInputEl.addEventListener('input', () => runSearch(searchInputEl.value));
searchInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    setSearchCurrent(searchCurrent + (e.shiftKey ? -1 : 1));
    e.preventDefault();
  } else if (e.key === 'Escape') {
    closeSearch();
    e.preventDefault();
    e.stopPropagation();
  }
});

// ─── Presentation mode ──────────────────────────────────────────────────────

const presCounterEl = document.getElementById('pres-counter') as HTMLDivElement;
const presHintEl = document.getElementById('pres-hint') as HTMLDivElement;
const presExitBtn = document.getElementById('pres-exit') as HTMLButtonElement;

let presentationMode = false;
let presHintTimer: ReturnType<typeof setTimeout> | undefined;

function updatePresCounter(): void {
  presCounterEl.textContent = `${activeIndex + 1} / ${blocks.length}`;
}

function enterPresentation(): void {
  if (presentationMode || blocks.length === 0) {
    return;
  }
  exitGallery();
  closeSearch();
  closeMenus();
  presentationMode = true;
  document.body.classList.add('presentation');
  presCounterEl.hidden = false;
  presExitBtn.hidden = false;
  updatePresCounter();
  presHintEl.hidden = false;
  presHintEl.classList.remove('fade');
  clearTimeout(presHintTimer);
  presHintTimer = setTimeout(() => presHintEl.classList.add('fade'), 2200);
  // Esc / arrows only reach us while the webview owns the keyboard — make sure of it.
  canvasEl.tabIndex = -1;
  canvasEl.focus();
  scheduleRender(); // fresh render fits the slide to the screen
}

function exitPresentation(): void {
  if (!presentationMode) {
    return;
  }
  presentationMode = false;
  clearTimeout(presHintTimer);
  document.body.classList.remove('presentation');
  presCounterEl.hidden = true;
  presExitBtn.hidden = true;
  presHintEl.hidden = true;
  // Sync the editor to wherever the presentation ended, and hand the
  // keyboard back to it — Esc means "back to editing".
  vscodeApi.postMessage({ type: 'revealBlock', index: activeIndex });
  vscodeApi.postMessage({ type: 'focusEditor' });
  scheduleRender();
}

presExitBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  exitPresentation();
});

/** Step slides; ±Infinity jumps to the first/last diagram (Home/End). */
function presStep(delta: number): void {
  const next = Math.min(Math.max(activeIndex + delta, 0), Math.max(0, blocks.length - 1));
  if (next === activeIndex) {
    return;
  }
  activeIndex = next;
  updatePresCounter();
  scheduleRender();
}

// ─── Export pipeline ────────────────────────────────────────────────────────

async function renderPristineSvg(
  source: string,
  opts: { silent?: boolean } = {},
): Promise<{ svg?: string; error?: string }> {
  const id = `mmd-export-${++exportSeq}`;
  try {
    // Render with htmlLabels disabled: no <foreignObject>, so the SVG stays
    // portable (Confluence, Inkscape, ...) and rasterizing it does not taint
    // the canvas during PNG export.
    // NOTE: mermaid 11.x's unified renderer reads the TOP-LEVEL htmlLabels
    // option, not flowchart.htmlLabels (verified against 11.15).
    const config = baseMermaidConfig();
    mermaid.initialize({
      ...config,
      htmlLabels: false,
      flowchart: { ...(config.flowchart ?? {}), htmlLabels: false },
    });
    return { svg: (await mermaid.render(id, source)).svg };
  } catch (err) {
    document.getElementById('d' + id)?.remove();
    const message = err instanceof Error ? err.message : String(err);
    if (!opts.silent) {
      showError(err, 'Export failed');
    }
    return { error: message };
  } finally {
    initMermaid();
  }
}

interface PreparedSvg {
  serialized: string;
  width: number;
  height: number;
}

function prepareSvgText(svgText: string): PreparedSvg | undefined {
  // Parse with the HTML parser (tolerant of mermaid's `<br>`-style void tags),
  // then let XMLSerializer emit well-formed standalone XML.
  const holder = document.createElement('div');
  holder.innerHTML = svgText;
  const svgEl = holder.querySelector('svg');
  if (!svgEl) {
    return undefined;
  }
  const viewBox = (svgEl.getAttribute('viewBox') ?? '0 0 800 600').split(/[\s,]+/).map(Number);
  const width = Math.max(1, Math.ceil(viewBox[2] || 800));
  const height = Math.max(1, Math.ceil(viewBox[3] || 600));
  svgEl.setAttribute('width', String(width));
  svgEl.setAttribute('height', String(height));
  svgEl.removeAttribute('style');
  if (themePref === 'colorful') {
    colorizeDiagram(svgEl, { dark: darkTheme });
  }
  return { serialized: new XMLSerializer().serializeToString(svgEl), width, height };
}

async function prepareExportSvgFor(
  source: string,
  opts: { silent?: boolean } = {},
): Promise<{ prepared?: PreparedSvg; error?: string }> {
  const result = await renderPristineSvg(source, opts);
  if (!result.svg) {
    return { error: result.error ?? 'render failed' };
  }
  const prepared = prepareSvgText(result.svg);
  return prepared ? { prepared } : { error: 'no svg output' };
}

async function rasterize(
  prepared: PreparedSvg,
  scale: number,
  opts: { mime: string; transparent: boolean },
): Promise<HTMLCanvasElement> {
  const blob = new Blob([prepared.serialized], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to rasterize SVG.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(prepared.width * scale));
    canvas.height = Math.max(1, Math.round(prepared.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable.');
    }
    // JPEG has no alpha channel — always paint a background for it.
    if (!opts.transparent || opts.mime === 'image/jpeg') {
      const background =
        getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim() ||
        (darkTheme ? '#1e1e1e' : '#ffffff');
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, prepared.width, prepared.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function rasterDataUrl(canvas: HTMLCanvasElement, format: RasterFormat): string {
  const mime = RASTER_MIME[format];
  return canvas.toDataURL(mime, format === 'png' ? undefined : 0.92);
}

/**
 * Some diagram types (e.g. journey) keep emitting <foreignObject> HTML labels
 * even with htmlLabels:false — drawing those onto a canvas taints it and
 * toDataURL throws. Raster paths fall back to SVG for such diagrams.
 */
function cannotRasterize(prepared: PreparedSvg): boolean {
  return prepared.serialized.includes('<foreignObject');
}

function exportBaseName(): string {
  return (
    (fileName.replace(/\.[^.]+$/, '') || 'diagram') + (blocks.length > 1 ? `-${activeIndex + 1}` : '')
  );
}

async function exportDiagram(format: 'svg' | RasterFormat): Promise<void> {
  const block = blocks[activeIndex];
  if (!block) {
    return;
  }
  const { prepared } = await prepareExportSvgFor(block.source);
  if (!prepared) {
    return;
  }
  if (format === 'svg') {
    vscodeApi.postMessage({
      type: 'export',
      format: 'svg',
      data: '<?xml version="1.0" encoding="UTF-8"?>\n' + prepared.serialized,
      suggestedName: `${exportBaseName()}.svg`,
    });
    return;
  }
  if (cannotRasterize(prepared)) {
    showToast('This diagram type cannot be rasterized — exported SVG instead');
    vscodeApi.postMessage({
      type: 'export',
      format: 'svg',
      data: '<?xml version="1.0" encoding="UTF-8"?>\n' + prepared.serialized,
      suggestedName: `${exportBaseName()}.svg`,
    });
    return;
  }
  try {
    if (format === 'jpg' && transparentBg) {
      showToast('JPEG has no transparency — background kept');
    }
    const canvas = await rasterize(prepared, pngScale, {
      mime: RASTER_MIME[format],
      transparent: transparentBg,
    });
    vscodeApi.postMessage({
      type: 'export',
      format,
      data: rasterDataUrl(canvas, format),
      suggestedName: `${exportBaseName()}.${format}`,
    });
  } catch (err) {
    showError(err, 'Export failed');
  }
}

async function copyImage(): Promise<void> {
  const block = blocks[activeIndex];
  if (!block) {
    return;
  }
  const { prepared } = await prepareExportSvgFor(block.source);
  if (!prepared) {
    return;
  }
  if (cannotRasterize(prepared)) {
    // Canvas would taint on foreignObject labels — share the SVG markup instead.
    showToast('This diagram type cannot be rasterized — copied SVG markup instead');
    vscodeApi.postMessage({
      type: 'copyText',
      text: '<?xml version="1.0" encoding="UTF-8"?>\n' + prepared.serialized,
      what: 'SVG markup',
    });
    return;
  }
  let canvas: HTMLCanvasElement;
  try {
    canvas = await rasterize(prepared, pngScale, { mime: 'image/png', transparent: transparentBg });
  } catch (err) {
    showError(err, 'Copy failed');
    return;
  }
  try {
    if (typeof ClipboardItem === 'undefined') {
      throw new Error('ClipboardItem unavailable');
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed.'))), 'image/png');
    });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    showToast(`Image copied (${pngScale}x)`);
  } catch {
    // Webview clipboards can be fussy — let the extension host go through the OS.
    vscodeApi.postMessage({ type: 'copyImageFallback', data: rasterDataUrl(canvas, 'png') });
  }
}

// ─── Export All ─────────────────────────────────────────────────────────────

let exportAllFormat: 'svg' | RasterFormat = 'png';

function requestExportAll(format: 'svg' | RasterFormat): void {
  if (exportAllInFlight || blocks.length === 0) {
    return;
  }
  exportAllFormat = format;
  vscodeApi.postMessage({
    type: 'exportAllRequest',
    format: exportAllFormat,
    count: blocks.length,
  });
}

function runExportAll(): void {
  if (exportAllInFlight) {
    return;
  }
  exportAllInFlight = true;
  exportAllCancelled = false;
  const format = exportAllFormat;
  enqueue(async () => {
    const snapshot = blocks.slice();
    const base = fileName.replace(/\.[^.]+$/, '') || 'diagram';
    for (let i = 0; i < snapshot.length; i++) {
      if (exportAllCancelled) {
        break;
      }
      showToast(`Exporting ${i + 1}/${snapshot.length}…`);
      const { prepared, error } = await prepareExportSvgFor(snapshot[i].source, { silent: true });
      if (!prepared) {
        vscodeApi.postMessage({
          type: 'exportAllError',
          index: i,
          label: snapshot[i].label,
          message: error ?? 'render failed',
        });
        continue;
      }
      let data: string;
      let fileFormat: string = format;
      if (format === 'svg' || cannotRasterize(prepared)) {
        // foreignObject-bearing diagrams (e.g. journey) fall back to SVG.
        fileFormat = 'svg';
        data = '<?xml version="1.0" encoding="UTF-8"?>\n' + prepared.serialized;
      } else {
        try {
          const canvas = await rasterize(prepared, pngScale, {
            mime: RASTER_MIME[format],
            transparent: transparentBg,
          });
          data = rasterDataUrl(canvas, format);
        } catch (err) {
          vscodeApi.postMessage({
            type: 'exportAllError',
            index: i,
            label: snapshot[i].label,
            message: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
      }
      vscodeApi.postMessage({
        type: 'exportAllFile',
        index: i,
        name: `${base}-${i + 1}.${fileFormat}`,
        data,
      });
    }
    vscodeApi.postMessage({ type: 'exportAllDone' });
    exportAllInFlight = false;
  });
}

// ─── Diagnostics (syntax validation for editor squiggles) ───────────────────

function errorLine(err: unknown): number | null {
  const hashLine = (err as { hash?: { loc?: { first_line?: number } } })?.hash?.loc?.first_line;
  if (typeof hashLine === 'number' && hashLine > 0) {
    return hashLine;
  }
  const message = err instanceof Error ? err.message : String(err);
  const m = message.match(/Parse error on line (\d+)/);
  return m ? Number(m[1]) : null;
}

async function validateBlocks(msg: UpdateMessage): Promise<void> {
  const errors: { index: number; message: string; line: number | null }[] = [];
  for (let i = 0; i < msg.blocks.length; i++) {
    try {
      await mermaid.parse(msg.blocks[i].source);
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      errors.push({ index: i, message, line: errorLine(err) });
    }
  }
  vscodeApi.postMessage({ type: 'diagnostics', uri: msg.uri, version: msg.version, errors });
}

// ─── Toolbar wiring ─────────────────────────────────────────────────────────

document.getElementById('zoom-in')!.addEventListener('click', () => {
  panZoom?.zoomBy(1.25);
  updateZoomLabel();
});
document.getElementById('zoom-out')!.addEventListener('click', () => {
  panZoom?.zoomBy(0.8);
  updateZoomLabel();
});
document.getElementById('zoom-reset')!.addEventListener('click', resetView);
document.getElementById('fit-width')!.addEventListener('click', fitWidth);
galleryToggleBtn.addEventListener('click', () => {
  if (galleryMode) {
    exitGallery();
  } else {
    enterGallery();
  }
});
zoomLabelEl.addEventListener('click', actualSize);
canvasEl.addEventListener('dblclick', (e) => {
  if (!galleryMode && e.target instanceof Node && !galleryEl.contains(e.target)) {
    resetView();
  }
});
window.addEventListener('resize', () => panZoom?.resize());

// ─── Dropdown menus (export ⬇ and more ⋯) ──────────────────────────────────

function closeMenus(): void {
  exportMenuEl.hidden = true;
  moreMenuEl.hidden = true;
  exportMenuBtn.classList.remove('active');
  moreBtn.classList.remove('active');
}

function toggleMenu(btn: HTMLButtonElement, menu: HTMLDivElement): void {
  const willOpen = menu.hidden;
  closeMenus();
  if (!willOpen) {
    return;
  }
  menu.hidden = false;
  btn.classList.add('active');
  // Anchor under the trigger button, clamped to the viewport.
  const btnRect = btn.getBoundingClientRect();
  const menuWidth = menu.offsetWidth;
  const left = Math.max(8, Math.min(btnRect.left, window.innerWidth - menuWidth - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${btnRect.bottom + 6}px`;
}

exportMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMenu(exportMenuBtn, exportMenuEl);
});
moreBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMenu(moreBtn, moreMenuEl);
});
document.addEventListener('click', (e) => {
  if (
    e.target instanceof Node &&
    !exportMenuEl.contains(e.target) &&
    !moreMenuEl.contains(e.target)
  ) {
    closeMenus();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') {
    return;
  }
  if (!exportMenuEl.hidden || !moreMenuEl.hidden) {
    closeMenus();
  } else if (!searchBarEl.hidden) {
    closeSearch();
  } else if (presentationMode) {
    exitPresentation();
  } else {
    // Nothing to dismiss — Esc returns to the source editor.
    vscodeApi.postMessage({ type: 'focusEditor' });
  }
});

for (const item of Array.from(exportMenuEl.querySelectorAll<HTMLButtonElement>('.menu-item[data-format]'))) {
  item.addEventListener('click', () => {
    const format = item.dataset.format as 'svg' | RasterFormat;
    closeMenus();
    enqueue(() => exportDiagram(format));
  });
}
document.getElementById('menu-copy-image')!.addEventListener('click', () => {
  closeMenus();
  enqueue(() => copyImage());
});
document.getElementById('menu-export-all-png')!.addEventListener('click', () => {
  closeMenus();
  requestExportAll('png');
});
document.getElementById('menu-export-all-svg')!.addEventListener('click', () => {
  closeMenus();
  requestExportAll('svg');
});

document.getElementById('menu-lock')!.addEventListener('click', () => {
  locked = !locked;
  menuLockLabelEl.textContent = locked
    ? 'Unlock — follow active editor'
    : 'Lock to current file';
  closeMenus();
  showToast(locked ? 'Locked to current file' : 'Following the active editor');
  vscodeApi.postMessage({ type: 'setLocked', locked });
});
/** Closest mermaid.live theme for the current preview style. */
function liveTheme(): string {
  if (themePref === 'colorful' || themePref === 'auto' || themePref === 'sketch') {
    return darkTheme ? 'dark' : 'default';
  }
  return themePref;
}

document.getElementById('share-live-btn')!.addEventListener('click', () => {
  const block = blocks[activeIndex];
  if (!block) {
    return;
  }
  vscodeApi.postMessage({ type: 'shareLive', code: block.source, theme: liveTheme() });
});
document.getElementById('menu-refresh')!.addEventListener('click', () => {
  closeMenus();
  if (galleryMode) {
    scheduleGallery();
  } else {
    scheduleRender({ keepView: true });
  }
});
document.getElementById('presentation-toggle')!.addEventListener('click', () => {
  enterPresentation();
});
document.getElementById('menu-fullscreen')!.addEventListener('click', () => {
  closeMenus();
  vscodeApi.postMessage({ type: 'toggleFullscreen' });
});
document.getElementById('menu-popout')!.addEventListener('click', () => {
  closeMenus();
  vscodeApi.postMessage({ type: 'popOut' });
});

themeSelectEl.addEventListener('change', () => {
  themePref = themeSelectEl.value as ThemePref;
  persist();
  // initMermaid must go through the queue: an in-flight export temporarily
  // swaps the global mermaid config and restores it when done.
  enqueue(async () => initMermaid());
  if (galleryMode) {
    scheduleGallery();
  } else {
    scheduleRender({ keepView: true });
  }
});

scaleSelectEl.addEventListener('change', () => {
  pngScale = Number(scaleSelectEl.value) || 2;
  persist();
});

bgCheckEl.addEventListener('change', () => {
  transparentBg = bgCheckEl.checked;
  persist();
});

selectEl.addEventListener('change', () => {
  activeIndex = Number(selectEl.value);
  scheduleRender();
  vscodeApi.postMessage({ type: 'revealBlock', index: activeIndex });
});

window.addEventListener('keydown', (e) => {
  if (
    (e.ctrlKey || e.metaKey) &&
    !e.shiftKey &&
    !e.altKey &&
    e.key.toLowerCase() === 'f' &&
    !galleryMode
  ) {
    openSearch();
    e.preventDefault();
    return;
  }
  if (
    e.target instanceof HTMLSelectElement ||
    e.target instanceof HTMLInputElement ||
    document.activeElement instanceof HTMLSelectElement ||
    document.activeElement instanceof HTMLInputElement ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey
  ) {
    return;
  }
  if (presentationMode) {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      presStep(1);
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      presStep(-1);
      e.preventDefault();
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      presStep(e.key === 'Home' ? -Infinity : Infinity);
      e.preventDefault();
      return;
    }
  }
  const zoomKeysActive = !galleryMode;
  if (zoomKeysActive && (e.key === '+' || e.key === '=')) {
    panZoom?.zoomBy(1.25);
    updateZoomLabel();
  } else if (zoomKeysActive && (e.key === '-' || e.key === '_')) {
    panZoom?.zoomBy(0.8);
    updateZoomLabel();
  } else if (zoomKeysActive && e.key === '0') {
    resetView();
  } else if (zoomKeysActive && e.key === '1') {
    actualSize();
  } else if (zoomKeysActive && e.key.toLowerCase() === 'w') {
    fitWidth();
  } else if (zoomKeysActive && !presentationMode && e.key === '/') {
    openSearch();
  } else if (zoomKeysActive && e.key.toLowerCase() === 'c') {
    enqueue(() => copyImage());
  } else if (e.key.toLowerCase() === 'p') {
    if (presentationMode) {
      exitPresentation();
    } else {
      enterPresentation();
    }
  } else if (e.key.toLowerCase() === 'g' && !presentationMode) {
    galleryToggleBtn.click();
  } else if (e.key.toLowerCase() === 'f') {
    vscodeApi.postMessage({ type: 'toggleFullscreen' });
  } else {
    return;
  }
  e.preventDefault();
});

// ─── Host messages ──────────────────────────────────────────────────────────

window.addEventListener('message', (event: MessageEvent<InMessage>) => {
  const msg = event.data;
  if (msg.type === 'update') {
    const keepView = msg.fileName === fileName && msg.activeIndex === activeIndex;
    fileName = msg.fileName;
    blocks = msg.blocks;
    activeIndex = Math.min(msg.activeIndex, Math.max(0, msg.blocks.length - 1));
    if (presentationMode) {
      if (blocks.length === 0) {
        exitPresentation();
      } else {
        updatePresCounter();
      }
    }
    if (galleryMode) {
      scheduleGallery();
    } else {
      scheduleRender({ keepView });
    }
    enqueue(() => validateBlocks(msg));
  } else if (msg.type === 'setActive' && msg.index !== activeIndex && !presentationMode) {
    activeIndex = msg.index;
    if (galleryMode) {
      highlightGalleryCard(msg.index);
    } else {
      scheduleRender();
    }
  } else if (msg.type === 'exportAllStart') {
    runExportAll();
  } else if (msg.type === 'exportAllCancel') {
    exportAllCancelled = true;
    exportAllInFlight = false;
  }
});

new MutationObserver(() => {
  if (isDarkTheme() !== darkTheme) {
    enqueue(async () => initMermaid());
    if (galleryMode) {
      scheduleGallery();
    } else {
      scheduleRender({ keepView: true });
    }
  }
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

initMermaid();
vscodeApi.postMessage({ type: 'ready' });
