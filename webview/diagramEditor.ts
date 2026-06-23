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
  type DiagramEditorHandle,
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
  const code = document.querySelector('#source-pre code') ?? byId('source-pre');
  if (code) code.textContent = text;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
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
  byId('dir-select')?.addEventListener('change', (e) => {
    h.setDirection((e.target as HTMLSelectElement).value as 'TB' | 'LR' | 'BT' | 'RL');
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
  const msg = event.data as { type: string; source?: string; dark?: boolean };
  if (msg.type === 'load') {
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
