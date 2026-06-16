import * as vscode from 'vscode';
import { extractMermaidBlocks, isSupportedDoc } from './mermaidExtract';

/**
 * 在每個 mermaid 區段的起始行上方顯示「Edit Diagram」與「Open in New Window」
 * 兩個並列 CodeLens。前者開啟預覽並定位到該張圖；後者額外把預覽彈出到獨立視窗。
 */
export class MermaidCodeLensProvider implements vscode.CodeLensProvider {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor() {
    // 文件內容變動 → 區段行號可能位移，通知 VS Code 重新查詢 CodeLens。
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (isSupportedDoc(e.document)) {
          this.changeEmitter.fire();
        }
      }),
    );
  }

  public provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!isSupportedDoc(doc)) {
      return [];
    }
    return extractMermaidBlocks(doc).flatMap((block, index) => {
      const range = new vscode.Range(block.startLine, 0, block.startLine, 0);
      return [
        new vscode.CodeLens(range, {
          title: '$(edit) Edit Diagram',
          tooltip: 'Open the Super Mermaid preview focused on this diagram',
          command: 'superMermaid.editDiagram',
          arguments: [doc.uri, index],
        }),
        new vscode.CodeLens(range, {
          title: '$(multiple-windows) Open in New Window',
          tooltip: 'Open the Super Mermaid preview for this diagram in a separate floating window',
          command: 'superMermaid.editDiagramInNewWindow',
          arguments: [doc.uri, index],
        }),
      ];
    });
  }

  public dispose(): void {
    this.changeEmitter.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}
