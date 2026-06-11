import * as vscode from 'vscode';
import { blockAtPosition } from './mermaidExtract';

interface KeywordSet {
  keywords: string[];
  operators: string[];
  /** [label, snippet body] pairs */
  snippets: Array<[string, string]>;
}

const DIAGRAM_TYPES = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'gantt',
  'pie',
  'mindmap',
  'timeline',
  'journey',
  'gitGraph',
  'quadrantChart',
  'requirementDiagram',
  'C4Context',
  'xychart-beta',
  'sankey-beta',
  'block-beta',
  'packet-beta',
  'kanban',
  'architecture-beta',
];

const SETS: Record<string, KeywordSet> = {
  flowchart: {
    keywords: [
      'subgraph',
      'end',
      'direction',
      'TD',
      'TB',
      'LR',
      'RL',
      'BT',
      'classDef',
      'class',
      'style',
      'linkStyle',
      'click',
    ],
    operators: ['-->', '---', '-.->', '==>', '--o', '--x', '<-->', 'o--o', 'x--x'],
    snippets: [
      ['node [rect]', '${1:id}[${2:label}]'],
      ['node (rounded)', '${1:id}(${2:label})'],
      ['node ((circle))', '${1:id}((${2:label}))'],
      ['node {diamond}', '${1:id}{${2:label}}'],
      ['node {{hexagon}}', '${1:id}{{${2:label}}}'],
      ['node [(database)]', '${1:id}[(${2:db})]'],
      ['node [[subroutine]]', '${1:id}[[${2:subroutine}]]'],
      ['edge with label', '${1:a} -->|${2:label}| ${3:b}'],
      ['subgraph block', 'subgraph ${1:name}\n\t$0\nend'],
    ],
  },
  sequenceDiagram: {
    keywords: [
      'participant',
      'actor',
      'activate',
      'deactivate',
      'autonumber',
      'loop',
      'alt',
      'else',
      'opt',
      'par',
      'and',
      'critical',
      'break',
      'rect',
      'box',
      'end',
      'create',
      'destroy',
    ],
    operators: ['->>', '-->>', '->', '-->', '-)', '--)', '-x', '--x'],
    snippets: [
      ['Note right of', 'Note right of ${1:actor}: ${2:text}'],
      ['Note left of', 'Note left of ${1:actor}: ${2:text}'],
      ['Note over', 'Note over ${1:a},${2:b}: ${3:text}'],
      ['loop block', 'loop ${1:label}\n\t$0\nend'],
      ['alt/else block', 'alt ${1:case}\n\t$2\nelse\n\t$0\nend'],
    ],
  },
  classDiagram: {
    keywords: ['class', 'namespace', 'direction', '<<interface>>', '<<abstract>>', '<<enumeration>>'],
    operators: ['<|--', '*--', 'o--', '-->', '--', '..>', '..|>', '..'],
    snippets: [['class block', 'class ${1:Name} {\n\t$0\n}']],
  },
  stateDiagram: {
    keywords: ['state', 'direction', 'note', 'end note'],
    operators: ['-->', '--'],
    snippets: [
      ['initial transition', '[*] --> ${1:State}'],
      ['composite state', 'state ${1:name} {\n\t$0\n}'],
      ['fork', '<<fork>>'],
      ['join', '<<join>>'],
      ['choice', '<<choice>>'],
      ['note block', 'note right of ${1:state}\n\t$0\nend note'],
    ],
  },
  erDiagram: {
    keywords: ['PK', 'FK', 'UK'],
    operators: ['||--o{', '||--||', '}o--o{', '|o--o|', '}|--|{'],
    snippets: [
      ['relationship', '${1:A} ||--o{ ${2:B} : ${3:has}'],
      ['entity block', '${1:ENTITY} {\n\t${2:type} ${3:name}\n}'],
    ],
  },
  gantt: {
    keywords: [
      'title',
      'dateFormat',
      'axisFormat',
      'excludes',
      'todayMarker',
      'tickInterval',
      'section',
      'done',
      'active',
      'crit',
      'milestone',
      'after',
      'weekend',
    ],
    operators: [],
    snippets: [
      ['section', 'section ${1:name}'],
      ['task', '${1:Task} :${2:id}, ${3:2026-01-01}, ${4:3d}'],
    ],
  },
  pie: {
    keywords: ['title', 'showData'],
    operators: [],
    snippets: [['slice', '"${1:label}" : ${2:42}']],
  },
  mindmap: {
    keywords: [],
    operators: [],
    snippets: [
      ['root node', 'root((${1:topic}))'],
      ['icon', '::icon(${1:fa fa-book})'],
      ['rounded node', '(${1:rounded})'],
      ['square node', '[${1:square}]'],
      ['circle node', '((${1:circle}))'],
    ],
  },
};

const COMMON_SNIPPETS: Array<[string, string]> = [
  ['comment', '%% ${1:comment}'],
  ['init directive', "%%{init: {'theme': '${1:default}'}}%%"],
  ['frontmatter title', '---\ntitle: ${1:Title}\n---'],
];

function setFor(diagramType: string): KeywordSet | undefined {
  if (diagramType === 'graph') {
    return SETS.flowchart;
  }
  if (diagramType.startsWith('stateDiagram')) {
    return SETS.stateDiagram;
  }
  return SETS[diagramType];
}

export class MermaidCompletionProvider implements vscode.CompletionItemProvider {
  public provideCompletionItems(
    doc: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    const block = blockAtPosition(doc, position.line);
    if (!block) {
      return undefined; // markdown outside a mermaid fence → let other providers run
    }

    const linePrefix = doc.lineAt(position.line).text.slice(0, position.character);
    const items: vscode.CompletionItem[] = [];

    if (this.isTypePosition(doc, block.startLine, position.line, linePrefix)) {
      for (const t of DIAGRAM_TYPES) {
        const item = new vscode.CompletionItem(t, vscode.CompletionItemKind.Keyword);
        if (t === 'flowchart' || t === 'graph') {
          item.insertText = new vscode.SnippetString(`${t} \${1|TD,LR,BT,RL|}\n$0`);
        }
        items.push(item);
      }
      return items;
    }

    const set = setFor(block.title);
    if (set) {
      for (const kw of set.keywords) {
        items.push(new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword));
      }
      // Arrows are made of non-word characters, so the default word-range
      // replacement breaks once the user has typed "--": compute the operator
      // prefix manually and replace it.
      const opPrefix = linePrefix.match(/[<>ox.=|){(-]+$/)?.[0] ?? '';
      for (const op of set.operators) {
        const item = new vscode.CompletionItem(op, vscode.CompletionItemKind.Operator);
        if (opPrefix) {
          item.range = new vscode.Range(position.translate(0, -opPrefix.length), position);
          item.filterText = op;
        }
        items.push(item);
      }
      for (const [label, body] of set.snippets) {
        const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
        item.insertText = new vscode.SnippetString(body);
        items.push(item);
      }
    }

    for (const [label, body] of COMMON_SNIPPETS) {
      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
      item.insertText = new vscode.SnippetString(body);
      items.push(item);
    }
    return items;
  }

  /** First content line of the block (or block still empty) → offer diagram types. */
  private isTypePosition(
    doc: vscode.TextDocument,
    fenceLine: number,
    line: number,
    linePrefix: string,
  ): boolean {
    if (!/^\s*[\w-]*$/.test(linePrefix)) {
      return false;
    }
    const contentStart = doc.languageId === 'mermaid' ? 0 : fenceLine + 1;
    for (let l = contentStart; l < line; l++) {
      const text = doc.lineAt(l).text.trim();
      if (text && !text.startsWith('%%')) {
        return false; // a content line above already declares the type
      }
    }
    return true;
  }
}
