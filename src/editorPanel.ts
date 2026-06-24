// 繪製編輯器 webview 面板(host 端)。載入某張 mermaid 圖成可拖曳場景,
// 編輯後把序列化的 mermaid 透過 WorkspaceEdit 精準寫回該 fence(用 startLine/endLine)。

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { extractMermaidBlocks, isMermaidFileDoc } from './mermaidExtract';

type ExportFormat = 'svg' | 'png';
const EXPORT_FILTERS: Record<ExportFormat, Record<string, string[]>> = {
  svg: { 'SVG Image': ['svg'] },
  png: { 'PNG Image': ['png'] },
};
function decodeExportData(format: ExportFormat, data: string): Buffer {
  return format === 'svg'
    ? Buffer.from(data, 'utf8')
    : Buffer.from(data.replace(/^data:image\/[a-z.+-]+;base64,/, ''), 'base64');
}

type InMessage =
  | { type: 'ready' }
  | { type: 'mermaidchange'; text: string }
  | { type: 'error'; message: string }
  | { type: 'export'; format: ExportFormat; data: string; suggestedName: string }
  | { type: 'selectBlock'; index: number };

export class EditorPanel {
  public static current: EditorPanel | undefined;
  private static readonly viewType = 'superMermaidEditor';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private writeTimer: ReturnType<typeof setTimeout> | undefined;
  /** 尚未送出的回寫內容(供切換圖前 flush,避免 debounce 寫回到上一張)。 */
  private pendingText: string | undefined;
  private applyingEdit = false;

  static async createOrShow(
    context: vscode.ExtensionContext,
    doc: vscode.TextDocument,
    blockIndex: number,
  ): Promise<void> {
    const column = vscode.ViewColumn.Beside;
    if (EditorPanel.current) {
      EditorPanel.current.panel.reveal(column);
      EditorPanel.current.rebind(doc, blockIndex);
      return;
    }
    const panel = vscode.window.createWebviewPanel(EditorPanel.viewType, 'Mermaid 繪製', column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'dist'),
        vscode.Uri.joinPath(context.extensionUri, 'media'),
      ],
    });
    EditorPanel.current = new EditorPanel(context, panel, doc, blockIndex);
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    private doc: vscode.TextDocument,
    private blockIndex: number,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();
    this.updateTitle();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((m: InMessage) => this.onMessage(m), null, this.disposables);
  }

  private rebind(doc: vscode.TextDocument, blockIndex: number): void {
    this.doc = doc;
    this.blockIndex = blockIndex;
    this.updateTitle();
    this.postLoad();
  }

  private postLoad(): void {
    const dark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
    const blocks = extractMermaidBlocks(this.doc);
    const activeIndex = blocks[this.blockIndex] ? this.blockIndex : 0;
    // 下拉清單:沿用 mermaidExtract 的 displayTitle(frontmatter title)/ title(圖種關鍵字)。
    const list = blocks.map((b, i) => ({ index: i, label: `${i + 1}. ${b.displayTitle ?? b.title}` }));
    void this.panel.webview.postMessage({
      type: 'load',
      source: blocks[activeIndex]?.source ?? '',
      dark,
      blocks: list,
      activeIndex,
    });
  }

  private onMessage(msg: InMessage): void {
    if (msg.type === 'ready') {
      this.postLoad();
    } else if (msg.type === 'mermaidchange') {
      this.scheduleWriteBack(msg.text);
    } else if (msg.type === 'error') {
      void vscode.window.showWarningMessage(`Mermaid 繪製:${msg.message}`);
    } else if (msg.type === 'export') {
      void this.saveExport(msg);
    } else if (msg.type === 'selectBlock') {
      this.selectBlock(msg.index);
    }
  }

  /** 切換到同檔的另一張圖:先把上一張未送出的編輯 flush(避免寫回到舊 block),再重綁載入。 */
  private selectBlock(index: number): void {
    this.flushWriteBack();
    this.rebind(this.doc, index);
  }

  /** webview 端取得 SVG/PNG 資料後,host 用儲存對話框寫檔(webview 無法直接觸發下載)。 */
  private async saveExport(msg: { format: ExportFormat; data: string; suggestedName: string }): Promise<void> {
    const dir =
      this.doc.uri.scheme === 'file'
        ? path.dirname(this.doc.uri.fsPath)
        : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir());
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(dir, msg.suggestedName)),
      filters: EXPORT_FILTERS[msg.format],
    });
    if (!uri) return;
    await vscode.workspace.fs.writeFile(uri, decodeExportData(msg.format, msg.data));
    void vscode.window.showInformationMessage(`Mermaid 繪製:已匯出 ${path.basename(uri.fsPath)}`);
  }

  /** 防抖寫回(避免一次拖曳產生過多文件編輯)。 */
  private scheduleWriteBack(text: string): void {
    this.pendingText = text;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      const t = this.pendingText;
      this.pendingText = undefined;
      if (t != null) void this.writeBack(t);
    }, 200);
  }

  /** 立即送出尚未 flush 的回寫(切換圖前呼叫)。writeBack 的同步前段會以「目前 blockIndex」
   *  鎖定目標 fence,故必須在 rebind 改 blockIndex 之前呼叫。 */
  private flushWriteBack(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
    }
    const t = this.pendingText;
    this.pendingText = undefined;
    if (t != null) void this.writeBack(t);
  }

  private async writeBack(text: string): Promise<void> {
    const blocks = extractMermaidBlocks(this.doc);
    const block = blocks[this.blockIndex] ?? blocks[0];
    if (!block) return;
    const body = text.replace(/\n+$/, '') + '\n';
    const edit = new vscode.WorkspaceEdit();
    if (isMermaidFileDoc(this.doc)) {
      // 整檔 = 一張圖。
      const full = new vscode.Range(0, 0, this.doc.lineCount, 0);
      edit.replace(this.doc.uri, full, body);
    } else {
      // fenced 區塊:取代開圍欄與閉圍欄之間的內文(startLine+1 .. endLine-1)。
      const range = new vscode.Range(block.startLine + 1, 0, block.endLine, 0);
      edit.replace(this.doc.uri, range, body);
    }
    this.applyingEdit = true;
    try {
      await vscode.workspace.applyEdit(edit);
    } finally {
      this.applyingEdit = false;
    }
  }

  /** 文件被「外部」修改時(非本面板寫回),重新載入到編輯器。 */
  onDocumentChanged(changed: vscode.TextDocument): void {
    if (changed.uri.toString() !== this.doc.uri.toString()) return;
    if (this.applyingEdit) return; // 自家寫回造成的變動,略過。
    this.doc = changed;
    this.postLoad();
  }

  private updateTitle(): void {
    const name = this.doc.fileName.split(/[\\/]/).pop() ?? 'diagram';
    this.panel.title = `Mermaid 繪製:${name}`;
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'diagramEditor.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor.css'),
    );
    const fontUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'Excalifont.woff2'),
    );
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource} data:; connect-src ${webview.cspSource};" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Mermaid 繪製</title>
</head>
<body data-font-uri="${fontUri}">
  <div id="toolbar">
    <select id="diagram-select" class="tbtn" title="切換此檔的其他圖表" style="display:none"></select>
    <button class="tbtn" data-tool="select" title="選取 / 移動 (V)">➤ 選取</button>
    <button class="tbtn" data-tool="edge-create" title="從節點拉出連線 (E)">↘ 連線</button>
    <button class="tbtn" data-tool="pan" title="平移畫布">✋ 平移</button>
    <span class="spacer"></span>
    <span class="tlabel">新增：</span>
    <button class="tbtn" data-shape="rectangle" title="新增方框節點">▭ 方框</button>
    <button class="tbtn" data-shape="rounded" title="新增圓角節點">⬭ 圓角</button>
    <button class="tbtn" data-shape="stadium" title="新增膠囊節點">⬮ 膠囊</button>
    <button class="tbtn" data-shape="diamond" title="新增菱形節點">◇ 菱形</button>
    <button class="tbtn" data-shape="circle" title="新增圓形節點">◯ 圓形</button>
    <button class="tbtn" data-shape="hexagon" title="新增六角節點">⬡ 六角</button>
    <button class="tbtn" data-shape="cylinder" title="新增資料庫節點">⛁ 資料庫</button>
    <select id="shape-select" class="tbtn" title="更多外形（新增節點）">
      <option value="">＋ 更多外形…</option>
      <option value="subroutine">⧈ 子流程</option>
      <option value="doubleCircle">◎ 雙圈</option>
      <option value="ellipse">⬭ 橢圓</option>
      <option value="parallelogram">▱ 平行四邊形</option>
      <option value="parallelogramAlt">▰ 平行四邊形(左)</option>
      <option value="trapezoid">⏢ 梯形</option>
      <option value="trapezoidAlt">⏏ 梯形(倒)</option>
      <option value="odd">⬠ 旗標</option>
    </select>
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
      <div id="source-head"><span id="source-title">Mermaid 原始碼</span><span style="display:flex;gap:4px"><button class="tbtn" id="btn-apply-src" title="套用原始碼變更到圖(Ctrl+Enter)">套用</button><button class="tbtn" id="btn-copy-src">複製</button></span></div>
      <textarea id="source-ta" spellcheck="false" aria-label="Mermaid 原始碼" title="編輯 Mermaid 原始碼,按「套用」或 Ctrl+Enter 套用"></textarea>
    </aside>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    EditorPanel.current = undefined;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  return nonce;
}
