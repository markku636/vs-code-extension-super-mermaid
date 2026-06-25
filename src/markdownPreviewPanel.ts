import hljs from 'highlight.js';
import MarkdownIt from 'markdown-it';
import * as path from 'path';
import * as vscode from 'vscode';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'focusEditor' }
  | { type: 'setLocked'; locked: boolean }
  | { type: 'openLink'; href: string }
  | { type: 'previewScrolled'; line: number }
  | { type: 'revealLine'; line: number }
  | { type: 'persist'; theme: string; zoom: number; wide: boolean };

// v2:之前版本會在開啟時自動把預設值寫進 globalState,導致改預設無效;換 key 讓舊值失效。
const THEME_KEY = 'superMermaid.markdownPreview.theme.v2';
const ZOOM_KEY = 'superMermaid.markdownPreview.zoom.v2';
const WIDE_KEY = 'superMermaid.markdownPreview.wide.v2';

/** 只有 Markdown 文件支援整份預覽(.mmd 走 Mermaid 圖預覽,不是文件)。 */
function isMarkdownDoc(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'markdown' || /\.(md|markdown)$/i.test(doc.fileName);
}

/**
 * 整份 Markdown 文件預覽面板:host 端用 markdown-it 把文件渲染成 HTML(相對路徑圖片改寫成
 * webview URI、程式碼用 highlight.js 上色、每個區塊標 data-line 供捲動同步),送進 webview;
 * webview 再把 ```mermaid 區塊渲染成自動上色的 SVG,並處理 Editor↔Preview 雙向捲動同步與大綱。
 * 行為刻意對齊 PreviewPanel(單例、debounce 更新、跟隨作用中編輯器、可彈出獨立視窗 / 並排)。
 */
export class MarkdownPreviewPanel {
  public static current: MarkdownPreviewPanel | undefined;
  private static readonly DEBOUNCE_MS = 300;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  /** 跨開關 / 重啟記住的偏好(主題、縮放)存這裡(globalState)。 */
  private readonly state: vscode.Memento;
  private readonly md: MarkdownIt;
  private doc: vscode.TextDocument;
  /** 解析相對路徑圖片用的基準目錄(目前預覽文件所在資料夾)。 */
  private baseDir: string | undefined;
  private locked = false;
  private poppedOut = false;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  /** 捲動同步防回授:此刻之前忽略編輯器捲動事件(因為這捲動是預覽同步觸發我方 reveal 造成的)。 */
  private ignoreEditorScrollUntil = 0;
  private readonly disposables: vscode.Disposable[] = [];

  public static async createOrShow(
    context: vscode.ExtensionContext,
    doc: vscode.TextDocument,
    forceNewWindow = false,
    forceBeside = false,
  ): Promise<void> {
    if (MarkdownPreviewPanel.current) {
      MarkdownPreviewPanel.current.panel.reveal(undefined, !MarkdownPreviewPanel.current.poppedOut);
      MarkdownPreviewPanel.current.setSource(doc);
      if (forceNewWindow) {
        await MarkdownPreviewPanel.current.popOut();
      } else if (forceBeside && MarkdownPreviewPanel.current.poppedOut) {
        await MarkdownPreviewPanel.current.restoreToMainWindow();
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'superMermaidMarkdown',
      'Markdown Preview',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: !forceNewWindow },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: MarkdownPreviewPanel.resourceRoots(context, doc),
      },
    );
    MarkdownPreviewPanel.current = new MarkdownPreviewPanel(
      panel,
      context.extensionUri,
      context.globalState,
      doc,
    );
    if (forceNewWindow) {
      await MarkdownPreviewPanel.current.popOut();
    }
  }

  /** 圖片要載入就必須把來源資料夾列入 localResourceRoots(建立後不可改,故一次涵蓋工作區 + 文件目錄)。 */
  private static resourceRoots(
    context: vscode.ExtensionContext,
    doc: vscode.TextDocument,
  ): vscode.Uri[] {
    const roots = [
      vscode.Uri.joinPath(context.extensionUri, 'dist'),
      vscode.Uri.joinPath(context.extensionUri, 'media'),
    ];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      roots.push(folder.uri);
    }
    if (doc.uri.scheme === 'file') {
      roots.push(vscode.Uri.file(path.dirname(doc.uri.fsPath)));
    }
    return roots;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    state: vscode.Memento,
    doc: vscode.TextDocument,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.state = state;
    this.doc = doc;
    this.md = this.createMarkdownIt();

    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.svg');
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => void this.onMessage(msg),
      null,
      this.disposables,
    );
    this.updateTitle();
  }

  /** markdown-it:程式碼 highlight.js 上色、覆寫 image 規則改寫相對圖片、為區塊標 data-line。 */
  private createMarkdownIt(): MarkdownIt {
    const md = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
      breaks: false,
      highlight: (str, lang) => {
        // mermaid 區塊保持原樣交給 webview 渲染;其餘語言用 highlight.js 上色。
        if (!lang || lang === 'mermaid' || lang === 'mmd') {
          return '';
        }
        if (hljs.getLanguage(lang)) {
          try {
            const out = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
            return `<pre class="hljs"><code class="language-${lang}">${out}</code></pre>`;
          } catch {
            /* fall through to default escaping */
          }
        }
        return '';
      },
    });

    const defaultImage =
      md.renderer.rules.image ??
      ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const srcIndex = token.attrIndex('src');
      if (srcIndex >= 0) {
        token.attrs![srcIndex][1] = this.resolveResource(token.attrs![srcIndex][1]);
      }
      return defaultImage(tokens, idx, options, env, self);
    };

    // 為每個頂層區塊標上來源行號(data-line)。fence 自己一條(下方覆寫處理),避免重複屬性。
    md.core.ruler.push('source_line', (state) => {
      for (const token of state.tokens) {
        if (token.map && token.level === 0 && token.type !== 'fence') {
          token.attrSet('data-line', String(token.map[0]));
        }
      }
      return false;
    });
    const defaultFence = md.renderer.rules.fence!;
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const html = defaultFence(tokens, idx, options, env, self);
      const line = tokens[idx].map?.[0];
      return line == null ? html : html.replace(/^<pre/, `<pre data-line="${line}"`);
    };

    return md;
  }

  /** 相對 / 本機路徑 → webview URI;http(s)/data/已是 vscode-webview 的維持原樣。 */
  private resolveResource(src: string): string {
    if (/^(https?:|data:|vscode-webview:|\/\/)/i.test(src)) {
      return src;
    }
    try {
      const decoded = decodeURIComponent(src);
      const abs = path.isAbsolute(decoded) ? decoded : path.join(this.baseDir ?? '', decoded);
      return this.panel.webview.asWebviewUri(vscode.Uri.file(abs)).toString();
    } catch {
      return src;
    }
  }

  /** 跟隨作用中編輯器,除非使用者鎖定到目前文件。 */
  public onActiveEditorChanged(doc: vscode.TextDocument): void {
    if (!this.locked && isMarkdownDoc(doc)) {
      this.setSource(doc);
    }
  }

  public setSource(doc: vscode.TextDocument): void {
    if (doc.uri.toString() === this.doc.uri.toString()) {
      return;
    }
    this.doc = doc;
    this.updateTitle();
    this.postUpdate();
  }

  public onDocumentChanged(doc: vscode.TextDocument): void {
    if (doc.uri.toString() !== this.doc.uri.toString()) {
      return;
    }
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.postUpdate(), MarkdownPreviewPanel.DEBOUNCE_MS);
  }

  /** 編輯器捲動 → 預覽跟著捲到對應行(忽略我方 reveal 造成的回授捲動)。 */
  public onEditorScrolled(editor: vscode.TextEditor): void {
    if (
      editor.document.uri.toString() !== this.doc.uri.toString() ||
      !this.panel.visible ||
      Date.now() < this.ignoreEditorScrollUntil
    ) {
      return;
    }
    const top = editor.visibleRanges[0]?.start.line ?? 0;
    void this.panel.webview.postMessage({ type: 'scrollToLine', line: top });
  }

  private postUpdate(): void {
    this.baseDir = this.doc.uri.scheme === 'file' ? path.dirname(this.doc.uri.fsPath) : undefined;
    let html: string;
    try {
      html = this.md.render(this.doc.getText());
    } catch (err) {
      html = `<p class="md-render-error">Markdown render error: ${
        err instanceof Error ? err.message : String(err)
      }</p>`;
    }
    void this.panel.webview.postMessage({
      type: 'update',
      fileName: path.basename(this.doc.fileName),
      html,
    });
    this.postViewState();
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.postUpdate();
        break;
      case 'refresh':
        this.postUpdate();
        break;
      case 'focusEditor':
        await this.exitToEditor();
        break;
      case 'setLocked':
        this.locked = msg.locked;
        break;
      case 'openLink':
        await this.openLink(msg.href);
        break;
      case 'previewScrolled':
        this.revealEditorLine(msg.line, false);
        break;
      case 'revealLine':
        this.revealEditorLine(msg.line, true);
        break;
      case 'persist':
        // 記住使用者的主題 / 縮放 / 全寬偏好(跨開關預覽、跨 VSCode 重啟)。
        void this.state.update(THEME_KEY, msg.theme);
        void this.state.update(ZOOM_KEY, msg.zoom);
        void this.state.update(WIDE_KEY, msg.wide);
        break;
    }
  }

  /** 預覽捲動 / 雙擊 → 編輯器跟著定位。reveal 會觸發編輯器捲動事件,故設防回授窗。 */
  private revealEditorLine(line: number, moveCursor: boolean): void {
    const editor = this.findSourceEditor();
    if (!editor) {
      return;
    }
    const clamped = Math.max(0, Math.min(line, editor.document.lineCount - 1));
    const pos = new vscode.Position(clamped, 0);
    this.ignoreEditorScrollUntil = Date.now() + 250;
    editor.revealRange(
      new vscode.Range(pos, pos),
      moveCursor
        ? vscode.TextEditorRevealType.InCenterIfOutsideViewport
        : vscode.TextEditorRevealType.AtTop,
    );
    if (moveCursor) {
      editor.selection = new vscode.Selection(pos, pos);
      void vscode.window.showTextDocument(editor.document, {
        viewColumn: editor.viewColumn,
        preserveFocus: false,
      });
    }
  }

  /** webview 內點連結:http(s)/mailto 用外部程式開;其餘當成相對檔案連結在編輯器開啟。 */
  private async openLink(href: string): Promise<void> {
    if (/^(https?:|mailto:)/i.test(href)) {
      await vscode.env.openExternal(vscode.Uri.parse(href));
      return;
    }
    if (href.startsWith('#') || !this.baseDir) {
      return; // 純錨點交給 webview 自行捲動。
    }
    try {
      const target = path.join(this.baseDir, decodeURIComponent(href.split('#')[0]));
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch {
      /* 連結指向不存在的檔案:忽略。 */
    }
  }

  private findSourceTab(): { column: vscode.ViewColumn } | undefined {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.toString() === this.doc.uri.toString()
        ) {
          return { column: group.viewColumn };
        }
      }
    }
    return undefined;
  }

  private findSourceEditor(): vscode.TextEditor | undefined {
    return vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === this.doc.uri.toString(),
    );
  }

  /** 把預覽搬到獨立浮動視窗(Open in New Window);已彈出則僅帶到前景。 */
  private async popOut(): Promise<void> {
    if (this.poppedOut) {
      this.panel.reveal(undefined, false);
      return;
    }
    this.panel.reveal(undefined, false);
    await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
    this.poppedOut = true;
    this.postViewState();
  }

  /** Open to the Side 時若預覽還在獨立視窗,先收回主視窗再並排。 */
  private async restoreToMainWindow(): Promise<void> {
    if (!this.poppedOut) {
      return;
    }
    this.panel.reveal(undefined, false);
    await vscode.commands.executeCommand('workbench.action.restoreEditorsToMainWindow');
    this.poppedOut = false;
    this.postViewState();
  }

  public isPoppedOut(): boolean {
    return this.poppedOut;
  }

  /** ✕ / Esc:若在獨立視窗先收回,再把焦點還給原始碼編輯器。 */
  private async exitToEditor(): Promise<void> {
    if (this.poppedOut) {
      await vscode.commands.executeCommand('workbench.action.restoreEditorsToMainWindow');
      this.poppedOut = false;
      this.postViewState();
    }
    const column = this.findSourceEditor()?.viewColumn ?? this.findSourceTab()?.column;
    if (column !== undefined) {
      await vscode.window.showTextDocument(this.doc, { viewColumn: column, preserveFocus: false });
    }
  }

  private postViewState(): void {
    void this.panel.webview.postMessage({
      type: 'viewState',
      exitVisible: this.poppedOut,
      locked: this.locked,
    });
  }

  private updateTitle(): void {
    this.panel.title = `Preview ${path.basename(this.doc.fileName)}`;
  }

  private dispose(): void {
    MarkdownPreviewPanel.current = undefined;
    clearTimeout(this.debounceTimer);
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'markdownDocument.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'markdownDocument.css'),
    );
    const nonce = getNonce();
    // 記住的偏好(預設 Dark Purple);只允許安全字元帶進 HTML 屬性。
    const savedTheme = this.state.get<string>(THEME_KEY, 'velvet').replace(/[^\w-]/g, '');
    const savedZoom = Number(this.state.get<number>(ZOOM_KEY, 1)) || 1;
    const savedWide = this.state.get<boolean>(WIDE_KEY, false) ? '1' : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data: blob:; font-src ${webview.cspSource} data:; connect-src ${webview.cspSource};" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Markdown Preview</title>
</head>
<body data-initial-theme="${savedTheme}" data-initial-zoom="${savedZoom}" data-initial-wide="${savedWide}">
  <div id="md-toolbar">
    <span id="md-filename"></span>
    <span class="md-spacer"></span>
    <label id="md-theme-label" for="md-theme">Theme</label>
    <select id="md-theme" title="Preview theme">
      <option value="editor">Follow VS Code</option>
      <option value="daylight">Light</option>
      <option value="velvet">Dark Purple</option>
      <option value="jade">Dark Green</option>
      <option value="orchid">Dark Pink</option>
      <option value="amber">Dark Yellow</option>
      <option value="ember">Dark Red</option>
      <option value="abyss">Dark Black</option>
    </select>
    <button id="md-toc-toggle" title="Toggle outline (o)" aria-pressed="false">Outline</button>
    <button id="md-wide" title="Full width — stop wide tables being cut off (w)" aria-pressed="false">Wide</button>
    <button id="md-lock" title="Lock to current file" aria-pressed="false">Lock</button>
    <button id="md-refresh" title="Re-render (the preview also updates as you type)">Refresh</button>
    <button id="md-exit" title="Back to editor (Esc)" hidden>&#10005;</button>
  </div>
  <div id="md-layout">
    <aside id="md-toc" hidden></aside>
    <div id="md-content" class="markdown-body"></div>
  </div>
  <div id="md-zoom" title="Ctrl + mouse wheel to zoom">
    <button id="md-zoom-out" title="Zoom out (Ctrl -)">&#8722;</button>
    <span id="md-zoom-level" title="Reset to 100% (Ctrl 0)">100%</span>
    <button id="md-zoom-in" title="Zoom in (Ctrl +)">+</button>
  </div>
  <div id="md-context-menu" hidden>
    <button id="md-ctx-goto">Go to source line</button>
    <button id="md-ctx-copy" hidden>Copy</button>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

export { isMarkdownDoc };
