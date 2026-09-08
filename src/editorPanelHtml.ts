// 繪製編輯器 webview 的 body 標記(工具列 + 畫布 + 原始碼面板)。
//
// 抽出來的原因:除了 EditorPanel 之外,scripts/verifyEditorUi.mjs 也要用「一模一樣」的標記
// 在 headless Chrome 裡把編輯器跑起來截圖。若兩邊各留一份,測到的就不是使用者看到的那個工具列。
// 這裡刻意不含任何 webview URI / nonce —— 那些由 EditorPanel 在外層組。
//
// This module must stay free of `import * as vscode` — verifyEditorUi.mjs
// bundles it on its own, outside the extension host. The translator is passed
// in instead: EditorPanel hands over `vscode.l10n.t`, the verify script (and
// any other plain-node consumer) gets the English source strings by default.

/** Translator signature; matches `vscode.l10n.t(message)`. */
export type Translate = (message: string) => string;

const identity: Translate = (message) => message;

/**
 * Interface-language choices in the toolbar picker.
 *
 * Kept here rather than imported from uiLocale.ts on purpose: that module pulls
 * in `vscode`, and this one must stay loadable outside the extension host.
 * The names are written in their own language — someone looking for "Русский"
 * on an English UI should still recognise it.
 */
export const UI_LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'auto', label: '' }, // label comes from the translated "Auto"
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
  { value: 'zh-tw', label: '繁體中文' },
];

function languageOptions(t: Translate, current: string): string {
  return UI_LANGUAGES.map(({ value, label }) => {
    const selected = value === current ? ' selected' : '';
    return `<option value="${value}"${selected}>🌐 ${label || t('Auto')}</option>`;
  }).join('');
}

/**
 * @param t        translator for the toolbar labels
 * @param language current `superMermaid.language` setting (drives the picker)
 */
export function buildEditorBodyHtml(t: Translate = identity, language = 'auto'): string {
  return `  <div id="toolbar">
    <select id="diagram-select" class="tbtn" title="${t('Switch to another diagram in this file')}" style="display:none"></select>
    <button class="tbtn" data-tool="select" title="${t('Select / move (V)')}">➤ ${t('Select')}</button>
    <button class="tbtn" data-tool="edge-create" title="${t('Drag an edge out of a node (E)')}">↘ ${t('Edge')}</button>
    <button class="tbtn" data-tool="pan" title="${t('Pan the canvas')}">✋ ${t('Pan')}</button>
    <span class="spacer"></span>
    <span class="tlabel">${t('Add:')}</span>
    <!-- 外形按鈕由 webview 依目前圖種的 adapter 能力生成(類別圖不該看到「菱形 / 圓柱」)。 -->
    <span id="shape-group"></span>
    <select id="shape-select" class="tbtn" title="${t('More shapes (add a node)')}"></select>
    <!-- 介面語言:工具列字串由 host 產生,故切換語言 = 請 host 用新語言重建整份 HTML。 -->
    <span class="spacer"></span>
    <select id="lang-select" class="tbtn" title="${t('Interface language')}" aria-label="${t('Interface language')}">${languageOptions(t, language)}</select>
    <!-- sequence 的建立動作。以前只在右鍵選單裡,不右鍵就發現不了,序列圖因此是工具列最空的圖種。 -->
    <span id="seq-group" hidden>
      <button class="tbtn" id="btn-seq-participant" title="${t('Add a participant (rename it right away)')}">＋ ${t('Participant')}</button>
      <button class="tbtn" id="btn-seq-message" title="${t('Append a message (edit its text right away)')}">＋ ${t('Message')}</button>
      <button class="tbtn" id="btn-seq-note" title="${t('Append a note (edit its text right away)')}">＋ ${t('Note')}</button>
    </span>
    <!-- 作用在「選到的那則訊息」上,沒選就整組隱藏 —— 按不動的按鈕比沒有更擾人。 -->
    <span id="seq-sel-group" hidden>
      <span class="spacer"></span>
      <button class="tbtn" id="btn-seq-edit" title="${t('Edit the text of this one (double-click works too)')}">✎ ${t('Text')}</button>
      <button class="tbtn" id="btn-seq-arrow" title="${t('Toggle solid / dashed arrow')}">⇢ ${t('Solid / dashed')}</button>
    </span>
    <span id="seq-hint" class="tlabel" hidden>${t('Drag participants to reorder, drag messages up/down to resequence · Delete removes the selection')}</span>
    <span id="edge-style">
      <span class="spacer"></span>
      <span id="line-label" class="tlabel">${t('Line:')}</span>
      <button class="tbtn line-btn" data-linekind="solid" title="${t('Solid')}" aria-label="${t('Solid')}"><svg width="26" height="10" viewBox="0 0 26 10"><line x1="2" y1="5" x2="24" y2="5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      <button class="tbtn line-btn" data-linekind="dotted" title="${t('Dashed')}" aria-label="${t('Dashed')}"><svg width="26" height="10" viewBox="0 0 26 10"><line x1="2" y1="5" x2="24" y2="5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="2 4"/></svg></button>
      <button class="tbtn line-btn" data-linekind="thick" title="${t('Thick')}" aria-label="${t('Thick')}"><svg width="26" height="10" viewBox="0 0 26 10"><line x1="2" y1="5" x2="24" y2="5" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg></button>
      <button class="tbtn line-btn" data-linekind="invisible" title="${t('Invisible (the edge is not drawn)')}" aria-label="${t('Invisible')}"><svg width="26" height="10" viewBox="0 0 26 10"><line x1="2" y1="5" x2="24" y2="5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="1 4" stroke-opacity="0.4"/></svg></button>
      <select id="arrow-select" class="tbtn" title="${t('Arrow style (applied to the selected edge / default for new edges)')}"></select>
      <button class="tbtn" id="btn-bidir" title="${t('Bidirectional arrow (arrowhead at the start too)')}">⇄ ${t('Both ways')}</button>
    </span>
    <select id="dir-select" class="tbtn" title="${t('Flow direction')}">
      <option value="TB">↓ ${t('Top to bottom')}</option>
      <option value="LR">→ ${t('Left to right')}</option>
      <option value="BT">↑ ${t('Bottom to top')}</option>
      <option value="RL">← ${t('Right to left')}</option>
    </select>
    <span class="spacer"></span>
    <button class="tbtn" id="btn-undo" title="${t('Undo (Ctrl+Z)')}">↶</button>
    <button class="tbtn" id="btn-redo" title="${t('Redo (Ctrl+Y)')}">↷</button>
    <button class="tbtn" id="btn-delete" title="${t('Delete (Del)')}">🗑</button>
    <span class="spacer"></span>
    <button class="tbtn" id="btn-zoom-out" title="${t('Zoom out')}">−</button>
    <span id="zoom-level">100%</span>
    <button class="tbtn" id="btn-zoom-in" title="${t('Zoom in')}">＋</button>
    <button class="tbtn" id="btn-fit" title="${t('Fit to window')}">⤢</button>
    <button class="tbtn" id="btn-tidy" title="${t('Tidy up the layout')}">⌗ ${t('Tidy')}</button>
    <button class="tbtn" id="btn-source" title="${t('Show / hide the Mermaid source')}">&lt;/&gt; ${t('Source')}</button>
    <button class="tbtn" id="btn-svg" title="${t('Export SVG')}">SVG</button>
    <button class="tbtn" id="btn-png" title="${t('Export PNG')}">PNG</button>
    <button class="tbtn" id="btn-copy" title="${t('Copy the image to the clipboard')}">⧉ ${t('Copy')}</button>
    <button class="tbtn" id="btn-look" title="${t('Hand-drawn look (Excalidraw style) ↔ clean')}">✏ ${t('Hand-drawn')}</button>
    <button class="tbtn" id="btn-help" title="${t('Keyboard shortcuts (?)')}">?</button>
  </div>
  <div id="editor-row">
    <div id="app"></div>
    <aside id="source-panel" hidden>
      <div id="source-head"><span id="source-title">${t('Mermaid source')}</span><span style="display:flex;gap:4px"><button class="tbtn" id="btn-apply-src" title="${t('Apply the source changes to the diagram (Ctrl+Enter)')}">${t('Apply')}</button><button class="tbtn" id="btn-copy-src">${t('Copy')}</button><button class="tbtn" id="btn-close-src" title="${t('Close the source panel')}" aria-label="${t('Close the source panel')}">✕</button></span></div>
      <textarea id="source-ta" spellcheck="false" aria-label="${t('Mermaid source')}" title="${t('Edit the Mermaid source, then press Apply or Ctrl+Enter')}"></textarea>
    </aside>
  </div>`;
}
