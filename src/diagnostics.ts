import * as vscode from 'vscode';
import { MermaidBlock } from './mermaidExtract';

export interface BlockError {
  index: number;
  message: string;
  /** 1-based line within the block source, or null when mermaid didn't say. */
  line: number | null;
}

/**
 * Editor squiggles for mermaid syntax errors. Validation runs inside the
 * preview webview (the extension host has no DOM for mermaid.parse), so
 * diagnostics are live while the preview is open and cleared when it closes.
 */
export class MermaidDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('mermaid');

  public publish(doc: vscode.TextDocument, blocks: MermaidBlock[], errors: BlockError[]): void {
    const diags: vscode.Diagnostic[] = [];
    for (const err of errors) {
      const block = blocks[err.index];
      if (!block) {
        continue;
      }
      const contentStart = doc.languageId === 'mermaid' ? 0 : block.startLine + 1;
      // mermaid's preprocessor can shift reported lines by one — clamp into
      // the block so the squiggle never lands on the fence or outside it.
      let line = contentStart + (err.line ?? 1) - 1;
      line = Math.max(contentStart, Math.min(line, block.endLine, doc.lineCount - 1));
      const diag = new vscode.Diagnostic(
        doc.lineAt(line).range,
        err.message,
        vscode.DiagnosticSeverity.Error,
      );
      diag.source = 'mermaid';
      diags.push(diag);
    }
    this.collection.set(doc.uri, diags);
  }

  public clear(uri: vscode.Uri): void {
    this.collection.delete(uri);
  }

  public clearAll(): void {
    this.collection.clear();
  }

  public dispose(): void {
    this.collection.dispose();
  }
}
