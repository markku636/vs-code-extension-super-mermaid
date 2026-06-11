import * as vscode from 'vscode';
import { MermaidCodeLensProvider } from './codeLensProvider';
import { MermaidCompletionProvider } from './completionProvider';
import { MermaidDiagnostics } from './diagnostics';
import { registerInsertTemplateCommand } from './insertTemplate';
import { isSupportedDoc } from './mermaidExtract';
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
        await vscode.window.showTextDocument(doc, { preview: false });
        await PreviewPanel.createOrShow(context, doc, blockIndex);
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
