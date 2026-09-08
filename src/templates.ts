// Single source of truth for diagram templates: consumed by the
// "Insert Diagram Template" QuickPick command and by scripts/genSnippets.mjs
// (which generates snippets/mermaid.json and snippets/markdown.json at build).
// Bodies use VS Code SNIPPET syntax: tab stops ${n:placeholder}, final $0,
// literal "$" must be escaped as "\\$".

import { RU_BODIES } from './templatesRu';

export type TemplateCategory = 'Core' | 'Charts' | 'Planning' | 'Architecture' | 'Other';

export interface MermaidTemplate {
  id: string;
  label: string;
  /** English source text; shown in the QuickPick description column, translated at runtime. */
  description: string;
  diagramType: string;
  category: TemplateCategory;
  /** Snippet prefix, e.g. "mmd-flow". */
  prefix: string;
  body: string;
}

export const TEMPLATES: readonly MermaidTemplate[] = [
  // ── Core ────────────────────────────────────────────────────────────────
  {
    id: 'flowchart-basic',
    label: 'Flowchart - Basic',
    description: 'Basic flowchart: start, decision branch, end',
    diagramType: 'flowchart',
    category: 'Core',
    prefix: 'mmd-flow',
    body: `flowchart TD
    A([\${1:Start}]) --> B{\${2:Is it valid?}}
    B -- Yes --> C[\${3:Process data}]
    B -- No --> D[\${4:Show error}]
    C --> E([End])
    D --> E$0`,
  },
  {
    id: 'flowchart-subgraph',
    label: 'Flowchart - Subgraphs',
    description: 'Flowchart with subgraphs: client / server zones and links across them',
    diagramType: 'flowchart',
    category: 'Core',
    prefix: 'mmd-flow-sub',
    body: `flowchart LR
    subgraph Client
        A[Browser] --> B[\${1:SPA}]
    end
    subgraph Server
        C[API Gateway] --> D[\${2:Service}]
        D --> E[(Database)]
    end
    B -->|HTTPS| C$0`,
  },
  {
    id: 'sequence-alt',
    label: 'Sequence - autonumber + alt',
    description: 'Sequence diagram: autonumber and an alt conditional branch',
    diagramType: 'sequenceDiagram',
    category: 'Core',
    prefix: 'mmd-seq',
    body: `sequenceDiagram
    autonumber
    actor U as \${1:User}
    participant S as \${2:Server}
    participant DB as Database
    U->>S: Login request
    S->>DB: Query user
    DB-->>S: User record
    alt credentials valid
        S-->>U: 200 OK + token
    else invalid
        S-->>U: 401 Unauthorized
    end$0`,
  },
  {
    id: 'class-basic',
    label: 'Class - Inheritance',
    description: 'Class diagram: inheritance, fields and methods',
    diagramType: 'classDiagram',
    category: 'Core',
    prefix: 'mmd-class',
    body: `classDiagram
    class \${1:Animal} {
        +String name
        +int age
        +makeSound() void
    }
    class \${2:Dog} {
        +fetch() void
    }
    class Cat {
        -bool indoor
    }
    \${1:Animal} <|-- \${2:Dog}
    \${1:Animal} <|-- Cat$0`,
  },
  {
    id: 'state-v2',
    label: 'State - Transitions',
    description: 'State diagram v2: transitions with start and end points',
    diagramType: 'stateDiagram-v2',
    category: 'Core',
    prefix: 'mmd-state',
    body: `stateDiagram-v2
    [*] --> Idle
    Idle --> \${1:Running} : start
    \${1:Running} --> Paused : pause
    Paused --> \${1:Running} : resume
    \${1:Running} --> [*] : stop$0`,
  },
  {
    id: 'er-basic',
    label: 'ER - Database',
    description: 'ER diagram: primary keys and a one-to-many relationship',
    diagramType: 'erDiagram',
    category: 'Core',
    prefix: 'mmd-er',
    body: `erDiagram
    \${1:CUSTOMER} ||--o{ \${2:ORDER} : places
    \${2:ORDER} ||--|{ ORDER_ITEM : contains
    PRODUCT ||--o{ ORDER_ITEM : "ordered in"
    \${1:CUSTOMER} {
        int id PK
        string name
        string email
    }
    \${2:ORDER} {
        int id PK
        date created_at
    }$0`,
  },
  // ── Charts ──────────────────────────────────────────────────────────────
  {
    id: 'pie-basic',
    label: 'Pie Chart',
    description: 'Pie chart: share of each item',
    diagramType: 'pie',
    category: 'Charts',
    prefix: 'mmd-pie',
    body: `pie title \${1:Browser Share}
    "Chrome" : 62
    "Safari" : 20
    "Edge" : 10
    "Other" : 8$0`,
  },
  {
    id: 'quadrant',
    label: 'Quadrant Chart',
    description: 'Quadrant chart: positioning across four quadrants',
    diagramType: 'quadrantChart',
    category: 'Charts',
    prefix: 'mmd-quad',
    body: `quadrantChart
    title \${1:Reach and engagement}
    x-axis Low Reach --> High Reach
    y-axis Low Engagement --> High Engagement
    quadrant-1 Expand
    quadrant-2 Promote
    quadrant-3 Re-evaluate
    quadrant-4 Improve
    Campaign A: [0.3, 0.6]
    Campaign B: [0.45, 0.23]
    Campaign C: [0.78, 0.34]$0`,
  },
  {
    id: 'xychart',
    label: 'XY Chart (beta)',
    description: 'XY chart (beta): bars plus a line',
    diagramType: 'xychart-beta',
    category: 'Charts',
    prefix: 'mmd-xy',
    body: `xychart-beta
    title "\${1:Sales Revenue}"
    x-axis [Jan, Feb, Mar, Apr, May, Jun]
    y-axis "Revenue (k)" 0 --> 100
    bar [25, 48, 38, 60, 72, 85]
    line [20, 40, 45, 55, 70, 90]$0`,
  },
  {
    id: 'sankey',
    label: 'Sankey (beta)',
    description: 'Sankey (beta): flow distribution (three CSV columns)',
    diagramType: 'sankey-beta',
    category: 'Charts',
    prefix: 'mmd-sankey',
    body: `sankey-beta
    \${1:Traffic},Organic,420
    \${1:Traffic},Ads,260
    Organic,Signup,180
    Ads,Signup,90
    Signup,Paid,60$0`,
  },
  // ── Planning ────────────────────────────────────────────────────────────
  {
    id: 'gantt-basic',
    label: 'Gantt',
    description: 'Gantt: sections and dependent tasks',
    diagramType: 'gantt',
    category: 'Planning',
    prefix: 'mmd-gantt',
    body: `gantt
    title \${1:Project Plan}
    dateFormat YYYY-MM-DD
    section Design
        Requirements :done, a1, \${2:2026-06-01}, 5d
        Mockups      :active, a2, after a1, 7d
    section Build
        Implementation :b1, after a2, 14d
        Testing        :b2, after b1, 7d$0`,
  },
  {
    id: 'timeline',
    label: 'Timeline',
    description: 'Timeline: events grouped into periods',
    diagramType: 'timeline',
    category: 'Planning',
    prefix: 'mmd-timeline',
    body: `timeline
    title \${1:Product History}
    section 2024
        Q3 : Prototype
        Q4 : Private beta
    section 2025
        Q1 : Public launch
        Q3 : Mobile app
    section 2026
        Q1 : Enterprise tier$0`,
  },
  {
    id: 'journey',
    label: 'User Journey',
    description: 'User journey: tasks with satisfaction scores',
    diagramType: 'journey',
    category: 'Planning',
    prefix: 'mmd-journey',
    body: `journey
    title \${1:Checkout experience}
    section Browse
        Search products: 5: Customer
        Compare options: 3: Customer
    section Purchase
        Add to cart: 4: Customer
        Pay: 2: Customer, Support
    section After
        Track delivery: 4: Customer$0`,
  },
  {
    id: 'kanban',
    label: 'Kanban',
    description: 'Kanban: columns and work items',
    diagramType: 'kanban',
    category: 'Planning',
    prefix: 'mmd-kanban',
    body: `kanban
    Todo
        [\${1:Design login page}]
        [Write API spec]
    In progress
        [Implement auth]
    Done
        [Project setup]$0`,
  },
  {
    id: 'mindmap',
    label: 'Mindmap',
    description: 'Mindmap: a central topic and its branches',
    diagramType: 'mindmap',
    category: 'Planning',
    prefix: 'mmd-mind',
    body: `mindmap
  root((\${1:Project}))
    Goals
      Launch MVP
      Grow users
    Risks
      Scope creep
      Timeline
    Team
      Backend
      Frontend$0`,
  },
  // ── Architecture ────────────────────────────────────────────────────────
  {
    id: 'c4-context',
    label: 'C4 - System Context',
    description: 'C4 system context: people, systems and boundaries',
    diagramType: 'C4Context',
    category: 'Architecture',
    prefix: 'mmd-c4',
    body: `C4Context
    title \${1:System Context}
    Person(user, "User", "A customer of the platform")
    System(app, "\${2:Web App}", "Provides the core features")
    System_Ext(mail, "Mail Service", "Sends notifications")
    Rel(user, app, "Uses")
    Rel(app, mail, "Sends email via")$0`,
  },
  {
    id: 'architecture',
    label: 'Architecture (beta)',
    description: 'Architecture (beta): groups, services and links',
    diagramType: 'architecture-beta',
    category: 'Architecture',
    prefix: 'mmd-arch',
    body: `architecture-beta
    group cloud(cloud)[\${1:Cloud}]
    service api(server)[API] in cloud
    service db(database)[Database] in cloud
    service disk(disk)[Storage] in cloud
    api:R --> L:db
    db:R --> L:disk$0`,
  },
  {
    id: 'block',
    label: 'Block (beta)',
    description: 'Block (beta): column layout and arrows',
    diagramType: 'block-beta',
    category: 'Architecture',
    prefix: 'mmd-block',
    body: `block-beta
    columns 3
    Frontend blockArrowId<["API"]>(right) Backend
    space down1<[" "]>(down) space
    Cache["\${1:Cache}"] space DB[("Database")]$0`,
  },
  {
    id: 'packet',
    label: 'Packet (beta)',
    description: 'Packet (beta): bit-field layout',
    diagramType: 'packet-beta',
    category: 'Architecture',
    prefix: 'mmd-packet',
    body: `packet-beta
    0-15: "Source Port"
    16-31: "Destination Port"
    32-63: "Sequence Number"
    64-95: "Acknowledgment Number"$0`,
  },
  {
    id: 'gitgraph',
    label: 'Git Graph',
    description: 'Git graph: branch / merge / tag',
    diagramType: 'gitGraph',
    category: 'Architecture',
    prefix: 'mmd-git',
    body: `gitGraph
    commit id: "init"
    branch \${1:feature}
    checkout \${1:feature}
    commit id: "work"
    commit id: "more work"
    checkout main
    merge \${1:feature} tag: "v1.0"
    commit id: "hotfix"$0`,
  },
  // ── Other ───────────────────────────────────────────────────────────────
  {
    id: 'requirement',
    label: 'Requirement',
    description: 'Requirement diagram: requirements, elements and satisfies relations',
    diagramType: 'requirementDiagram',
    category: 'Other',
    prefix: 'mmd-req',
    body: `requirementDiagram
    requirement \${1:login_req} {
        id: 1
        text: Users must be able to log in.
        risk: medium
        verifymethod: test
    }
    element auth_service {
        type: service
    }
    auth_service - satisfies -> \${1:login_req}$0`,
  },
  {
    id: 'orid-retro',
    label: 'ORID - Focused Conversation',
    description: 'ORID focused conversation: objective → reflective → interpretive → decisional',
    diagramType: 'orid',
    category: 'Other',
    prefix: 'mmd-orid',
    body: `orid
    title \${1:Post-release retrospective}
    objective
        \${2:Error rate after release: 3.2%}
        Average latency 850ms
    reflective
        \${3:The team feels anxious}
        More complaints from users
    interpretive
        \${4:The monitoring gap is the root cause}
    decisional
        \${5:Add alerting @owner 8/25}
        Add load tests @owner 9/1$0`,
  },
  {
    id: 'orid-blank',
    label: 'ORID - Blank Four Stages',
    description: 'ORID blank skeleton: all four stage headings, content left to fill in during the meeting',
    diagramType: 'orid',
    category: 'Other',
    prefix: 'mmd-orid-blank',
    body: `orid
    title \${1:Discussion topic}
    objective
        \${2:What did you see / hear? Verifiable facts only}
    reflective
        \${3:Feelings and gut reactions in the moment}
    interpretive
        \${4:What does this mean? Root causes and insights}
    decisional
        \${5:What happens next? Who owns it and by when}$0`,
  },
];

/** Strip snippet tab-stop markers, returning plain mermaid source. */
export function plainSource(template: MermaidTemplate): string {
  return template.body
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\{\d+\|([^|,}]+)[^}]*\}/g, '$1')
    .replace(/\$\d+/g, '')
    .replace(/\\\$/g, '$');
}

/**
 * The template body for a VS Code display language. Falls back to the English
 * body whenever a locale has no translated variant.
 */
export function localizedBody(template: MermaidTemplate, locale: string): string {
  if (locale.toLowerCase().startsWith('ru')) {
    return RU_BODIES[template.id] ?? template.body;
  }
  return template.body;
}

/** Wrap a snippet body in a ```mermaid fence (markdown insertion). */
export function fencedBody(body: string): string {
  return '```mermaid\n' + body + '\n```';
}
