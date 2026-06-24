import * as vscode from 'vscode';
import { MermaidCodeLensProvider } from './codeLensProvider';
import { MermaidCompletionProvider } from './completionProvider';
import { MermaidDiagnostics } from './diagnostics';
import { EditorPanel } from './editorPanel';
import { registerInsertTemplateCommand } from './insertTemplate';
import { extractMermaidBlocks, isSupportedDoc } from './mermaidExtract';
import { PreviewPanel } from './previewPanel';
import { MermaidStatusBar } from './statusBar';

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
            'Super Mermaid: 請先開啟 Markdown 或 Mermaid (.mmd) 檔案。',
          );
          return;
        }
        // 繪製 / 表單編輯器支援的圖種才放行;其他圖種沒有對應解析器,硬開會把原圖覆寫 → 擋下並提示。
        // timeline 走結構化表單編輯器(非畫布),其餘為畫布繪製。
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
        ];
        if (!DRAWABLE.includes(kw)) {
          void vscode.window.showInformationMessage(
            `Mermaid 視覺編輯目前支援 flowchart / graph / stateDiagram / erDiagram / classDiagram / mindmap / sequenceDiagram / timeline;此圖為「${block?.title ?? '未知'}」。` +
              '其他圖種請改用「Edit Diagram」預覽。',
          );
          return;
        }
        await EditorPanel.createOrShow(context, doc, blockIndex ?? 0);
      },
    ),
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
          'Super Mermaid: open a Markdown or Mermaid (.mmd) file first.',
        );
        return;
      }
      await PreviewPanel.createOrShow(context, doc);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      PreviewPanel.current?.onDocumentChanged(e.document);
      EditorPanel.current?.onDocumentChanged(e.document);
      if (e.document === vscode.window.activeTextEditor?.document) {
        statusBar.scheduleRefresh(vscode.window.activeTextEditor);
      }
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      PreviewPanel.current?.onSelectionChanged(e.textEditor);
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      statusBar.refresh(editor);
      if (editor && isSupportedDoc(editor.document)) {
        PreviewPanel.current?.onActiveEditorChanged(editor.document);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics.clear(doc.uri);
    }),
  );
}

export function deactivate(): void {}
