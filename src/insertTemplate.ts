import * as vscode from 'vscode';
import { blockAtPosition } from './mermaidExtract';
import { PreviewPanel } from './previewPanel';
import { fencedBody, MermaidTemplate, TEMPLATES, TemplateCategory } from './templates';

const CATEGORY_ORDER: TemplateCategory[] = ['Core', 'Charts', 'Planning', 'Architecture', 'Other'];

interface TemplateItem extends vscode.QuickPickItem {
  template?: MermaidTemplate;
}

function buildItems(): TemplateItem[] {
  const items: TemplateItem[] = [];
  for (const category of CATEGORY_ORDER) {
    const group = TEMPLATES.filter((t) => t.category === category);
    if (group.length === 0) {
      continue;
    }
    items.push({ label: category, kind: vscode.QuickPickItemKind.Separator });
    for (const t of group) {
      items.push({ label: t.label, description: t.description, detail: t.diagramType, template: t });
    }
  }
  return items;
}

export function registerInsertTemplateCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand('superMermaid.insertTemplate', async () => {
    const picked = await vscode.window.showQuickPick(buildItems(), {
      placeHolder: 'Select a Mermaid template to insert',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked?.template) {
      return;
    }
    const template = picked.template;

    let editor = vscode.window.activeTextEditor;
    if (!editor || !['markdown', 'mermaid'].includes(editor.document.languageId)) {
      // No suitable target: open a fresh untitled mermaid document.
      const doc = await vscode.workspace.openTextDocument({ language: 'mermaid', content: '' });
      editor = await vscode.window.showTextDocument(doc, { preview: false });
      await editor.insertSnippet(new vscode.SnippetString(template.body), new vscode.Position(0, 0));
      await PreviewPanel.createOrShow(context, editor.document);
      return;
    }

    const doc = editor.document;
    const cursorLine = editor.selection.active.line;
    // markdown 內、且游標不在既有 mermaid 區塊中 → 包 fence;其他情況插 raw。
    const needFence = doc.languageId === 'markdown' && !blockAtPosition(doc, cursorLine);
    let body = needFence ? fencedBody(template.body) : template.body;

    // Insert from column 0 so insertSnippet's auto re-indent can't shift the
    // fence/diagram; if the cursor line already has content, start a new line.
    const lineText = doc.lineAt(cursorLine).text;
    let position = new vscode.Position(cursorLine, 0);
    if (lineText.trim()) {
      position = new vscode.Position(cursorLine, lineText.length);
      body = '\n' + body;
    }
    if (needFence) {
      body = body + '\n';
    }
    await editor.insertSnippet(new vscode.SnippetString(body), position);
    await PreviewPanel.createOrShow(context, doc);
  });
}
