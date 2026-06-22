// 繪製編輯器 webview 面板(host 端)。載入某張 mermaid 圖成可拖曳場景,
// 編輯後把序列化的 mermaid 透過 WorkspaceEdit 精準寫回該 fence(用 startLine/endLine)。

import * as vscode from 'vscode';
import { extractMermaidBlocks, isMermaidFileDoc } from './mermaidExtract';

type InMessage = { type: 'ready' } | { type: 'mermaidchange'; text: string } | { type: 'error'; message: string };

export class EditorPanel {
  public static current: EditorPanel | undefined;
  private static readonly viewType = 'superMermaidEditor';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private writeTimer: ReturnType<typeof setTimeout> | undefined;
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

  private currentBlockSource(): string {
    const blocks = extractMermaidBlocks(this.doc);
    const block = blocks[this.blockIndex] ?? blocks[0];
    return block?.source ?? '';
  }

  private postLoad(): void {
    const dark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
    void this.panel.webview.postMessage({ type: 'load', source: this.currentBlockSource(), dark });
  }

  private onMessage(msg: InMessage): void {
    if (msg.type === 'ready') {
      this.postLoad();
    } else if (msg.type === 'mermaidchange') {
      this.scheduleWriteBack(msg.text);
    } else if (msg.type === 'error') {
      void vscode.window.showWarningMessage(`Mermaid 繪製:${msg.message}`);
    }
  }

  /** 防抖寫回(避免一次拖曳產生過多文件編輯)。 */
  private scheduleWriteBack(text: string): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => void this.writeBack(text), 200);
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
  </div>
  <div id="app"></div>
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
