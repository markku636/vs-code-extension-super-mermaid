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
  registerSequenceAdapter,
  type ArrowHead,
  type DiagramEditorHandle,
  type LineKind,
  type NodeShape,
  type Tool,
} from 'react-super-mermaid/editor';

registerFlowchartAdapter();
registerStateAdapter();
registerErAdapter();
registerClassAdapter();
registerMindmapAdapter();
registerSequenceAdapter();

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

// 箭頭端的友善名稱(下拉選單用)。flowchart 用前 5 種;三角 / 菱形 / 鳥足為 class/er 圖種。
const ARROW_LABEL: Record<string, string> = {
  none: '⎯ 無箭頭',
  arrow: '▸ 箭頭',
  open: '⇁ 開放',
  dot: '● 圓點',
  cross: '✕ 交叉',
  triangle: '▷ 三角(繼承)',
  diamond: '◇ 空心菱(聚合)',
  diamondFilled: '◆ 實心菱(組合)',
  crowFootOne: '⊣ 一',
  crowFootMany: '⪛ 多',
};

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

/** 依圖種顯示/隱藏建立控制項:sequence 用右鍵新增參與者/訊息(隱藏外形與連線);
 *  只有 flowchart/state/class/er 有流程方向;timeline 走表單,隱藏所有畫布工具。 */
function applyTypeUI(type: string): void {
  const seq = type === 'sequence';
  const timeline = type === 'timeline';
  const canvas = !timeline; // 畫布工具(選取/平移/縮放/整理/手繪)只在畫布圖種顯示
  const hasDir = canvas && ['flowchart', 'graph', 'state', 'class', 'er'].includes(type);
  const show = (el: Element | null, on: boolean): void => {
    if (el) (el as HTMLElement).style.display = on ? '' : 'none';
  };
  // 建立工具:sequence 與 timeline 都不用外形/連線(timeline 用左側表單)。
  document.querySelectorAll('[data-shape]').forEach((el) => show(el, !seq && !timeline));
  show(document.querySelector('[data-tool="edge-create"]'), !seq && !timeline);
  show(document.querySelector('[data-tool="select"]'), canvas);
  show(document.querySelector('[data-tool="pan"]'), canvas);
  show(document.querySelector('.tlabel'), !seq && !timeline);
  show(byId('dir-select'), hasDir);
  // 「更多外形」下拉:與一鍵外形同進退。
  show(byId('shape-select'), !seq && !timeline);

  // 連線樣式(線型 / 箭頭):依目前圖種能力顯示;sequence 走右鍵、timeline 無畫布。
  const caps = handle?.getCapabilities() ?? null;
  const lineKinds = caps?.lineKinds ?? [];
  const arrowHeads = caps?.arrowHeads ?? [];
  const edgeOk = canvas && !seq && caps !== null;
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

  // 純畫布操作(選取刪除 / 縮放 / 符合視窗 / 整理 / 手繪 / 快捷鍵說明):timeline 無畫布,一律隱藏。
  for (const id of ['btn-delete', 'btn-zoom-out', 'zoom-level', 'btn-zoom-in', 'btn-fit', 'btn-tidy', 'btn-look', 'btn-help']) {
    show(byId(id), canvas);
  }
  const hint = byId('seq-hint');
  if (hint) (hint as HTMLElement).hidden = !seq;
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
  document.querySelectorAll('[data-shape]').forEach((el) => {
    el.addEventListener('click', () => h.addNode(el.getAttribute('data-shape') as NodeShape));
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
        copyBtn.textContent = '✓ 已複製';
        setTimeout(() => {
          copyBtn.textContent = '⧉ 複製';
        }, 1400);
      })
      .catch(() => {
        copyBtn.textContent = '✗ 不支援';
        setTimeout(() => {
          copyBtn.textContent = '⧉ 複製';
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
  }
});

vscodeApi.postMessage({ type: 'ready' });
