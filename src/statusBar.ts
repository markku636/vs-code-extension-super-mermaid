import * as vscode from 'vscode';
import { extractMermaidBlocks, isSupportedDoc } from './mermaidExtract';

/** Status bar entry: "$(graph) N diagrams" for the active markdown/mermaid editor. */
export class MermaidStatusBar implements vscode.Disposable {
  private static readonly DEBOUNCE_MS = 300;

  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor() {
    this.item.command = 'superMermaid.openToSide';
    this.item.tooltip = 'Open Super Mermaid preview';
  }

  public refresh(editor: vscode.TextEditor | undefined): void {
    if (!editor || !isSupportedDoc(editor.document)) {
      this.item.hide();
      return;
    }
    const count = extractMermaidBlocks(editor.document).length;
    if (count === 0) {
      this.item.hide();
      return;
    }
    this.item.text = `$(graph) ${count} diagram${count === 1 ? '' : 's'}`;
    this.item.show();
  }

  public scheduleRefresh(editor: vscode.TextEditor | undefined): void {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.refresh(editor), MermaidStatusBar.DEBOUNCE_MS);
  }

  public dispose(): void {
    clearTimeout(this.debounceTimer);
    this.item.dispose();
  }
}
