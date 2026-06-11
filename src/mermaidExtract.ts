import * as vscode from 'vscode';

export interface MermaidBlock {
  source: string;
  /** Line of the opening fence (0-based). For .mmd files this is 0. */
  startLine: number;
  /** Line of the closing fence (0-based). For .mmd files this is the last line. */
  endLine: number;
  /** Diagram type keyword, e.g. "flowchart", "sequenceDiagram". */
  title: string;
  /** Frontmatter `title:` when the block starts with a YAML frontmatter section. */
  displayTitle?: string;
}

export interface ExtractOptions {
  /**
   * Also return fences whose content is still empty/blank. The preview skips
   * them, but completions need the block boundaries while the user is typing
   * the very first line.
   */
  includeEmpty?: boolean;
}

export function isSupportedDoc(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'markdown' || doc.languageId === 'mermaid';
}

export function extractMermaidBlocks(
  doc: vscode.TextDocument,
  opts: ExtractOptions = {},
): MermaidBlock[] {
  if (doc.languageId === 'mermaid') {
    const text = doc.getText();
    if (!text.trim() && !opts.includeEmpty) {
      return [];
    }
    return [
      {
        source: text,
        startLine: 0,
        endLine: Math.max(0, doc.lineCount - 1),
        title: diagramType(text),
        displayTitle: frontmatterTitle(text),
      },
    ];
  }

  const blocks: MermaidBlock[] = [];
  const lines = doc.getText().split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(/^\s*(`{3,}|~{3,})\s*(.*)$/);
    if (!open) {
      i++;
      continue;
    }
    const fence = open[1];
    const lang = (open[2].trim().split(/\s+/)[0] ?? '').toLowerCase();
    let j = i + 1;
    while (j < lines.length && !isClosingFence(lines[j], fence)) {
      j++;
    }
    if (lang === 'mermaid' || lang === 'mmd') {
      const source = lines.slice(i + 1, j).join('\n');
      if (source.trim() || opts.includeEmpty) {
        blocks.push({
          source,
          startLine: i,
          endLine: Math.min(j, lines.length - 1),
          title: diagramType(source),
          displayTitle: frontmatterTitle(source),
        });
      }
    }
    i = j + 1;
  }
  return blocks;
}

/**
 * The block whose content contains the given document line (for completions).
 * Unclosed fences (still being typed) accept lines up to EOF.
 */
export function blockAtPosition(
  doc: vscode.TextDocument,
  line: number,
): MermaidBlock | undefined {
  if (doc.languageId === 'mermaid') {
    return extractMermaidBlocks(doc, { includeEmpty: true })[0];
  }
  const blocks = extractMermaidBlocks(doc, { includeEmpty: true });
  return blocks.find((b) => {
    const closed = isClosingFence(doc.lineAt(b.endLine).text, fenceOf(doc, b));
    // Inside the fence content: strictly after the opening fence and, when the
    // fence is closed, strictly before the closing fence.
    return line > b.startLine && (closed ? line < b.endLine : line <= b.endLine);
  });
}

function fenceOf(doc: vscode.TextDocument, block: MermaidBlock): string {
  const m = doc.lineAt(block.startLine).text.match(/^\s*(`{3,}|~{3,})/);
  return m?.[1] ?? '```';
}

function isClosingFence(line: string, openFence: string): boolean {
  const m = line.match(/^\s*(`{3,}|~{3,})\s*$/);
  return m !== null && m[1][0] === openFence[0] && m[1].length >= openFence.length;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** mermaid only honors YAML frontmatter when it starts on the very first line. */
function frontmatterTitle(source: string): string | undefined {
  const m = source.match(FRONTMATTER_RE);
  if (!m) {
    return undefined;
  }
  const t = m[1].match(/^\s*title\s*:\s*(['"]?)(.+?)\1\s*$/m);
  return t?.[2].trim() || undefined;
}

function diagramType(source: string): string {
  // Skip the frontmatter section, otherwise the type would read as "---".
  const body = source.replace(FRONTMATTER_RE, '');
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) {
      continue;
    }
    return line.split(/[\s:({]/)[0] || 'diagram';
  }
  return 'diagram';
}
