import * as vscode from 'vscode';
import { extractMermaidBlocks, isMermaidFileDoc, MermaidBlock } from './mermaidExtract';
import { parseTipDirectives } from '../webview/nodeTip';
import { isOridSource, oridStageByKeyword } from 'react-super-mermaid/orid';

/**
 * Hover hints for mermaid sources: hovering a node id shows its label, shape,
 * how many statements reference it, plus any authored `%% @tip` /
 * `%% @check` text for that node — so the "runbook in the diagram" is readable
 * without opening the preview.
 */

/** Node-id shaped word (mermaid ids allow letters, digits, `_` and `-`). */
const WORD_RE = /[A-Za-z0-9_-]+/;

/** Statement keywords that also match WORD_RE — never node ids. */
const KEYWORDS = new Set([
  'flowchart', 'graph', 'subgraph', 'end', 'direction',
  'sequencediagram', 'participant', 'actor', 'activate', 'deactivate',
  'loop', 'alt', 'else', 'opt', 'par', 'and', 'rect', 'note', 'over', 'box',
  'classdiagram', 'class', 'statediagram', 'statediagram-v2', 'state',
  'erdiagram', 'journey', 'gantt', 'pie', 'mindmap', 'timeline',
  'quadrantchart', 'xychart-beta', 'title', 'section', 'style', 'classdef',
  'click', 'linkstyle', 'acctitle', 'accdescr',
  'td', 'tb', 'lr', 'rl', 'bt',
]);

/** Flowchart node shapes, most-specific opener first (`[[` before `[` …). */
const SHAPES: { open: string; re: RegExp; name: string }[] = [
  { open: '(["', re: /^\(\["?(.+?)"?\]\)/, name: 'stadium' },
  { open: '[[', re: /^\[\["?(.+?)"?\]\]/, name: 'subroutine' },
  { open: '[(', re: /^\[\("?(.+?)"?\)\]/, name: 'database' },
  { open: '((', re: /^\(\("?(.+?)"?\)\)/, name: 'circle' },
  { open: '{{', re: /^\{\{"?(.+?)"?\}\}/, name: 'hexagon' },
  { open: '[/', re: /^\[\/"?(.+?)"?\/\]/, name: 'parallelogram' },
  { open: '[\\', re: /^\[\\"?(.+?)"?\\\]/, name: 'parallelogram' },
  { open: '>', re: /^>"?(.+?)"?\]/, name: 'asymmetric' },
  { open: '[', re: /^\["?(.+?)"?\]/, name: 'rectangle' },
  { open: '(', re: /^\("?(.+?)"?\)/, name: 'rounded' },
  { open: '{', re: /^\{"?(.+?)"?\}/, name: 'decision' },
];

/** Arrow tokens across flowchart / sequence / class / state diagrams. */
const ARROW_RE = /-->|---|-\.->|-\.-|==>|===|--[xo)]|-[xo)]|->>|-->>|<<--|<-->|<--|->|\.\.>|\|>|\*--|o--/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanLabel(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^["']|["']$/g, '')
    .trim();
}

interface NodeInfo {
  label?: string;
  shape?: string;
  /** 0-based line inside the block source where the node is defined. */
  defLine?: number;
}

/** Find the definition (label + shape) of `id` inside one block source. */
function findDefinition(source: string, id: string): NodeInfo {
  const esc = escapeRegExp(id);
  const lines = source.split('\n');
  const headRe = new RegExp(`(?:^|[^\\w"'-])${esc}(?=[^\\w-]|$)`);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trimStart().startsWith('%%')) {
      continue;
    }
    // sequence: participant X as Label / actor X
    const part = new RegExp(`^\\s*(participant|actor)\\s+${esc}(?:\\s+as\\s+(.+))?\\s*$`).exec(line);
    if (part) {
      return { label: cleanLabel(part[2] ?? id), shape: part[1], defLine: i };
    }
    // state: state "Label" as X
    const st = new RegExp(`^\\s*state\\s+"(.+?)"\\s+as\\s+${esc}\\s*$`).exec(line);
    if (st) {
      return { label: cleanLabel(st[1]), shape: 'state', defLine: i };
    }
    // flowchart: X[Label] / X(Label) / …  — the shape opener must follow the id directly.
    const m = headRe.exec(line);
    if (m) {
      const after = line.slice(m.index + m[0].length);
      for (const shape of SHAPES) {
        if (!after.startsWith(shape.open[0])) {
          continue;
        }
        const hit = shape.re.exec(after);
        if (hit) {
          return { label: cleanLabel(hit[1]), shape: shape.name, defLine: i };
        }
      }
    }
  }
  return {};
}

/** How many statements connect this node to something (best-effort). */
function countConnections(source: string, id: string): number {
  const idRe = new RegExp(`(?:^|[^\\w-])${escapeRegExp(id)}(?:[^\\w-]|$)`);
  let count = 0;
  for (const line of source.split('\n')) {
    if (line.trimStart().startsWith('%%')) {
      continue;
    }
    if (idRe.test(line) && ARROW_RE.test(line)) {
      count += 1;
    }
  }
  return count;
}

interface CheckSummary {
  title: string;
  severity: string;
  desc?: string;
}

/** Light-weight `%% @check` reader — only what the hover shows (title/severity/desc). */
function checksFor(source: string, id: string, label: string | undefined): CheckSummary[] {
  if (!source.includes('@check')) {
    return [];
  }
  const out: CheckSummary[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const head = /^\s*%%\s*@check\s+("([^"]+)"|\S+)\s*(.*)$/i.exec(lines[i]);
    if (!head) {
      continue;
    }
    const target = head[2] ?? head[1];
    const matches =
      target === id || (label !== undefined && target.toLowerCase() === label.toLowerCase());
    if (!matches) {
      continue;
    }
    const check: CheckSummary = { title: head[3].trim() || target, severity: 'info' };
    for (let j = i + 1; j < lines.length; j += 1) {
      const field = /^\s*%%\s*(severity|desc)\s*:\s*(.*)$/i.exec(lines[j]);
      if (!field) {
        // stop at the next non-field comment line or statement
        if (!/^\s*%%/.test(lines[j]) || /^\s*%%\s*@/.test(lines[j])) {
          break;
        }
        continue;
      }
      if (field[1].toLowerCase() === 'severity') {
        check.severity = field[2].trim().toLowerCase() || 'info';
      } else {
        check.desc = field[2].trim();
      }
    }
    out.push(check);
  }
  return out;
}

/** The block containing `line`, restricted to its *content* (not the fences). */
function blockAt(doc: vscode.TextDocument, line: number): MermaidBlock | undefined {
  const blocks = extractMermaidBlocks(doc);
  if (isMermaidFileDoc(doc)) {
    return blocks[0];
  }
  return blocks.find((b) => line > b.startLine && line < b.endLine);
}

const SEVERITY_ICON: Record<string, string> = { info: 'ℹ️', warn: '⚠️', error: '🛑' };

export class MermaidHoverProvider implements vscode.HoverProvider {
  public provideHover(
    doc: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Hover> {
    const block = blockAt(doc, position.line);
    if (!block) {
      return undefined;
    }
    const wordRange = doc.getWordRangeAtPosition(position, WORD_RE);
    if (!wordRange) {
      return undefined;
    }
    const word = doc.getText(wordRange);

    // ORID stage keywords come first: they are the one thing people actually need
    // explained while writing one ("what belongs in Reflective, again?"), and the
    // node-id logic below would just bail on them.
    const oridHover = this.oridStageHover(doc, block, position, word, wordRange);
    if (oridHover) {
      return oridHover;
    }

    // Id-shaped words only: WORD_RE also matches arrow fragments ("--x", "->>").
    if (!/^[A-Za-z_][\w-]*$/.test(word) || KEYWORDS.has(word.toLowerCase()) || /^\d+$/.test(word)) {
      return undefined;
    }

    const source = block.source;
    const def = findDefinition(source, word);
    const connections = countConnections(source, word);
    const tips = parseTipDirectives(source).filter(
      (t) =>
        t.target === word ||
        (def.label !== undefined && t.target.toLowerCase() === def.label.toLowerCase()),
    );
    const checks = checksFor(source, word, def.label);

    // Only speak up when the word demonstrably is a node — a definition, an
    // edge, or authored hints. Anything else would spam hovers over prose.
    if (def.label === undefined && connections === 0 && tips.length === 0 && checks.length === 0) {
      return undefined;
    }

    const md = new vscode.MarkdownString();
    const headline = def.label && def.label !== word ? `**${def.label}** — \`${word}\`` : `**${word}**`;
    const details: string[] = [];
    if (def.shape) {
      details.push(def.shape);
    }
    if (connections > 0) {
      details.push(`${connections} connecting statement${connections === 1 ? '' : 's'}`);
    }
    md.appendMarkdown(headline + (details.length ? `  \n${details.join(' · ')}` : ''));
    for (const tip of tips) {
      md.appendMarkdown(`\n\n---\n\n💡 ${tip.text.split('\n').join('  \n')}`);
    }
    for (const check of checks) {
      const icon = SEVERITY_ICON[check.severity] ?? SEVERITY_ICON.info;
      md.appendMarkdown(`\n\n---\n\n${icon} **${check.title}**`);
      if (check.desc) {
        md.appendMarkdown(`  \n${check.desc}`);
      }
    }
    return new vscode.Hover(md, wordRange);
  }

  /**
   * `objective` / `reflective` / `interpretive` / `decisional` at the head of a
   * line inside an ORID block → explain what that stage is for. Requires the
   * word to start the line, so an item that merely mentions "decisional" does
   * not get a facilitation lecture attached to it.
   */
  private oridStageHover(
    doc: vscode.TextDocument,
    block: MermaidBlock,
    position: vscode.Position,
    word: string,
    wordRange: vscode.Range,
  ): vscode.Hover | undefined {
    if (!isOridSource(block.source)) {
      return undefined;
    }
    const line = doc.lineAt(position.line).text;
    if (line.trimStart().indexOf(word) !== 0) {
      return undefined;
    }
    const spec = oridStageByKeyword(word);
    if (!spec) {
      return undefined;
    }
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${spec.ordinal} ${spec.zh} · ${spec.en}**  \n${spec.hint}`);
    md.appendMarkdown(
      '\n\n---\n\n項目寫在下一行並縮排。若項目本身以階段關鍵字開頭,前面加 `-` 強制當成項目。',
    );
    return new vscode.Hover(md, wordRange);
  }
}
