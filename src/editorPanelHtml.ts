// 繪製編輯器 webview 的 body 標記(工具列 + 畫布 + 原始碼面板)。
//
// 抽出來的原因:除了 EditorPanel 之外,scripts/verifyEditorUi.mjs 也要用「一模一樣」的標記
// 在 headless Chrome 裡把編輯器跑起來截圖。若兩邊各留一份,測到的就不是使用者看到的那個工具列。
// 這裡刻意不含任何 webview URI / nonce —— 那些由 EditorPanel 在外層組。

export const EDITOR_BODY_HTML = `  <div id="toolbar">
    <select id="diagram-select" class="tbtn" title="切換此檔的其他圖表" style="display:none"></select>
    <button class="tbtn" data-tool="select" title="選取 / 移動 (V)">➤ 選取</button>
    <button class="tbtn" data-tool="edge-create" title="從節點拉出連線 (E)">↘ 連線</button>
    <button class="tbtn" data-tool="pan" title="平移畫布">✋ 平移</button>
    <span class="spacer"></span>
    <span class="tlabel">新增：</span>
    <!-- 外形按鈕由 webview 依目前圖種的 adapter 能力生成(類別圖不該看到「菱形 / 圓柱」)。 -->
    <span id="shape-group"></span>
    <select id="shape-select" class="tbtn" title="更多外形（新增節點）"></select>
    <span id="seq-hint" class="tlabel" hidden>右鍵空白處：新增參與者 / 訊息</span>
    <span id="edge-style">
      <span class="spacer"></span>
      <span id="line-label" class="tlabel">線：</span>
      <button class="tbtn line-btn" data-linekind="solid" title="實線" aria-label="實線"><svg width="26" height="10" viewBox="0 0 26 10"><line x1="2" y1="5" x2="24" y2="5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      <button class="tbtn line-btn" data-linekind="dotted" title="虛線" aria-label="虛線"><svg width="26" height="10" viewBox="0 0 26 10"><line x1="2" y1="5" x2="24" y2="5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="2 4"/></svg></button>
      <button class="tbtn line-btn" data-linekind="thick" title="粗線" aria-label="粗線"><svg width="26" height="10" viewBox="0 0 26 10"><line x1="2" y1="5" x2="24" y2="5" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg></button>
      <button class="tbtn line-btn" data-linekind="invisible" title="隱形（不顯示連線）" aria-label="隱形"><svg width="26" height="10" viewBox="0 0 26 10"><line x1="2" y1="5" x2="24" y2="5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="1 4" stroke-opacity="0.4"/></svg></button>
      <select id="arrow-select" class="tbtn" title="箭頭樣式（套用到選取的連線 / 新連線預設）"></select>
      <button class="tbtn" id="btn-bidir" title="雙向箭頭（起點也加箭頭）">⇄ 雙向</button>
    </span>
    <select id="dir-select" class="tbtn" title="流程方向">
      <option value="TB">↓ 由上而下</option>
      <option value="LR">→ 由左而右</option>
      <option value="BT">↑ 由下而上</option>
      <option value="RL">← 由右而左</option>
    </select>
    <span class="spacer"></span>
    <button class="tbtn" id="btn-undo" title="復原 (Ctrl+Z)">↶</button>
    <button class="tbtn" id="btn-redo" title="重做 (Ctrl+Y)">↷</button>
    <button class="tbtn" id="btn-delete" title="刪除 (Del)">🗑</button>
    <span class="spacer"></span>
    <button class="tbtn" id="btn-zoom-out" title="縮小">−</button>
    <span id="zoom-level">100%</span>
    <button class="tbtn" id="btn-zoom-in" title="放大">＋</button>
    <button class="tbtn" id="btn-fit" title="符合視窗">⤢</button>
    <button class="tbtn" id="btn-tidy" title="自動整理排版">⌗ 整理</button>
    <button class="tbtn" id="btn-source" title="顯示 / 隱藏 Mermaid 原始碼">&lt;/&gt; 原始碼</button>
    <button class="tbtn" id="btn-svg" title="匯出 SVG">SVG</button>
    <button class="tbtn" id="btn-png" title="匯出 PNG">PNG</button>
    <button class="tbtn" id="btn-copy" title="複製圖片到剪貼簿">⧉ 複製</button>
    <button class="tbtn" id="btn-look" title="手繪外觀（Excalidraw 風）↔ 簡潔">✏ 手繪</button>
    <button class="tbtn" id="btn-help" title="鍵盤快捷鍵說明（?）">?</button>
  </div>
  <div id="editor-row">
    <div id="app"></div>
    <aside id="source-panel" hidden>
      <div id="source-head"><span id="source-title">Mermaid 原始碼</span><span style="display:flex;gap:4px"><button class="tbtn" id="btn-apply-src" title="套用原始碼變更到圖(Ctrl+Enter)">套用</button><button class="tbtn" id="btn-copy-src">複製</button><button class="tbtn" id="btn-close-src" title="關閉原始碼面板" aria-label="關閉原始碼面板">✕</button></span></div>
      <textarea id="source-ta" spellcheck="false" aria-label="Mermaid 原始碼" title="編輯 Mermaid 原始碼,按「套用」或 Ctrl+Enter 套用"></textarea>
    </aside>
  </div>`;
