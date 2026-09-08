import * as vscode from 'vscode';
import { t } from './uiLocale';
import { extractMermaidBlocks, isSupportedDoc } from './mermaidExtract';

/** 「Draw / Edit」CodeLens 的提示文字;key 為圖種首關鍵字(小寫),default 為畫布圖種。 */
function editTooltip(kw: string): string {
  switch (kw) {
    case 'timeline':
      return t(
        'Edit this timeline in a structured form (sections / points / events, written back on change)',
      );
    case 'orid':
      return t(
        'Edit this ORID focused conversation in a structured form (four stages, written back on change)',
      );
    default:
      return t(
        'Open this diagram in the Excalidraw-style drawing editor (drag nodes / edges, written back on change)',
      );
  }
}

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

  /** 介面語言改變 → CodeLens 標題要重新產生。 */
  public refreshLocale(): void {
    this.changeEmitter.fire();
  }

  public provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!isSupportedDoc(doc)) {
      return [];
    }
    return extractMermaidBlocks(doc).flatMap((block, index) => {
      const range = new vscode.Range(block.startLine, 0, block.startLine, 0);
      const lenses = [
        new vscode.CodeLens(range, {
          title: `$(edit) ${t('Edit Diagram')}`,
          tooltip: t('Open the Super Mermaid preview focused on this diagram'),
          command: 'superMermaid.editDiagram',
          arguments: [doc.uri, index],
        }),
        new vscode.CodeLens(range, {
          title: `$(multiple-windows) ${t('Open in New Window')}`,
          tooltip: t(
            'Open the Super Mermaid preview for this diagram in a separate floating window',
          ),
          command: 'superMermaid.editDiagramInNewWindow',
          arguments: [doc.uri, index],
        }),
      ];
      // 繪製編輯器支援的圖種才顯示編輯入口(避免在尚未支援的圖種誤開覆寫)。
      // 畫布圖種 → 「Draw」(拖拉繪製);timeline / orid 等資料圖表 → 「Edit」(結構化表單)。
      const kw = (block.title ?? '').toLowerCase();
      const isForm = kw === 'timeline' || kw === 'orid';
      if (
        kw === 'flowchart' ||
        kw === 'graph' ||
        kw === 'statediagram' ||
        kw === 'statediagram-v2' ||
        kw === 'erdiagram' ||
        kw === 'classdiagram' ||
        kw === 'classdiagram-v2' ||
        kw === 'mindmap' ||
        kw === 'sequencediagram' ||
        isForm
      ) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: isForm
              ? `$(edit) ${t('Edit')}`
              : `$(edit) ${t('Draw')}`,
            tooltip: editTooltip(kw),
            command: 'superMermaid.editDiagramVisually',
            arguments: [doc.uri, index],
          }),
        );
      }
      return lenses;
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
