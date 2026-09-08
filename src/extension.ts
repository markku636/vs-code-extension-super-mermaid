import * as vscode from 'vscode';
import { t } from './uiLocale';
import { MermaidCodeLensProvider } from './codeLensProvider';
import { MermaidCompletionProvider } from './completionProvider';
import { MermaidHoverProvider } from './hoverProvider';
import { MermaidDiagnostics } from './diagnostics';
import { asKeyStroke, EditorPanel } from './editorPanel';
import { registerInsertTemplateCommand } from './insertTemplate';
import { isMarkdownDoc, MarkdownPreviewPanel } from './markdownPreviewPanel';
import { extractMermaidBlocks, isSupportedDoc } from './mermaidExtract';
import { PreviewPanel } from './previewPanel';
import { MermaidStatusBar } from './statusBar';

/** 解析「整份 Markdown 預覽」指令的目標文件:explorer 帶 uri,其餘用作用中編輯器。 */
async function resolveMarkdownDoc(uri?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  let doc: vscode.TextDocument | undefined;
  if (uri instanceof vscode.Uri) {
    doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  } else {
    doc = vscode.window.activeTextEditor?.document;
  }
  if (!doc || !isMarkdownDoc(doc)) {
    void vscode.window.showInformationMessage(
      t('Super Mermaid: open a Markdown (.md) file first to preview it.'),
    );
    return undefined;
  }
  return doc;
}

// Match by language AND by file extension: other extensions (e.g. Mermaid
// Chart) can take over .mmd files under their own language ids such as
// "mermaid.flowchart", which would otherwise disable us for those files.
const SUPPORTED_SELECTOR: vscode.DocumentSelector = [
  { language: 'markdown' },
  { language: 'mermaid' },
  { pattern: '**/*.mmd' },
  { pattern: '**/*.mermaid' },
];

export function activate(context: vscode.ExtensionContext): void {
  const codeLensProvider = new MermaidCodeLensProvider();
  const statusBar = new MermaidStatusBar();
  const diagnostics = new MermaidDiagnostics();
  PreviewPanel.diagnostics = diagnostics;

  statusBar.refresh(vscode.window.activeTextEditor);

  context.subscriptions.push(
    codeLensProvider,
    statusBar,
    diagnostics,
    vscode.languages.registerCodeLensProvider(SUPPORTED_SELECTOR, codeLensProvider),
    vscode.languages.registerCompletionItemProvider(
      SUPPORTED_SELECTOR,
      new MermaidCompletionProvider(),
      '-',
      '>',
      ':',
    ),
    vscode.languages.registerHoverProvider(SUPPORTED_SELECTOR, new MermaidHoverProvider()),
    registerInsertTemplateCommand(context),
    vscode.commands.registerCommand(
      'superMermaid.editDiagram',
      async (uri: vscode.Uri, blockIndex: number) => {
        const doc = await vscode.workspace.openTextDocument(uri);
        // Edit Diagram 一律:右側並排預覽 + 焦點留在原始碼(編輯模式)。
        // 預覽若在獨立視窗,先關掉,改用 beside 重新開,確保並排、不留分割。
        if (PreviewPanel.current?.isPoppedOut()) {
          PreviewPanel.current.closePanel();
        }
        await vscode.window.showTextDocument(doc, { preview: false });
        await PreviewPanel.createOrShow(context, doc, blockIndex, false, true);
      },
    ),
    vscode.commands.registerCommand(
      'superMermaid.editDiagramInNewWindow',
      async (uri: vscode.Uri, blockIndex: number) => {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
        await PreviewPanel.createOrShow(context, doc, blockIndex, true);
      },
    ),
    vscode.commands.registerCommand(
      'superMermaid.editDiagramVisually',
      async (uri?: vscode.Uri, blockIndex?: number) => {
        // CodeLens 帶 (uri, index);選單 / 命令面板則無參數 → 用作用中編輯器。
        let doc: vscode.TextDocument | undefined;
        if (uri instanceof vscode.Uri) {
          doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, { preview: false });
        } else {
          doc = vscode.window.activeTextEditor?.document;
        }
        if (!doc || !isSupportedDoc(doc)) {
          void vscode.window.showInformationMessage(
            t('Super Mermaid: open a Markdown or Mermaid (.mmd) file first.'),
          );
          return;
        }
        // 繪製 / 表單編輯器支援的圖種才放行;其他圖種沒有對應解析器,硬開會把原圖覆寫 → 擋下並提示。
        // timeline / orid 走結構化表單編輯器(非畫布),其餘為畫布繪製。
        const block = extractMermaidBlocks(doc)[blockIndex ?? 0];
        const kw = (block?.title ?? '').toLowerCase();
        const DRAWABLE = [
          'flowchart',
          'graph',
          'statediagram',
          'statediagram-v2',
          'erdiagram',
          'classdiagram',
          'classdiagram-v2',
          'mindmap',
          'sequencediagram',
          'timeline',
          'orid',
        ];
        if (!DRAWABLE.includes(kw)) {
          void vscode.window.showInformationMessage(
            t(
              'Visual editing currently supports flowchart / graph / stateDiagram / erDiagram / classDiagram / mindmap / sequenceDiagram / timeline / orid. This diagram is "{0}" — use "Edit Diagram" to preview the other types instead.',
              block?.title ?? t('unknown'),
            ),
          );
          return;
        }
        await EditorPanel.createOrShow(context, doc, blockIndex ?? 0);
      },
    ),
    // Canvas shortcuts as real keybindings, scoped to the drawing panel.
    // Inside a webview a keystroke only reaches the page while VS Code considers
    // the webview focused — the panel can be the active tab with the focus still
    // in the workbench — so every shortcut is contributed here as well and
    // forwarded in. The webview ignores a stroke it already saw itself.
    vscode.commands.registerCommand('superMermaid.editorKey', (args: unknown) => {
      const stroke = asKeyStroke(args);
      if (stroke) EditorPanel.current?.sendKey(stroke);
    }),
    vscode.commands.registerCommand('superMermaid.openToSide', async (uri?: vscode.Uri) => {
      // Invoked from the explorer context menu with a file URI, or from the
      // editor title / context menu / command palette without arguments.
      let doc: vscode.TextDocument | undefined;
      if (uri instanceof vscode.Uri) {
        doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
      } else {
        doc = vscode.window.activeTextEditor?.document;
      }
      if (!doc || !isSupportedDoc(doc)) {
        void vscode.window.showInformationMessage(
          t('Super Mermaid: open a Markdown or Mermaid (.mmd) file first.'),
        );
        return;
      }
      await PreviewPanel.createOrShow(context, doc);
    }),
    vscode.commands.registerCommand(
      'superMermaid.openMarkdownPreview',
      async (uri?: vscode.Uri) => {
        const doc = await resolveMarkdownDoc(uri);
        if (doc) {
          await MarkdownPreviewPanel.createOrShow(context, doc, false, true);
        }
      },
    ),
    vscode.commands.registerCommand(
      'superMermaid.openMarkdownPreviewInNewWindow',
      async (uri?: vscode.Uri) => {
        const doc = await resolveMarkdownDoc(uri);
        if (doc) {
          await MarkdownPreviewPanel.createOrShow(context, doc, true);
        }
      },
    ),
    vscode.workspace.onDidChangeTextDocument((e) => {
      PreviewPanel.current?.onDocumentChanged(e.document);
      EditorPanel.current?.onDocumentChanged(e.document);
      MarkdownPreviewPanel.current?.onDocumentChanged(e.document);
      if (e.document === vscode.window.activeTextEditor?.document) {
        statusBar.scheduleRefresh(vscode.window.activeTextEditor);
      }
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      PreviewPanel.current?.onSelectionChanged(e.textEditor);
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      MarkdownPreviewPanel.current?.onEditorScrolled(e.textEditor);
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      statusBar.refresh(editor);
      if (editor && isSupportedDoc(editor.document)) {
        PreviewPanel.current?.onActiveEditorChanged(editor.document);
      }
      if (editor && isMarkdownDoc(editor.document)) {
        MarkdownPreviewPanel.current?.onActiveEditorChanged(editor.document);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics.clear(doc.uri);
    }),
    // 介面語言(superMermaid.language)改變:面板的字串是開啟當下產生的,
    // 全部重建一次,使用者才不用關掉再開。
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('superMermaid.language')) {
        return;
      }
      codeLensProvider.refreshLocale();
      statusBar.refreshLocale(vscode.window.activeTextEditor);
      EditorPanel.current?.refreshLocale();
      PreviewPanel.current?.refreshLocale();
      MarkdownPreviewPanel.current?.refreshLocale();
    }),
  );
}

export function deactivate(): void {}
