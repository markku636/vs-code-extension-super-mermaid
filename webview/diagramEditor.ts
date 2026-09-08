// 繪製編輯器 webview(vanilla,IIFE)。直接 import react-super-mermaid 的框架無關 /editor 引擎,
// 注入本 webview 已 bundle 的 mermaid 實例(避免重複載入),並把序列化結果回傳給 extension 寫回原檔。

import mermaid from 'mermaid';
import {
  createDiagramEditor,
  registerFlowchartAdapter,
  registerStateAdapter,
  registerErAdapter,
  registerClassAdapter,
  registerMindmapAdapter,
  registerC4Adapter,
  registerKanbanAdapter,
  registerQuadrantAdapter,
  registerGanttAdapter,
  registerPieAdapter,
  registerArchitectureAdapter,
  registerBlockAdapter,
  registerPacketAdapter,
  registerGitgraphAdapter,
  registerXychartAdapter,
  registerJourneyAdapter,
  registerSankeyAdapter,
  registerRequirementAdapter,
  registerSequenceAdapter,
  shapeIconMarkup,
  shapeMeta,
  type ArrowHead,
  type DiagramCapabilities,
  type DiagramEditorHandle,
  type LineKind,
  type NodeShape,
  type Tool,
} from 'react-super-mermaid/editor';
import { initI18nFromDocument, t, tLib } from './i18n';

// Must run before any string is rendered: picks the dictionary matching the
// display language the host stamped on <body data-locale="…">.
initI18nFromDocument();

registerFlowchartAdapter();
registerStateAdapter();
registerErAdapter();
registerClassAdapter();
registerMindmapAdapter();
registerSequenceAdapter();
registerRequirementAdapter();
registerQuadrantAdapter();
registerC4Adapter();
registerKanbanAdapter();
registerSankeyAdapter();
registerJourneyAdapter();
registerGanttAdapter();
registerPieAdapter();
registerXychartAdapter();
registerArchitectureAdapter();
registerBlockAdapter();
registerPacketAdapter();
registerGitgraphAdapter();

interface VsCodeApi {
  postMessage(msg: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscodeApi = acquireVsCodeApi();
const app = document.getElementById('app') as HTMLElement;
const fontUri = document.body.getAttribute('data-font-uri') ?? undefined;

let handle: DiagramEditorHandle | null = null;
// 載入既有圖期間抑制寫回:避免「開啟即把原圖覆寫成序列化版本」。只有使用者實際編輯才寫回。
let suppressWriteBack = true;
// 內建「原始碼」面板:即時 mermaid(供顯示 / 複製)。
let lastCode = '';

function updateSourcePanel(text: string): void {
  lastCode = text;
  const ta = byId<HTMLTextAreaElement>('source-ta');
  // 使用者正在編輯 textarea 時不要覆寫,避免打字被畫布更新蓋掉。
  if (ta && document.activeElement !== ta) {
    ta.value = text;
    ta.classList.remove('src-error');
  }
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/**
 * Translate the pieces react-super-mermaid renders on its own.
 *
 * Its keyboard-help overlay and right-click menu are hard-coded zh-TW with no
 * hook to supply other strings, so the editor rewrites their text once the
 * library has appended them to the canvas host (see watchLibDom below).
 */
const LIB_TEXT_SELECTOR = '.rsm-ctx-item, .rsm-help-title, .rsm-help-grid > kbd, .rsm-help-grid > span';

function localizeLibDom(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(LIB_TEXT_SELECTOR))) {
    const translated = tLib(el.textContent ?? '');
    if (translated !== el.textContent) el.textContent = translated;
  }
  // 外形列的說明只出現在 tooltip,textContent 是字形本身,不能動。
  for (const btn of Array.from(root.querySelectorAll<HTMLElement>('.rsm-ctx-shapes button[title]'))) {
    const translated = tLib(btn.title);
    if (translated !== btn.title) btn.title = translated;
  }
}

/**
 * Keep the right-click menu alive long enough for the click to land.
 *
 * react-super-mermaid closes the menu from a `pointerdown` listener on
 * `document`, and that fires before the item's own `click`: the item is out of
 * the DOM by the time the click would be dispatched, so no menu command ever
 * ran. Holding the pointerdown inside the menu back from `document` leaves the
 * closing to the item handler, which calls the library's own close first.
 */
function keepMenuUntilClick(menu: HTMLElement): void {
  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
}

/** 選單 / 說明是使用時才建立的,所以用 observer 在它們掛上畫布的當下就翻好。 */
function watchLibDom(host: HTMLElement): void {
  const observer = new MutationObserver((records) => {
    for (const rec of records) {
      for (const added of Array.from(rec.addedNodes)) {
        if (!(added instanceof HTMLElement)) continue;
        localizeLibDom(added);
        if (added.classList.contains('rsm-ctx')) keepMenuUntilClick(added);
        for (const menu of Array.from(added.querySelectorAll<HTMLElement>('.rsm-ctx'))) {
          keepMenuUntilClick(menu);
        }
      }
    }
  });
  observer.observe(host, { childList: true, subtree: true });
}

/** Fields where a keystroke belongs to the field, not to the canvas. */
function isTypingTarget(el: HTMLElement): boolean {
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Route the canvas shortcuts to the canvas whatever holds the focus.
 *
 * The library binds its keydown handler to the canvas host and never focuses
 * it, so on a freshly opened panel the focus is still on <body> and every
 * shortcut — Delete, ?, Ctrl+Z, the arrow nudges — is dead until the drawing is
 * clicked. Worse, each toolbar click parks the focus on a button and kills them
 * again. So the webview replays the event on the host unless the focus is
 * already inside the canvas or in a field that must keep its own keys.
 * `preventDefault` is mirrored back, otherwise Ctrl+A / Ctrl+D would also run
 * the browser's own action.
 *
 * On `window` in the capture phase, and deliberately without a
 * `defaultPrevented` bail: inside a VS Code webview the page shares the keydown
 * with the workbench's own keybinding dispatch, and a shortcut that VS Code has
 * already claimed must still reach the canvas. What this cannot fix is a
 * keystroke that never arrives — VS Code hands keys to whatever *it* considers
 * focused, so the panel needs one click (or to be the active tab) first.
 */
function forwardHotkeys(host: HTMLElement): void {
  window.addEventListener(
    'keydown',
    (e) => {
      seenInPage.set(strokeSig(e.key, e.ctrlKey || e.metaKey, e.shiftKey), Date.now());
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target && (host.contains(target) || isTypingTarget(target))) return;
      const replay = new KeyboardEvent('keydown', {
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        repeat: e.repeat,
        bubbles: false,
        cancelable: true,
      });
      if (!host.dispatchEvent(replay)) e.preventDefault();
    },
    true,
  );
}

/** A shortcut as the host sends it (mirrors `contributes.keybindings`' args). */
interface Stroke {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
}

function strokeSig(key: string, ctrl: boolean, shift: boolean): string {
  return `${ctrl ? 'c' : ''}${shift ? 's' : ''}${key.toLowerCase()}`;
}

/**
 * When each shortcut last arrived as a real keystroke in this page.
 *
 * The host route below fires for the *same* physical keypress, just later (page
 * keydown → VS Code keybinding → command → postMessage), so a stroke recorded
 * here means the canvas already had its chance — including the case where the
 * chance was "a textarea has the focus, so the canvas must stay out of it".
 */
const seenInPage = new Map<string, number>();
const HOST_KEY_GRACE_MS = 400;

/**
 * Run a shortcut that came from a VS Code keybinding.
 *
 * Keys only reach a webview when VS Code considers the webview focused, and a
 * panel can be the active tab with the focus still parked in the workbench — so
 * a page-only listener can never be the whole answer. The panel therefore also
 * contributes real keybindings scoped to `activeWebviewPanelId`, and each one
 * lands here to be replayed on the canvas host, which keeps the library's own
 * handler as the single implementation of every shortcut.
 */
function applyHostKey(host: HTMLElement, stroke: Stroke): void {
  const sig = strokeSig(stroke.key, Boolean(stroke.ctrl), Boolean(stroke.shift));
  const seen = seenInPage.get(sig) ?? 0;
  if (Date.now() - seen < HOST_KEY_GRACE_MS) return; // the page already handled it
  host.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: stroke.key,
      ctrlKey: Boolean(stroke.ctrl),
      shiftKey: Boolean(stroke.shift),
      bubbles: false,
      cancelable: true,
    }),
  );
}

// 箭頭端的友善名稱(下拉選單用)。flowchart 用前 5 種;三角 / 菱形 / 鳥足為 class/er 圖種。
const ARROW_LABEL: Record<string, string> = {
  none: t('⎯ no arrow'),
  arrow: t('▸ arrow'),
  open: t('⇁ open'),
  dot: t('● dot'),
  cross: t('✕ cross'),
  triangle: t('▷ triangle (inheritance)'),
  diamond: t('◇ hollow diamond (aggregation)'),
  diamondFilled: t('◆ filled diamond (composition)'),
  crowFootOne: t('⊣ one'),
  crowFootMany: t('⪛ many'),
};

/**
 * Node-shape captions.
 *
 * react-super-mermaid's own shapeMeta().label is zh-TW only, so the editor
 * keeps its own table; an unknown shape falls back to the library's label so a
 * newly added shape still shows something rather than its id.
 */
const SHAPE_LABEL: Record<string, string> = {
  // flowchart
  rectangle: 'rectangle',
  rounded: 'rounded',
  stadium: 'stadium',
  subroutine: 'subroutine',
  cylinder: 'database',
  circle: 'circle',
  doubleCircle: 'double circle',
  diamond: 'diamond',
  hexagon: 'hexagon',
  odd: 'flag',
  trapezoid: 'trapezoid',
  trapezoidAlt: 'trapezoid (inverted)',
  parallelogram: 'parallelogram',
  parallelogramAlt: 'parallelogram (left)',
  ellipse: 'ellipse',
  // state
  state: 'state',
  stateStart: 'start',
  stateEnd: 'end',
  fork: 'fork / join',
  choice: 'choice',
  // class / er / sequence
  classBox: 'class',
  entity: 'entity',
  actor: 'actor',
  participant: 'participant',
  note: 'note',
  // requirement
  requirementBox: 'requirement',
  elementBox: 'element',
  // quadrant / xychart
  point: 'data point',
  xyPoint: 'data point',
  // C4
  c4Person: 'person',
  c4Box: 'system',
  c4Db: 'database',
  c4Queue: 'queue',
  // kanban / sankey / journey / gantt / pie / architecture / packet / git
  kanbanCard: 'card',
  sankeyNode: 'node',
  journeyTask: 'task',
  ganttBar: 'task',
  pieSlice: 'slice',
  archNode: 'service',
  packetField: 'field',
  gitCommit: 'commit',
  passthrough: 'kept as-is',
};

/** Translated caption for a node shape. */
function shapeLabel(shape: string, fallback: string): string {
  const source = SHAPE_LABEL[shape];
  return source ? t(source) : fallback;
}

/** 依目前圖種能力重建箭頭下拉的選項(保留現值)。 */
function rebuildArrowOptions(sel: HTMLSelectElement, heads: readonly string[]): void {
  const cur = sel.value;
  sel.textContent = '';
  for (const head of heads) {
    const opt = document.createElement('option');
    opt.value = head;
    opt.textContent = ARROW_LABEL[head] ?? head;
    sel.appendChild(opt);
  }
  if (heads.includes(cur)) sel.value = cur;
}

/** 把連線控制項同步成指定樣式(新連線預設 / 選取連線)。 */
function syncEdgeControls(style: { lineKind: string; arrowStart: string; arrowEnd: string }): void {
  document.querySelectorAll('[data-linekind]').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('data-linekind') === style.lineKind);
  });
  const arrowSel = byId<HTMLSelectElement>('arrow-select');
  if (arrowSel && Array.from(arrowSel.options).some((o) => o.value === style.arrowEnd)) {
    arrowSel.value = style.arrowEnd;
  }
  byId('btn-bidir')?.classList.toggle('active', style.arrowStart !== 'none');
}

/** 用 host 傳來的 block 清單重建「切換圖表」下拉;只有 1 張(或無)時隱藏。 */
function populateDiagramSelect(blocks?: Array<{ index: number; label: string }>, activeIndex?: number): void {
  const sel = byId<HTMLSelectElement>('diagram-select');
  if (!sel) return;
  if (!blocks || blocks.length <= 1) {
    sel.style.display = 'none';
    return;
  }
  sel.style.display = '';
  sel.textContent = '';
  for (const b of blocks) {
    const opt = document.createElement('option');
    opt.value = String(b.index);
    opt.textContent = b.label;
    sel.appendChild(opt);
  }
  sel.value = String(activeIndex ?? 0);
}

/**
 * 依目前圖種的 adapter 能力重建「新增外形」按鈕列 + 「更多外形」下拉。
 *
 * 這些按鈕以前是寫死在 HTML 裡的七顆 flowchart 外形,於是在類別圖 / ER 圖 / 狀態圖上
 * 按下去會建出該圖種序列化不出來的外形。改成 quickShapes / 其餘進下拉,兩邊(React 工具列
 * 與本 webview)共用 core 的 shapeMeta 字形表。
 */
function rebuildShapeButtons(caps: DiagramCapabilities | null): void {
  const group = byId('shape-group');
  const sel = byId<HTMLSelectElement>('shape-select');
  const all = caps?.shapes ?? [];
  const quick = caps?.quickShapes ?? all;
  const more = all.filter((s) => !quick.includes(s));
  if (group) {
    group.textContent = '';
    for (const shape of quick) {
      const m = shapeMeta(shape);
      const label = shapeLabel(shape, m.label);
      const btn = document.createElement('button');
      btn.className = 'tbtn shape-btn';
      btn.setAttribute('data-shape', shape);
      btn.title = t('Add a {0} node', label);
      // 圖示是 core 產的常數 SVG(無使用者輸入);字形縮圖在多數系統字型下畫不出來。
      btn.innerHTML = shapeIconMarkup(shape);
      btn.appendChild(document.createTextNode(label));
      group.appendChild(btn);
    }
  }
  if (sel) {
    sel.textContent = '';
    const head = document.createElement('option');
    head.value = '';
    head.textContent = t('＋ more shapes…');
    sel.appendChild(head);
    for (const shape of more) {
      const m = shapeMeta(shape);
      const opt = document.createElement('option');
      opt.value = shape;
      opt.textContent = `${m.glyph} ${shapeLabel(shape, m.label)}`;
      sel.appendChild(opt);
    }
    sel.dataset.hasMore = more.length ? '1' : '';
  }
}

/** 依圖種顯示/隱藏建立控制項:sequence 用右鍵新增參與者/訊息(隱藏外形與連線);
 *  只有 flowchart/state/class/er 有流程方向;timeline / orid 走表單,隱藏所有畫布工具。 */
function applyTypeUI(type: string): void {
  const seq = type === 'sequence';
  // 資料圖表(timeline / orid)由 form 子編輯器接管,整條畫布工具列都沒有意義。
  const formMode = type === 'timeline' || type === 'orid';
  const canvas = !formMode; // 畫布工具(選取/平移/縮放/整理/手繪)只在畫布圖種顯示
  const hasDir = canvas && ['flowchart', 'graph', 'state', 'class', 'er', 'requirement'].includes(type);
  // 需求圖的連線意義由「關係種類」決定(右鍵切換),沒有線型 / 箭頭可調。
  const req = type === 'requirement';
  // 象限圖的點位置就是資料 → 自動排版會竄改數值,不給「整理」。
  const quadrant = type === 'quadrant';
  const show = (el: Element | null, on: boolean): void => {
    if (el) (el as HTMLElement).style.display = on ? '' : 'none';
  };
  // 連線樣式(線型 / 箭頭):依目前圖種能力顯示;sequence 走右鍵、資料圖表無畫布。
  const caps = handle?.getCapabilities() ?? null;
  // 建立工具:sequence 與資料圖表都不用外形/連線(資料圖表用左側表單)。
  rebuildShapeButtons(!seq && !formMode ? caps : null);
  show(byId('shape-group'), !seq && !formMode);
  // 有沒有連線這回事由 adapter 能力決定(而不是在這裡列圖種名單)。
  const hasEdges = caps?.supportsEdges !== false;
  show(document.querySelector('[data-tool="edge-create"]'), !seq && !formMode && hasEdges);
  show(document.querySelector('[data-tool="select"]'), canvas);
  show(document.querySelector('[data-tool="pan"]'), canvas);
  show(document.querySelector('.tlabel'), !seq && !formMode);
  show(byId('dir-select'), hasDir);
  // 「更多外形」下拉:只有真的還有其他外形時才出現(class / er 只有一種,出現只會是顆空殼)。
  show(byId('shape-select'), !seq && !formMode && Boolean(byId<HTMLSelectElement>('shape-select')?.dataset.hasMore));

  const lineKinds = caps?.lineKinds ?? [];
  const arrowHeads = caps?.arrowHeads ?? [];
  // C4 的關係也只有 Rel / BiRel 與方向變體,不吃線型 / 箭頭。
  const edgeOk = canvas && !seq && !req && hasEdges && type !== 'c4' && caps !== null;
  const showLine = edgeOk && lineKinds.length > 1;
  const showArrow = edgeOk && arrowHeads.length > 1;
  show(byId('edge-style'), showLine || showArrow);
  show(byId('line-label'), showLine);
  document.querySelectorAll('[data-linekind]').forEach((el) => {
    show(el, showLine && lineKinds.includes(el.getAttribute('data-linekind') as LineKind));
  });
  const arrowSel = byId<HTMLSelectElement>('arrow-select');
  if (arrowSel) {
    rebuildArrowOptions(arrowSel, arrowHeads);
    show(arrowSel, showArrow);
  }
  show(byId('btn-bidir'), edgeOk && arrowHeads.includes('arrow' as ArrowHead) && (type === 'flowchart' || type === 'graph'));
  if (handle) syncEdgeControls(handle.getEdgeStyleDefault());

  // 純畫布操作(選取刪除 / 縮放 / 符合視窗 / 整理 / 手繪 / 快捷鍵說明):資料圖表無畫布,一律隱藏。
  for (const id of ['btn-delete', 'btn-zoom-out', 'zoom-level', 'btn-zoom-in', 'btn-fit', 'btn-look', 'btn-help']) {
    show(byId(id), canvas);
  }
  show(byId('btn-tidy'), canvas && !quadrant);
  const hint = byId('seq-hint');
  if (hint) (hint as HTMLElement).hidden = !seq;
  const seqGroup = byId('seq-group');
  if (seqGroup) (seqGroup as HTMLElement).hidden = !seq;
  syncSeqSelectionUI();
}

/**
 * 「作用在選取的那則訊息」的按鈕:有選才出現。
 *
 * 訊息 / 筆記不是 node,引擎以 `seq:{index}` 這個假 id 放進選取集合(見 lib 的 refreshOverlay),
 * 所以這裡用前綴判斷,而不是去 scene.nodes 裡找。
 */
function syncSeqSelectionUI(): void {
  const group = byId('seq-sel-group');
  if (!group) return;
  const isSeq = handle?.getScene().diagramType === 'sequence';
  const picked = (handle?.getSelection() ?? []).some((id) => id.startsWith('seq:'));
  (group as HTMLElement).hidden = !isSeq || !picked;
}

function setActiveTool(tool: Tool): void {
  document.querySelectorAll('[data-tool]').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('data-tool') === tool);
  });
}

function wireToolbar(h: DiagramEditorHandle): void {
  document.querySelectorAll('[data-tool]').forEach((el) => {
    el.addEventListener('click', () => h.setTool(el.getAttribute('data-tool') as Tool));
  });
  // 常用外形按鈕:點一下直接在畫布中央放節點(免下拉選單、免再點畫布)。
  // 用事件委派 —— 按鈕會隨圖種重建(rebuildShapeButtons),逐顆綁定會在重建後全部失效。
  byId('shape-group')?.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest('[data-shape]');
    if (btn) h.addNode(btn.getAttribute('data-shape') as NodeShape);
  });
  // 「更多外形」下拉:選一個就新增該外形,再重設回提示。
  byId('shape-select')?.addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    if (sel.value) h.addNode(sel.value as NodeShape);
    sel.value = '';
  });
  // 連線線型:套到選取的連線(若有)+ 設為新連線預設。
  document.querySelectorAll('[data-linekind]').forEach((el) => {
    el.addEventListener('click', () => {
      h.applyEdgeStyle({ lineKind: el.getAttribute('data-linekind') as LineKind });
      syncEdgeControls(h.getEdgeStyleDefault());
    });
  });
  byId('arrow-select')?.addEventListener('change', (e) => {
    h.applyEdgeStyle({ arrowEnd: (e.target as HTMLSelectElement).value as ArrowHead });
  });
  byId('btn-bidir')?.addEventListener('click', () => {
    const cur = h.getEdgeStyleDefault();
    h.applyEdgeStyle({ arrowStart: cur.arrowStart === 'none' ? 'arrow' : 'none' });
    syncEdgeControls(h.getEdgeStyleDefault());
  });
  // 選到單一連線 → 控制項反映該連線目前的樣式。
  h.on('selectionchange', (ids) => {
    const sel = ids as string[];
    syncSeqSelectionUI();
    if (sel.length !== 1) return;
    const e = h.getScene().edges.find((x) => x.id === sel[0]);
    if (e) syncEdgeControls({ lineKind: e.lineKind, arrowStart: e.arrowStart, arrowEnd: e.arrowEnd });
  });
  byId('btn-undo')?.addEventListener('click', () => h.undo());
  byId('btn-redo')?.addEventListener('click', () => h.redo());
  byId('btn-delete')?.addEventListener('click', () => h.deleteSelection());
  byId('btn-zoom-in')?.addEventListener('click', () => h.zoomIn());
  byId('btn-zoom-out')?.addEventListener('click', () => h.zoomOut());
  byId('btn-fit')?.addEventListener('click', () => h.fit());
  byId('btn-tidy')?.addEventListener('click', () => void h.tidy());
  // sequence 建立動作 —— 與右鍵選單同一組指令,只是搬到看得見的地方。
  byId('btn-seq-participant')?.addEventListener('click', () => h.addSeqParticipant());
  byId('btn-seq-message')?.addEventListener('click', () => h.addSeqMessage());
  byId('btn-seq-note')?.addEventListener('click', () => h.addSeqNote());
  byId('btn-seq-edit')?.addEventListener('click', () => h.editSelection());
  byId('btn-seq-arrow')?.addEventListener('click', () => h.toggleSeqArrow());
  // webview 無法直接觸發 <a download>;改把資料 postMessage 給 host,由 host 開儲存對話框寫檔。
  byId('btn-svg')?.addEventListener('click', () => {
    vscodeApi.postMessage({ type: 'export', format: 'svg', data: h.exportSvg(), suggestedName: 'diagram.svg' });
  });
  byId('btn-png')?.addEventListener('click', () => {
    void h.exportPng().then((blob) => {
      const reader = new FileReader();
      reader.onload = () =>
        vscodeApi.postMessage({ type: 'export', format: 'png', data: reader.result, suggestedName: 'diagram.png' });
      reader.readAsDataURL(blob);
    });
  });
  const copyBtn = byId('btn-copy') as HTMLButtonElement | null;
  copyBtn?.addEventListener('click', () => {
    void h
      .copyPngToClipboard()
      .then(() => {
        copyBtn.textContent = t('✓ copied');
        setTimeout(() => {
          copyBtn.textContent = t('⧉ copy');
        }, 1400);
      })
      .catch(() => {
        copyBtn.textContent = t('✗ unsupported');
        setTimeout(() => {
          copyBtn.textContent = t('⧉ copy');
        }, 1400);
      });
  });
  byId('btn-source')?.addEventListener('click', () => {
    const panel = byId('source-panel');
    if (!panel) return;
    const show = panel.hasAttribute('hidden');
    panel.toggleAttribute('hidden', !show);
    byId('btn-source')?.classList.toggle('active', show);
  });
  byId('btn-copy-src')?.addEventListener('click', () => {
    void navigator.clipboard?.writeText(lastCode).catch(() => {});
  });
  // 面板自己的關閉鈕。工具列那顆 </> 原始碼 的 active 狀態要一起收掉。
  byId('btn-close-src')?.addEventListener('click', () => {
    byId('source-panel')?.toggleAttribute('hidden', true);
    byId('btn-source')?.classList.remove('active');
  });
  const applySrc = (): void => {
    const ta = byId<HTMLTextAreaElement>('source-ta');
    if (!ta) return;
    void h
      .loadSource(ta.value)
      .then(() => ta.classList.remove('src-error'))
      .catch(() => ta.classList.add('src-error'));
  };
  byId('btn-help')?.addEventListener('click', () => h.toggleHelp());
  const lookBtn = byId('btn-look') as HTMLButtonElement | null;
  const syncLookBtn = (): void => {
    if (lookBtn) lookBtn.classList.toggle('active', h.getLook() === 'sketch');
  };
  lookBtn?.addEventListener('click', () => {
    h.setLook(h.getLook() === 'sketch' ? 'clean' : 'sketch');
    syncLookBtn();
  });
  byId('btn-apply-src')?.addEventListener('click', applySrc);
  byId('source-ta')?.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    if ((ke.ctrlKey || ke.metaKey) && ke.key === 'Enter') {
      ke.preventDefault();
      applySrc();
    }
  });
  byId('dir-select')?.addEventListener('change', (e) => {
    h.setDirection((e.target as HTMLSelectElement).value as 'TB' | 'LR' | 'BT' | 'RL');
  });
  // 切換此檔的其他圖表(由 host 重新 loadSource;不經 handle,故與圖種無關)。
  byId('diagram-select')?.addEventListener('change', (e) => {
    vscodeApi.postMessage({ type: 'selectBlock', index: Number((e.target as HTMLSelectElement).value) });
  });
  h.on('toolchange', (t) => setActiveTool(t as Tool));
  h.on('zoomchange', (p) => {
    const el = byId('zoom-level');
    if (el) el.textContent = `${p as number}%`;
  });
  h.on('historychange', (s) => {
    const st = s as { canUndo: boolean; canRedo: boolean };
    (byId('btn-undo') as HTMLButtonElement | null)?.toggleAttribute('disabled', !st.canUndo);
    (byId('btn-redo') as HTMLButtonElement | null)?.toggleAttribute('disabled', !st.canRedo);
  });
}

window.addEventListener('message', (event) => {
  const msg = event.data as {
    type: string;
    source?: string;
    dark?: boolean;
    blocks?: Array<{ index: number; label: string }>;
    activeIndex?: number;
    stroke?: Stroke;
  };
  if (msg.type === 'load') {
    populateDiagramSelect(msg.blocks, msg.activeIndex);
    if (!handle) {
      // 不在建構時帶 source —— 改用 loadSource 並全程抑制寫回,確保「開啟既有圖」不會覆寫原檔。
      handle = createDiagramEditor(app, {
        mermaid: { instance: mermaid as never },
        dark: msg.dark,
        fontUrl: fontUri,
        look: 'clean',
      });
      watchLibDom(app);
      forwardHotkeys(app);
      handle.on('mermaidchange', (text) => {
        updateSourcePanel(text as string); // 即時更新原始碼面板(載入期間也更新)
        if (suppressWriteBack) return;
        vscodeApi.postMessage({ type: 'mermaidchange', text: text as string });
      });
      handle.on('error', (err) =>
        vscodeApi.postMessage({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      wireToolbar(handle);
    }
    suppressWriteBack = true;
    void handle
      .loadSource(msg.source ?? '')
      .catch(() => {})
      .finally(() => {
        applyTypeUI(handle ? handle.getScene().diagramType : 'flowchart');
        // 載入(含 layout)安定後才開放寫回;之後使用者的編輯才會回寫文件。
        setTimeout(() => {
          suppressWriteBack = false;
        }, 400);
      });
  } else if (msg.type === 'theme') {
    handle?.setDark(Boolean(msg.dark));
  } else if (msg.type === 'key' && msg.stroke) {
    // 工具列與畫布之外的焦點:快捷鍵由 host 的 keybinding 送進來(見 applyHostKey)。
    applyHostKey(app, msg.stroke);
  }
});

// 介面語言下拉:工具列字串由 host 產生,所以只把選擇送回去,由 host 寫設定並重建整份 HTML。
// 刻意不放在 wireToolbar 裡 —— 那要等圖載入成功才會執行,而語言在圖壞掉時更需要能切。
byId<HTMLSelectElement>('lang-select')?.addEventListener('change', (e) => {
  vscodeApi.postMessage({
    type: 'setLanguage',
    language: (e.target as HTMLSelectElement).value,
  });
});

vscodeApi.postMessage({ type: 'ready' });
