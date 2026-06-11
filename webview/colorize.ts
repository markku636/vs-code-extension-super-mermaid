// Post-render beautifier for the "Colorful" style: repaints diagrams with a
// modern palette (Tailwind 100-fills / 500-strokes) and layers on the polish
// you would expect from commercial tools — rounded corners, soft drop
// shadows, smoother edge strokes — on top of mermaid's output.
// Works on the live preview DOM, the built-in markdown preview DOM, and the
// detached export DOM.

export interface ColorizeOptions {
  dark?: boolean;
}

interface PaletteEntry {
  fill: string;
  stroke: string;
}

const NODE_PALETTE: PaletteEntry[] = [
  { fill: '#DBEAFE', stroke: '#3B82F6' }, // blue
  { fill: '#DCFCE7', stroke: '#22C55E' }, // green
  { fill: '#FFEDD5', stroke: '#F97316' }, // orange
  { fill: '#F3E8FF', stroke: '#A855F7' }, // purple
  { fill: '#FEE2E2', stroke: '#EF4444' }, // red
  { fill: '#CFFAFE', stroke: '#06B6D4' }, // cyan
  { fill: '#FEF9C3', stroke: '#EAB308' }, // yellow
  { fill: '#EDE9FE', stroke: '#8B5CF6' }, // violet
];

const CLUSTER_PALETTE: PaletteEntry[] = [
  { fill: 'rgba(59, 130, 246, 0.07)', stroke: '#93C5FD' },
  { fill: 'rgba(34, 197, 94, 0.07)', stroke: '#86EFAC' },
  { fill: 'rgba(249, 115, 22, 0.07)', stroke: '#FDBA74' },
  { fill: 'rgba(168, 85, 247, 0.07)', stroke: '#D8B4FE' },
  { fill: 'rgba(6, 182, 212, 0.07)', stroke: '#67E8F9' },
  { fill: 'rgba(239, 68, 68, 0.07)', stroke: '#FCA5A5' },
];

const NODE_TEXT = '#1F2937';
const SHADOW_FILTER_ID = 'sm-soft-shadow';
const SVG_NS = 'http://www.w3.org/2000/svg';

function resolveSvg(root: ParentNode): Element | null {
  if (root instanceof Element && root.tagName.toLowerCase() === 'svg') {
    return root;
  }
  return root.querySelector('svg');
}

/** Soft drop shadow shared by every node shape — the single biggest "commercial tool" cue. */
function ensureShadowFilter(svg: Element): void {
  if (svg.querySelector(`#${SHADOW_FILTER_ID}`)) {
    return;
  }
  let defs = svg.querySelector(':scope > defs');
  if (!defs) {
    defs = document.createElementNS(SVG_NS, 'defs');
    svg.insertBefore(defs, svg.firstChild);
  }
  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.setAttribute('id', SHADOW_FILTER_ID);
  filter.setAttribute('x', '-25%');
  filter.setAttribute('y', '-25%');
  filter.setAttribute('width', '150%');
  filter.setAttribute('height', '150%');
  const drop = document.createElementNS(SVG_NS, 'feDropShadow');
  drop.setAttribute('dx', '0');
  drop.setAttribute('dy', '1.5');
  drop.setAttribute('stdDeviation', '2');
  drop.setAttribute('flood-color', '#0F172A');
  drop.setAttribute('flood-opacity', '0.22');
  filter.appendChild(drop);
  defs.appendChild(filter);
}

function roundRect(shape: SVGElement, radius: number): void {
  if (shape.tagName.toLowerCase() !== 'rect') {
    return;
  }
  // Stadium-style nodes already carry a large rx — don't flatten them.
  const rx = Number(shape.getAttribute('rx') ?? '0');
  if (rx < radius + 1) {
    shape.setAttribute('rx', String(radius));
    shape.setAttribute('ry', String(radius));
  }
}

function paintShapes(group: Element, entry: PaletteEntry): void {
  const direct = Array.from(
    group.querySelectorAll<SVGElement>(
      ':scope > rect, :scope > polygon, :scope > circle, :scope > ellipse, :scope > path',
    ),
  );
  if (direct.length > 0) {
    for (const shape of direct) {
      shape.style.fill = entry.fill;
      shape.style.stroke = entry.stroke;
      shape.style.strokeWidth = '1.4px';
      roundRect(shape, 8);
    }
    direct[0].setAttribute('filter', `url(#${SHADOW_FILTER_ID})`);
    return;
  }
  // v11 unified-renderer nodes (e.g. erDiagram entities) nest their shapes in
  // child groups instead: g.outer-path holds the background and border paths,
  // g.row-rect-odd/even the attribute rows, g.divider the separators.
  for (const path of Array.from(group.querySelectorAll<SVGElement>(':scope > g.outer-path > *'))) {
    if (path.getAttribute('fill') && path.getAttribute('fill') !== 'none') {
      path.style.fill = entry.fill;
      path.setAttribute('filter', `url(#${SHADOW_FILTER_ID})`);
    }
    if (path.getAttribute('stroke') && path.getAttribute('stroke') !== 'none') {
      path.style.stroke = entry.stroke;
      path.style.strokeWidth = '1.4px';
    }
  }
  for (const row of Array.from(group.querySelectorAll<SVGElement>(':scope > g.row-rect-odd > *'))) {
    row.style.fill = 'rgba(255, 255, 255, 0.55)';
  }
  for (const row of Array.from(group.querySelectorAll<SVGElement>(':scope > g.row-rect-even > *'))) {
    row.style.fill = 'rgba(255, 255, 255, 0.3)';
  }
  for (const divider of Array.from(group.querySelectorAll<SVGElement>(':scope > g.divider > *'))) {
    divider.style.stroke = entry.stroke;
  }
}

function darkenNodeText(group: Element): void {
  // Pastel fills are light, so node labels must be dark in both VS Code themes.
  for (const el of Array.from(group.querySelectorAll<SVGTextElement>('text, tspan'))) {
    el.style.fill = NODE_TEXT;
  }
  for (const el of Array.from(group.querySelectorAll<HTMLElement>('.nodeLabel, span, p'))) {
    el.style.color = NODE_TEXT;
  }
}

/** Muted slate edges with round caps read far cleaner than mermaid's defaults. */
function styleEdges(svg: Element, dark: boolean): void {
  const edgeColor = dark ? '#94A3B8' : '#64748B';
  const edgeSelectors = [
    '.edgePaths path',
    'g.edgePath path',
    'path.flowchart-link',
    'path.relationshipLine',
    'line.messageLine0',
    'line.messageLine1',
    'path.messageLine0',
    'path.messageLine1',
  ].join(', ');
  for (const edge of Array.from(svg.querySelectorAll<SVGElement>(edgeSelectors))) {
    edge.style.stroke = edgeColor;
    edge.style.strokeWidth = '1.7px';
    edge.style.strokeLinecap = 'round';
  }
  for (const marker of Array.from(svg.querySelectorAll<SVGElement>('marker path'))) {
    marker.style.fill = edgeColor;
    marker.style.stroke = edgeColor;
  }
}

function styleEdgeLabels(svg: Element): void {
  for (const label of Array.from(svg.querySelectorAll<HTMLElement>('.edgeLabel span, .edgeLabel p'))) {
    label.style.borderRadius = '6px';
  }
  for (const rect of Array.from(svg.querySelectorAll<SVGElement>('.edgeLabel rect'))) {
    rect.setAttribute('rx', '4');
    rect.setAttribute('ry', '4');
  }
}

export function colorizeDiagram(root: ParentNode, opts: ColorizeOptions = {}): void {
  const svg = resolveSvg(root);
  if (!svg) {
    return;
  }
  ensureShadowFilter(svg);

  // Flowchart / state / class / ER nodes
  Array.from(svg.querySelectorAll<SVGGElement>('g.node')).forEach((node, i) => {
    const entry = NODE_PALETTE[i % NODE_PALETTE.length];
    paintShapes(node, entry);
    darkenNodeText(node);
  });

  // Flowchart subgraphs
  Array.from(svg.querySelectorAll<SVGGElement>('g.cluster')).forEach((cluster, i) => {
    const entry = CLUSTER_PALETTE[i % CLUSTER_PALETTE.length];
    for (const rect of Array.from(cluster.querySelectorAll<SVGElement>(':scope > rect'))) {
      rect.style.fill = entry.fill;
      rect.style.stroke = entry.stroke;
      rect.style.strokeWidth = '1.2px';
      roundRect(rect, 10);
    }
  });

  // Legacy ER markup (mermaid < 11.x): entity title bars
  const erGroups: Element[] = [];
  for (const rect of Array.from(svg.querySelectorAll<SVGElement>('rect.er.entityBox'))) {
    const group = rect.parentElement;
    if (group && !erGroups.includes(group)) {
      erGroups.push(group);
    }
  }
  erGroups.forEach((group, i) => {
    const entry = NODE_PALETTE[i % NODE_PALETTE.length];
    const headers = Array.from(group.querySelectorAll<SVGElement>('rect.er.entityBox'));
    for (const rect of headers.slice(0, 1)) {
      rect.style.fill = entry.fill;
      rect.style.stroke = entry.stroke;
    }
    for (const label of Array.from(group.querySelectorAll<SVGElement>('text.er.entityLabel'))) {
      label.style.fill = NODE_TEXT;
    }
  });

  // Sequence-diagram actor boxes (top and bottom rows pair up by index)
  const actors = Array.from(svg.querySelectorAll<SVGElement>('rect.actor'));
  const perRow = actors.length / 2;
  actors.forEach((rect, i) => {
    const colorIndex = perRow >= 1 && Number.isInteger(perRow) ? i % perRow : i;
    const entry = NODE_PALETTE[colorIndex % NODE_PALETTE.length];
    rect.style.fill = entry.fill;
    rect.style.stroke = entry.stroke;
    rect.style.strokeWidth = '1.4px';
    roundRect(rect, 8);
    rect.setAttribute('filter', `url(#${SHADOW_FILTER_ID})`);
    const group = rect.parentElement;
    if (group) {
      for (const el of Array.from(group.querySelectorAll<SVGElement>('text, tspan'))) {
        el.style.fill = NODE_TEXT;
      }
    }
  });

  styleEdges(svg, opts.dark === true);
  styleEdgeLabels(svg);

  // Type-specific passes, dispatched on the root's aria-roledescription.
  // Unknown types fall through untouched; every styler early-outs on zero
  // matches so a mermaid DOM change can never break rendering.
  const kind = svg.getAttribute('aria-roledescription') ?? '';
  const dark = opts.dark === true;
  if (kind === 'pie' || kind === 'pieChart') {
    stylePie(svg, dark);
  } else if (kind === 'gantt') {
    styleGantt(svg, dark);
  } else if (kind === 'timeline') {
    styleTimeline(svg);
  } else if (kind === 'mindmap') {
    styleMindmap(svg);
  } else if (kind === 'journey') {
    styleJourney(svg);
  }
}

/** Pie: keep mermaid's designed slice palette, just add separation + polish. */
function stylePie(svg: Element, dark: boolean): void {
  const slices = Array.from(svg.querySelectorAll<SVGElement>('path.pieCircle'));
  if (slices.length === 0) {
    return;
  }
  for (const slice of slices) {
    slice.style.stroke = dark ? '#0F172A' : '#FFFFFF';
    slice.style.strokeWidth = '2px';
    slice.style.strokeLinejoin = 'round';
  }
  for (const title of Array.from(svg.querySelectorAll<SVGElement>('text.pieTitleText'))) {
    title.style.fontWeight = '600';
  }
  for (const swatch of Array.from(svg.querySelectorAll<SVGElement>('g.legend rect, rect.legend'))) {
    swatch.setAttribute('rx', '3');
    swatch.setAttribute('ry', '3');
  }
}

/** Gantt: color bars by section, keep done/active/crit semantics untouched. */
function styleGantt(svg: Element, dark: boolean): void {
  const tasks = Array.from(svg.querySelectorAll<SVGElement>('rect.task'));
  if (tasks.length === 0) {
    return;
  }
  for (const task of tasks) {
    const cls = task.getAttribute('class') ?? '';
    // classes look like "task task1", "task done0", "task active0", ...
    if (/\b(done|active|crit|milestone)\d*\b/.test(cls)) {
      continue;
    }
    const m = cls.match(/task(\d+)/);
    if (!m) {
      continue;
    }
    const entry = NODE_PALETTE[Number(m[1]) % NODE_PALETTE.length];
    task.style.fill = entry.fill;
    task.style.stroke = entry.stroke;
    task.setAttribute('rx', '4');
    task.setAttribute('ry', '4');
  }
  Array.from(svg.querySelectorAll<SVGElement>('rect.section')).forEach((band) => {
    const m = (band.getAttribute('class') ?? '').match(/section(\d+)/);
    if (m) {
      band.style.fill = CLUSTER_PALETTE[Number(m[1]) % CLUSTER_PALETTE.length].fill;
    }
  });
  for (const inBar of Array.from(svg.querySelectorAll<SVGElement>('text.taskText'))) {
    if (!/Outside/.test(inBar.getAttribute('class') ?? '')) {
      inBar.style.fill = NODE_TEXT;
    }
  }
  for (const tick of Array.from(svg.querySelectorAll<SVGElement>('g.grid g.tick line'))) {
    tick.style.stroke = dark ? '#334155' : '#E2E8F0';
  }
}

/** Timeline: same-section nodes share a color (keyed by section-N class). */
function styleTimeline(svg: Element): void {
  const nodes = Array.from(svg.querySelectorAll<SVGGElement>('g[class*="timeline-node"]'));
  nodes.forEach((node, i) => {
    const m = (node.getAttribute('class') ?? '').match(/section-(-?\d+)/);
    const section = m ? Number(m[1]) : i;
    const entry = section < 0 ? NODE_PALETTE[7] : NODE_PALETTE[section % NODE_PALETTE.length];
    // The background shape is a nested path.node-bkg, not a direct child.
    const backgrounds = Array.from(node.querySelectorAll<SVGElement>('.node-bkg'));
    if (backgrounds.length > 0) {
      for (const bkg of backgrounds) {
        bkg.style.fill = entry.fill;
        bkg.style.stroke = entry.stroke;
        bkg.style.strokeWidth = '1.4px';
      }
    } else {
      paintShapes(node, entry);
    }
    darkenNodeText(node);
  });
}

/** Mindmap: keyed by section-N class so siblings of one branch share a color. */
function styleMindmap(svg: Element): void {
  const nodes = Array.from(svg.querySelectorAll<SVGGElement>('g.mindmap-node'));
  if (nodes.length === 0) {
    return;
  }
  for (const node of nodes) {
    const m = (node.getAttribute('class') ?? '').match(/section-(-?\d+)/);
    const section = m ? Number(m[1]) : 0;
    const entry =
      section < 0
        ? NODE_PALETTE[7] // root → violet
        : NODE_PALETTE[section % NODE_PALETTE.length];
    for (const shape of Array.from(
      node.querySelectorAll<SVGElement>('path, rect, circle, ellipse'),
    )) {
      if (shape.closest('g.children')) {
        continue; // only the node's own shape, not descendants
      }
      shape.style.fill = entry.fill;
      shape.style.stroke = entry.stroke;
      shape.style.strokeWidth = '1.4px';
    }
    darkenNodeText(node);
  }
  for (const edge of Array.from(svg.querySelectorAll<SVGElement>('path[class*="edge"]'))) {
    const m = (edge.getAttribute('class') ?? '').match(/section-edge-(-?\d+)/);
    if (m) {
      const section = Number(m[1]);
      const entry = section < 0 ? NODE_PALETTE[7] : NODE_PALETTE[section % NODE_PALETTE.length];
      edge.style.stroke = entry.stroke;
      edge.style.strokeWidth = '2px';
      edge.style.opacity = '0.6';
      edge.style.fill = 'none';
    }
  }
}

/** Journey: tint task circles per type, keep the smiley faces untouched. */
function styleJourney(svg: Element): void {
  const tasks = Array.from(svg.querySelectorAll<SVGElement>('circle[class*="task-type"], rect[class*="task-type"]'));
  tasks.forEach((shape) => {
    const m = (shape.getAttribute('class') ?? '').match(/task-type-(\d+)/);
    if (m) {
      const entry = NODE_PALETTE[Number(m[1]) % NODE_PALETTE.length];
      shape.style.fill = entry.fill;
      shape.style.stroke = entry.stroke;
    }
  });
  Array.from(svg.querySelectorAll<SVGElement>('rect[class*="section-type"]')).forEach((rect) => {
    const m = (rect.getAttribute('class') ?? '').match(/section-type-(\d+)/);
    if (m) {
      const entry = CLUSTER_PALETTE[Number(m[1]) % CLUSTER_PALETTE.length];
      rect.style.fill = entry.fill;
      rect.style.stroke = entry.stroke;
    }
  });
}
