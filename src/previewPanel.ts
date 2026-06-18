import { exec } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { deflateSync } from 'zlib';
import { BlockError, MermaidDiagnostics } from './diagnostics';
import { extractMermaidBlocks, isMermaidFileDoc, MermaidBlock } from './mermaidExtract';

type PreviewLocation = 'newWindow' | 'beside';

/** 讀取使用者設定的預覽開啟位置（預設：右側分割，與內建 Markdown 預覽一致）。 */
function getPreviewLocation(): PreviewLocation {
  const value = vscode.workspace.getConfiguration('superMermaid').get<string>('previewLocation');
  return value === 'newWindow' ? 'newWindow' : 'beside';
}

type ExportFormat = 'svg' | 'png' | 'jpg' | 'webp';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'revealBlock'; index: number }
  | { type: 'revealLine'; index: number; line: number }
  | { type: 'focusEditor' }
  | { type: 'export'; format: ExportFormat; data: string; suggestedName: string }
  | { type: 'copyText'; text: string; what: string }
  | { type: 'copyImageFallback'; data: string }
  | { type: 'shareLive'; code: string; theme: string }
  | { type: 'setLocked'; locked: boolean }
  | { type: 'diagnostics'; uri: string; version: number; errors: BlockError[] }
  | { type: 'exportAllRequest'; format: ExportFormat; count: number }
  | { type: 'exportAllFile'; index: number; name: string; data: string }
  | { type: 'exportAllError'; index: number; label: string; message: string }
  | { type: 'exportAllDone' };

const EXPORT_FILTERS: Record<ExportFormat, Record<string, string[]>> = {
  svg: { 'SVG Image': ['svg'] },
  png: { 'PNG Image': ['png'] },
  jpg: { 'JPEG Image': ['jpg', 'jpeg'] },
  webp: { 'WebP Image': ['webp'] },
};

function decodeExportData(format: ExportFormat, data: string): Buffer {
  return format === 'svg'
    ? Buffer.from(data, 'utf8')
    : Buffer.from(data.replace(/^data:image\/[a-z.+-]+;base64,/, ''), 'base64');
}

interface PendingExportAll {
  folder: vscode.Uri;
  total: number;
  written: number;
  skipped: { label: string; message: string }[];
  progress: vscode.Progress<{ message?: string; increment?: number }>;
  finish: () => void;
}

const ICON_ZOOM_IN =
  '<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6.5 1a5.5 5.5 0 0 1 4.38 8.83l4.15 4.14-1.06 1.06-4.15-4.14A5.5 5.5 0 1 1 6.5 1Zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm.75 1.5v1.75H9v1.5H7.25V9h-1.5V7.25H4v-1.5h1.75V4h1.5Z"/></svg>';
const ICON_ZOOM_OUT =
  '<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6.5 1a5.5 5.5 0 0 1 4.38 8.83l4.15 4.14-1.06 1.06-4.15-4.14A5.5 5.5 0 1 1 6.5 1Zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 5.75h5v1.5H4v-1.5Z"/></svg>';
const ICON_FIT =
  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="8" r="4.25"/><path d="M8 1.25v2.25M8 12.5v2.25M1.25 8H3.5M12.5 8h2.25"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/></svg>';
const ICON_DOWNLOAD =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8.75 1v8.04l2.72-2.72 1.06 1.06L8 11.91 3.47 7.38l1.06-1.06 2.72 2.72V1h1.5ZM2 13h12v1.5H2V13Z"/></svg>';
const ICON_FIT_WIDTH =
  '<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1.5 3h1.5v10H1.5V3Zm11.5 0h1.5v10H13V3ZM5.9 5.1 3 8l2.9 2.9 1.06-1.06L5.62 8.5h4.76l-1.34 1.34L10.1 10.9 13 8l-2.9-2.9-1.06 1.06 1.34 1.34H5.62l1.34-1.34L5.9 5.1Z"/></svg>';
const ICON_LOCK =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';
const ICON_UNLOCK =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.95-.5" stroke-linecap="round"/></svg>';
const ICON_REFRESH =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.7 1.6v3.2h-3.2" stroke-linejoin="round"/></svg>';
const ICON_MORE =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="13" cy="8" r="1.4"/></svg>';
const ICON_PLAY =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.5 2.7a.7.7 0 0 1 1.06-.6l8 5.3a.7.7 0 0 1 0 1.2l-8 5.3a.7.7 0 0 1-1.06-.6V2.7Z"/></svg>';
const ICON_SEARCH =
  '<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6.5 1a5.5 5.5 0 0 1 4.38 8.83l4.15 4.14-1.06 1.06-4.15-4.14A5.5 5.5 0 1 1 6.5 1Zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/></svg>';
const ICON_SHARE =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M6.6 9.4l2.8-2.8"/><path d="M7.6 4.6l1.2-1.2a2.55 2.55 0 0 1 3.6 3.6l-1.2 1.2"/><path d="M8.4 11.4l-1.2 1.2a2.55 2.55 0 0 1-3.6-3.6l1.2-1.2"/></svg>';
const ICON_COPY =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/><path d="M10.5 5.5v-2A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2"/></svg>';
const ICON_GALLERY =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>';
const ICON_EMPTY =
  '<svg width="44" height="44" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1" aria-hidden="true"><rect x="1.5" y="2" width="5.5" height="3.5" rx="0.8"/><rect x="9" y="10.5" width="5.5" height="3.5" rx="0.8"/><path d="M4.25 5.5v2a1.5 1.5 0 0 0 1.5 1.5h4.5a1.5 1.5 0 0 1 1.5 1.5"/></svg>';

export class PreviewPanel {
  public static current: PreviewPanel | undefined;
  /** Set by activate(); shared squiggle collection for mermaid syntax errors. */
  public static diagnostics: MermaidDiagnostics | undefined;
  private static readonly DEBOUNCE_MS = 300;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private doc: vscode.TextDocument;
  private blocks: MermaidBlock[] = [];
  private activeIndex = 0;
  /** CodeLens「Edit Diagram」指定要定位的圖（優先於游標位置，套用一次後清除）。 */
  private desiredIndex: number | undefined;
  private locked = false;
  /** 預覽被移到獨立視窗（popOut / previewLocation: newWindow）。 */
  private poppedOut = false;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingExportAll: PendingExportAll | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  public static async createOrShow(
    context: vscode.ExtensionContext,
    doc: vscode.TextDocument,
    revealIndex?: number,
    forceNewWindow = false,
    forceBeside = false,
  ): Promise<void> {
    if (PreviewPanel.current) {
      // When the preview already lives in its own window, take focus so that
      // window is raised to the front — otherwise clicking the CodeLens from the
      // editor looks like nothing happened. Beside-mode keeps the editor focused.
      PreviewPanel.current.panel.reveal(undefined, !PreviewPanel.current.poppedOut);
      PreviewPanel.current.setSource(doc);
      if (revealIndex !== undefined) {
        PreviewPanel.current.focusBlock(revealIndex);
      }
      if (forceNewWindow) {
        await PreviewPanel.current.popOut();
      }
      return;
    }
    // 'newWindow' 模式（或 CodeLens「Open in New Window」）需讓 webview 取得焦點
    //（preserveFocus=false），才能接著用 moveEditorToNewWindow 把作用中的面板移到獨立視窗。
    const location = getPreviewLocation();
    // forceBeside（Edit Diagram）一律右側並排,凌駕 previewLocation: newWindow 設定。
    const popOut = !forceBeside && (forceNewWindow || location === 'newWindow');
    const panel = vscode.window.createWebviewPanel(
      'superMermaid',
      'Super Mermaid',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: !popOut },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist'),
          vscode.Uri.joinPath(context.extensionUri, 'media'),
        ],
      },
    );
    PreviewPanel.current = new PreviewPanel(panel, context.extensionUri, doc);
    if (revealIndex !== undefined) {
      PreviewPanel.current.focusBlock(revealIndex);
    }
    if (popOut) {
      await PreviewPanel.current.popOut();
    }
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, doc: vscode.TextDocument) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.doc = doc;

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

  /** Follow the active editor, unless the user locked the preview to its current file. */
  public onActiveEditorChanged(doc: vscode.TextDocument): void {
    if (!this.locked) {
      this.setSource(doc);
    }
  }

  public setSource(doc: vscode.TextDocument): void {
    if (doc.uri.toString() === this.doc.uri.toString()) {
      return;
    }
    // We can no longer keep the old document's squiggles fresh.
    PreviewPanel.diagnostics?.clear(this.doc.uri);
    this.doc = doc;
    this.activeIndex = 0;
    this.updateTitle();
    this.postUpdate();
  }

  /** 讓預覽定位到指定索引的圖（供 CodeLens「Edit Diagram」使用）。 */
  public focusBlock(index: number): void {
    if (index < 0) {
      return;
    }
    this.desiredIndex = index;
    this.activeIndex = index;
    if (index < this.blocks.length) {
      // 區塊已載入 → 立即切換；否則待 webview ready 後的 postUpdate 套用 desiredIndex。
      void this.panel.webview.postMessage({ type: 'setActive', index });
      this.desiredIndex = undefined;
    }
  }

  public onDocumentChanged(doc: vscode.TextDocument): void {
    if (doc.uri.toString() !== this.doc.uri.toString()) {
      return;
    }
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.postUpdate(), PreviewPanel.DEBOUNCE_MS);
  }

  public onSelectionChanged(editor: vscode.TextEditor): void {
    if (editor.document.uri.toString() !== this.doc.uri.toString() || this.blocks.length < 2) {
      return;
    }
    const line = editor.selection.active.line;
    const index = this.blocks.findIndex((b) => line >= b.startLine && line <= b.endLine);
    if (index >= 0 && index !== this.activeIndex) {
      this.activeIndex = index;
      void this.panel.webview.postMessage({ type: 'setActive', index });
    }
  }

  private postUpdate(): void {
    this.blocks = extractMermaidBlocks(this.doc);
    if (this.activeIndex >= this.blocks.length) {
      this.activeIndex = Math.max(0, this.blocks.length - 1);
    }
    if (this.desiredIndex !== undefined) {
      // CodeLens「Edit Diagram」指定的圖優先於游標位置（只套用一次）。
      this.activeIndex = Math.min(
        Math.max(this.desiredIndex, 0),
        Math.max(0, this.blocks.length - 1),
      );
      this.desiredIndex = undefined;
    } else {
      const editor = this.findSourceEditor();
      if (editor && this.blocks.length > 1) {
        const line = editor.selection.active.line;
        const index = this.blocks.findIndex((b) => line >= b.startLine && line <= b.endLine);
        if (index >= 0) {
          this.activeIndex = index;
        }
      }
    }
    void this.panel.webview.postMessage({
      type: 'update',
      uri: this.doc.uri.toString(),
      version: this.doc.version,
      fileName: path.basename(this.doc.fileName),
      blocks: this.blocks.map((b, i) => ({
        source: b.source,
        title: b.displayTitle ?? b.title,
        label: `${i + 1} · ${b.displayTitle ?? b.title} (L${b.startLine + 1})`,
      })),
      activeIndex: this.activeIndex,
    });
    // A webview recreated after moving between windows must re-learn the ✕ state.
    this.postViewState();
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.postUpdate();
        break;
      case 'revealBlock':
        this.revealBlock(msg.index);
        break;
      case 'revealLine':
        this.revealLine(msg.index, msg.line);
        break;
      case 'focusEditor':
        await this.exitToEditor();
        break;
      case 'export':
        await this.saveExport(msg);
        break;
      case 'copyText':
        await vscode.env.clipboard.writeText(msg.text);
        void vscode.window.showInformationMessage(`Mermaid Preview: ${msg.what} copied to clipboard`);
        break;
      case 'copyImageFallback':
        await this.copyImageViaOs(msg.data);
        break;
      case 'shareLive':
        await this.shareToMermaidLive(msg.code, msg.theme);
        break;
      case 'setLocked':
        this.locked = msg.locked;
        break;
      case 'diagnostics':
        // Drop stale results — a newer (debounced) update is already in flight.
        if (msg.uri === this.doc.uri.toString() && msg.version === this.doc.version) {
          PreviewPanel.diagnostics?.publish(this.doc, this.blocks, msg.errors);
        }
        break;
      case 'exportAllRequest':
        await this.startExportAll(msg.format, msg.count);
        break;
      case 'exportAllFile':
        await this.writeExportAllFile(msg.name, msg.data);
        break;
      case 'exportAllError':
        this.pendingExportAll?.skipped.push({ label: msg.label, message: msg.message });
        break;
      case 'exportAllDone':
        this.finishExportAll();
        break;
    }
  }

  private async startExportAll(format: ExportFormat, count: number): Promise<void> {
    if (this.pendingExportAll || count === 0) {
      void this.panel.webview.postMessage({ type: 'exportAllCancel' });
      return;
    }
    const defaultDir =
      this.doc.uri.scheme === 'file'
        ? path.dirname(this.doc.uri.fsPath)
        : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir());
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(defaultDir),
      openLabel: 'Export diagrams here',
    });
    if (!picked?.[0]) {
      void this.panel.webview.postMessage({ type: 'exportAllCancel' });
      return;
    }
    const folder = picked[0];
    void vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Super Mermaid: exporting diagrams',
        cancellable: true,
      },
      (progress, token) =>
        new Promise<void>((resolve) => {
          token.onCancellationRequested(() => {
            void this.panel.webview.postMessage({ type: 'exportAllCancel' });
            this.finishExportAll(true);
          });
          this.pendingExportAll = {
            folder,
            total: count,
            written: 0,
            skipped: [],
            progress,
            finish: resolve,
          };
          void this.panel.webview.postMessage({ type: 'exportAllStart' });
        }),
    );
  }

  private async writeExportAllFile(name: string, data: string): Promise<void> {
    const pending = this.pendingExportAll;
    if (!pending) {
      return;
    }
    const format = (name.split('.').pop() ?? 'png') as ExportFormat;
    const target = vscode.Uri.joinPath(pending.folder, name);
    await vscode.workspace.fs.writeFile(target, decodeExportData(format, data));
    pending.written++;
    pending.progress.report({ increment: 100 / pending.total, message: name });
  }

  private finishExportAll(cancelled = false): void {
    const pending = this.pendingExportAll;
    if (!pending) {
      return;
    }
    this.pendingExportAll = undefined;
    pending.finish();
    if (cancelled) {
      return;
    }
    const where = pending.folder.fsPath;
    if (pending.skipped.length === 0) {
      void vscode.window.showInformationMessage(
        `Super Mermaid: exported ${pending.written} diagram${pending.written === 1 ? '' : 's'} to ${where}`,
      );
    } else {
      const detail = pending.skipped
        .map((s) => `${s.label}: ${s.message.split('\n')[0]}`)
        .join('; ');
      void vscode.window.showWarningMessage(
        `Super Mermaid: exported ${pending.written} of ${pending.total} diagrams to ${where} — skipped ${detail}`,
      );
    }
  }

  /**
   * mermaid.live keeps the whole editor state in the URL fragment as
   * pako-deflated base64url JSON — nothing is sent to a server until the
   * link is opened. Node's zlib emits the same zlib stream pako expects.
   */
  private async shareToMermaidLive(code: string, theme: string): Promise<void> {
    const state = JSON.stringify({
      code,
      mermaid: JSON.stringify({ theme }),
      autoSync: true,
      updateDiagram: true,
    });
    const encoded = deflateSync(Buffer.from(state, 'utf8'), { level: 9 }).toString('base64url');
    const url = `https://mermaid.live/edit#pako:${encoded}`;
    const warning =
      url.length > 8000 ? ' (very long link — some chat apps may truncate it)' : '';
    const action = await vscode.window.showInformationMessage(
      `Super Mermaid: share link ready${warning}`,
      'Open in Browser',
      'Copy URL',
    );
    if (action === 'Open in Browser') {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    } else if (action === 'Copy URL') {
      await vscode.env.clipboard.writeText(url);
      void vscode.window.showInformationMessage('Super Mermaid: share URL copied to clipboard');
    }
  }

  /**
   * Clipboard-image fallback when the webview's navigator.clipboard is
   * unavailable: write a temp PNG and hand it to the OS clipboard. Windows
   * needs Clipboard.SetImage (Set-Clipboard -Path would only copy a file
   * reference, which pastes as a file icon instead of the picture).
   */
  private async copyImageViaOs(dataUrl: string): Promise<void> {
    const tmp = path.join(os.tmpdir(), `super-mermaid-clip-${Date.now()}.png`);
    const tmpUri = vscode.Uri.file(tmp);
    await vscode.workspace.fs.writeFile(tmpUri, decodeExportData('png', dataUrl));
    const command =
      process.platform === 'win32'
        ? `powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $img=[System.Drawing.Image]::FromFile('${tmp}'); [System.Windows.Forms.Clipboard]::SetImage($img); $img.Dispose()"`
        : process.platform === 'darwin'
          ? `osascript -e 'set the clipboard to (read (POSIX file "${tmp}") as «class PNGf»)'`
          : `xclip -selection clipboard -t image/png -i "${tmp}"`;
    exec(command, (error) => {
      void vscode.workspace.fs.delete(tmpUri).then(undefined, () => undefined);
      if (error) {
        void vscode.window.showErrorMessage(
          'Super Mermaid: could not copy the image to the clipboard — use Export PNG instead.',
        );
      } else {
        void vscode.window.showInformationMessage('Super Mermaid: image copied to clipboard');
      }
    });
  }

  private revealBlock(index: number): void {
    this.activeIndex = index;
    const block = this.blocks[index];
    const editor = this.findSourceEditor();
    if (!block || !editor) {
      return;
    }
    editor.revealRange(
      new vscode.Range(block.startLine, 0, block.startLine, 0),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
  }

  /** Move the cursor to a clicked node's definition (line is relative to the block source). */
  private revealLine(index: number, lineInSource: number): void {
    this.activeIndex = index;
    const block = this.blocks[index];
    const editor = this.findSourceEditor();
    if (!block || !editor) {
      return;
    }
    // Fenced content starts the line after the opening fence; .mmd sources at line 0.
    const contentStart = isMermaidFileDoc(this.doc) ? 0 : block.startLine + 1;
    const line = Math.min(Math.max(contentStart + lineInSource, block.startLine), block.endLine);
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(
      new vscode.Range(pos, pos),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
  }

  private async saveExport(msg: { format: ExportFormat; data: string; suggestedName: string }): Promise<void> {
    const dir =
      this.doc.uri.scheme === 'file'
        ? path.dirname(this.doc.uri.fsPath)
        : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir());
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(dir, msg.suggestedName)),
      filters: EXPORT_FILTERS[msg.format],
    });
    if (!uri) {
      return;
    }
    await vscode.workspace.fs.writeFile(uri, decodeExportData(msg.format, msg.data));
    void vscode.window.showInformationMessage(`Super Mermaid: exported ${path.basename(uri.fsPath)}`);
  }

  private findSourceEditor(): vscode.TextEditor | undefined {
    return vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === this.doc.uri.toString(),
    );
  }

  /** The tab holding the source document — found even while it isn't the visible editor. */
  private findSourceTab(): { column: vscode.ViewColumn; isActive: boolean } | undefined {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.toString() === this.doc.uri.toString()
        ) {
          return { column: group.viewColumn, isActive: tab.isActive };
        }
      }
    }
    return undefined;
  }

  /** 把預覽移到獨立浮動視窗（CodeLens「Open in New Window」/ previewLocation: newWindow）；已彈出則僅聚焦。 */
  private async popOut(): Promise<void> {
    if (this.poppedOut) {
      // 已在獨立視窗 → 帶到前景即可，避免重複 moveEditorToNewWindow 開出空白視窗。
      this.panel.reveal(undefined, false);
      return;
    }
    // reveal 讓預覽成為作用中面板，moveEditorToNewWindow 才會搬到它。
    this.panel.reveal(undefined, false);
    await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
    this.poppedOut = true;
    this.postViewState();
  }

  /**
   * CodeLens「Edit Diagram」:回到編輯模式 —— 預覽若在獨立視窗就先收回主視窗,
   * 再把焦點交還原始碼編輯器並定位到這張圖的起始行,讓使用者直接改碼。
   */
  /** 預覽目前是否在獨立浮動視窗。 */
  public isPoppedOut(): boolean {
    return this.poppedOut;
  }

  /** 關閉預覽面板(連同它的獨立視窗);會觸發 onDidDispose → dispose() 清空 current。 */
  public closePanel(): void {
    this.panel.dispose();
  }

  /** Esc / ✕ — undo pop-out if we're in one, then hand focus back to the source editor. */
  private async exitToEditor(): Promise<void> {
    if (this.poppedOut) {
      // Esc/✕ happened in the webview, so the floating window is the active
      // one this command pulls back into the main window.
      await vscode.commands.executeCommand('workbench.action.restoreEditorsToMainWindow');
      this.poppedOut = false;
      this.postViewState();
    }
    const tab = this.findSourceTab();
    const editor = this.findSourceEditor();
    const column = editor?.viewColumn ?? tab?.column;
    if (column !== undefined) {
      await vscode.window.showTextDocument(this.doc, { viewColumn: column, preserveFocus: false });
    }
  }

  /** Tell the webview whether the floating ✕ (back to editor) should be visible. */
  private postViewState(): void {
    void this.panel.webview.postMessage({
      type: 'viewState',
      exitVisible: this.poppedOut,
    });
  }

  private updateTitle(): void {
    this.panel.title = `Mermaid: ${path.basename(this.doc.fileName)}`;
  }

  private dispose(): void {
    PreviewPanel.current = undefined;
    clearTimeout(this.debounceTimer);
    // No preview → no validation source: drop all squiggles and any pending
    // export-all progress so the notification can't hang forever.
    PreviewPanel.diagnostics?.clearAll();
    this.finishExportAll(true);
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'webview.css'));
    // Exposed to the webview so it can fetch the woff2 and embed it (base64) in
    // exported SVGs — external url() fonts don't survive SVG-to-canvas raster.
    const fontUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'Excalifont.woff2'));
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource} data:; connect-src ${webview.cspSource};" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Mermaid Preview</title>
</head>
<body data-font-uri="${fontUri}">
  <div id="toolbar">
    <select id="block-select" hidden title="Select diagram"></select>
    <button id="presentation-toggle" title="Presentation mode (p)">${ICON_PLAY}</button>
    <button id="zoom-reset" title="Fit to view (0, or double-click canvas)">${ICON_FIT}</button>
    <button id="search-toggle" title="Find in diagram (/)">${ICON_SEARCH}</button>
    <div class="sep"></div>
    <select id="theme-select" title="Mermaid theme / style">
      <option value="colorful">Colorful</option>
      <option value="sketch">Sketch</option>
      <option value="auto">Auto</option>
      <option value="default">Light</option>
      <option value="dark">Dark</option>
      <option value="neutral">Neutral</option>
      <option value="forest">Forest</option>
    </select>
    <button id="bg-menu-btn" title="Background"><span id="bg-current" class="bg-current" data-bg=""></span></button>
    <div class="sep"></div>
    <button id="export-menu-btn" title="Export diagram…">${ICON_DOWNLOAD}</button>
    <div class="sep"></div>
    <button id="share-live-btn" title="Share to mermaid.live">${ICON_SHARE}</button>
    <button id="more-btn" title="More…">${ICON_MORE}</button>
  </div>
  <div id="zoom-controls">
    <button id="zoom-out" title="Zoom out (-)">${ICON_ZOOM_OUT}</button>
    <span id="zoom-level" title="Click for actual size (1)">100%</span>
    <button id="zoom-in" title="Zoom in (+)">${ICON_ZOOM_IN}</button>
  </div>
  <div id="search-bar" hidden>
    <input id="search-input" type="text" placeholder="Find in diagram…" spellcheck="false" />
    <span id="search-count"></span>
  </div>
  <div id="export-menu" class="dropdown" hidden>
    <button class="menu-item" id="menu-copy-image">${ICON_COPY}<span>Copy as image (c)</span></button>
    <div class="menu-sep"></div>
    <button class="menu-item" data-format="svg">${ICON_DOWNLOAD}<span>Export SVG</span></button>
    <button class="menu-item" data-format="png">${ICON_DOWNLOAD}<span>Export PNG</span></button>
    <button class="menu-item" data-format="jpg">${ICON_DOWNLOAD}<span>Export JPG</span></button>
    <button class="menu-item" data-format="webp">${ICON_DOWNLOAD}<span>Export WebP</span></button>
    <div class="menu-sep"></div>
    <button class="menu-item" id="menu-export-all-png">${ICON_GALLERY}<span>Export all (PNG)</span></button>
    <button class="menu-item" id="menu-export-all-svg">${ICON_GALLERY}<span>Export all (SVG)</span></button>
    <div class="menu-sep"></div>
    <div class="menu-row">
      <span>Scale</span>
      <select id="png-scale" title="Raster resolution">
        <option value="1">1x</option>
        <option value="2">2x</option>
        <option value="4">4x</option>
      </select>
    </div>
    <label class="menu-row" title="PNG / WebP only">
      <input type="checkbox" id="bg-transparent" />
      <span>Transparent background</span>
    </label>
  </div>
  <div id="more-menu" class="dropdown" hidden>
    <button class="menu-item" id="gallery-toggle">${ICON_GALLERY}<span>Gallery — all diagrams (g)</span></button>
    <button class="menu-item" id="lock-btn" title="Lock to current file"><span class="icon-unlocked">${ICON_UNLOCK}</span><span class="icon-locked">${ICON_LOCK}</span><span id="lock-label">Lock to current file</span></button>
    <button class="menu-item" id="refresh-btn">${ICON_REFRESH}<span>Re-render</span></button>
    <button class="menu-item" id="fit-width">${ICON_FIT_WIDTH}<span>Fit width (w)</span></button>
  </div>
  <div id="bg-menu" class="dropdown" hidden>
    <div class="menu-label">Background<span class="menu-hint">also used for export</span></div>
    <div class="bg-swatches" id="bg-swatches">
      <button class="bg-swatch" data-bg="" title="Default — follow editor"></button>
      <button class="bg-swatch" data-bg="#FFFFFF" style="background-color:#FFFFFF" title="White"></button>
      <button class="bg-swatch" data-bg="#F3F4F6" style="background-color:#F3F4F6" title="Light gray"></button>
      <button class="bg-swatch" data-bg="#EFF6FF" style="background-color:#EFF6FF" title="Light blue"></button>
      <button class="bg-swatch" data-bg="#FEFCE8" style="background-color:#FEFCE8" title="Light yellow"></button>
      <button class="bg-swatch" data-bg="#FDF2F8" style="background-color:#FDF2F8" title="Light rose"></button>
    </div>
  </div>
  <div id="canvas">
    <div id="diagram"></div>
    <div id="gallery" hidden></div>
    <div id="empty" hidden>
      <div class="empty-icon">${ICON_EMPTY}</div>
      <div class="empty-title">No Mermaid diagram found</div>
      <div class="empty-hint">Add a \`\`\`mermaid code block, or open a .mmd file</div>
    </div>
    <div id="error" hidden></div>
    <div id="toast"></div>
    <div id="pres-counter" hidden></div>
    <div id="pres-hint" hidden>Click / ← → switch · Esc exit</div>
    <button id="pres-exit" hidden title="Exit presentation (Esc)">✕</button>
    <button id="view-exit" hidden title="Back to editor (Esc)">✕</button>
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
