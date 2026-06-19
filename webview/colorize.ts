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

// Swimlane / subgraph tints. Hues mirror NODE_PALETTE; fills are strong
// enough (16% vs the old 7%) and borders saturated enough that adjacent
// lanes are easy to tell apart at a glance.
const CLUSTER_PALETTE: PaletteEntry[] = [
  { fill: 'rgba(59, 130, 246, 0.16)', stroke: '#3B82F6' }, // blue
  { fill: 'rgba(34, 197, 94, 0.16)', stroke: '#22C55E' }, // green
  { fill: 'rgba(249, 115, 22, 0.16)', stroke: '#F97316' }, // orange
  { fill: 'rgba(168, 85, 247, 0.16)', stroke: '#A855F7' }, // purple
  { fill: 'rgba(239, 68, 68, 0.16)', stroke: '#EF4444' }, // red
  { fill: 'rgba(6, 182, 212, 0.16)', stroke: '#06B6D4' }, // cyan
  { fill: 'rgba(234, 179, 8, 0.16)', stroke: '#EAB308' }, // yellow
  { fill: 'rgba(139, 92, 246, 0.16)', stroke: '#8B5CF6' }, // violet
];

// Vibrant palette for pie / donut charts. Mermaid's default dark-base pie
// colours are dim and muddy ("dead"); this set is saturated with well-spaced
// hues so slices pop and stay easy to tell apart.
const PIE_PALETTE = [
  '#3B82F6', // blue
  '#22C55E', // green
  '#F59E0B', // amber
  '#A855F7', // purple
  '#EF4444', // red
  '#06B6D4', // cyan
  '#EC4899', // pink
  '#84CC16', // lime
  '#F97316', // orange
  '#14B8A6', // teal
  '#6366F1', // indigo
  '#EAB308', // yellow
];

const NODE_TEXT = '#1F2937';
const SHADOW_FILTER_ID = 'sm-soft-shadow';
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Normalize a colour to "r,g,b" so an attribute hex and an inline-style rgb match. */
function canonColor(input: string): string {
  const s = (input || '').trim();
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) {
      h = h
        .split('')
        .map((c) => c + c)
        .join('');
    }
    const n = parseInt(h, 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }
  const rgb = /rgba?\(([^)]+)\)/i.exec(s);
  if (rgb) {
    const p = rgb[1].split(',').map((x) => Math.round(parseFloat(x)));
    return `${p[0]},${p[1]},${p[2]}`;
  }
  return s.toLowerCase();
}

/** Pick white or dark text for a fill, by sRGB luminance, so labels stay legible. */
function readableTextOn(color: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) {
    return '#FFFFFF';
  }
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#1F2937' : '#FFFFFF';
}

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
  const edgeColor = dark ? '#94A3B8' : '#475569';
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

/**
 * Sequence message labels and flowchart edge labels keep mermaid's faint
 * default colour, which disappears on a light canvas background — repaint them
 * dark (or light in dark mode) so they stay legible like Excalidraw's.
 */
function styleLabelText(svg: Element, dark: boolean): void {
  const color = dark ? '#E2E8F0' : NODE_TEXT;
  for (const t of Array.from(
    svg.querySelectorAll<SVGElement>('text.messageText, .edgeLabel text, .edgeLabel tspan'),
  )) {
    t.style.fill = color;
  }
  for (const t of Array.from(svg.querySelectorAll<HTMLElement>('.edgeLabel span, .edgeLabel p'))) {
    t.style.color = color;
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

  // Flowchart subgraphs ("swimlanes"): distinct tint + saturated border, and
  // a matching bold title so even similarly-sized lanes are easy to tell apart.
  Array.from(svg.querySelectorAll<SVGGElement>('g.cluster')).forEach((cluster, i) => {
    const entry = CLUSTER_PALETTE[i % CLUSTER_PALETTE.length];
    for (const rect of Array.from(cluster.querySelectorAll<SVGElement>(':scope > rect'))) {
      rect.style.fill = entry.fill;
      rect.style.stroke = entry.stroke;
      rect.style.strokeWidth = '1.5px';
      roundRect(rect, 10);
    }
    // Title sits in g.cluster-label as either an HTML label (live preview) or a
    // <text> node (htmlLabels:false export) — colour + embolden both forms.
    const label = cluster.querySelector(':scope > .cluster-label');
    if (label) {
      for (const el of Array.from(label.querySelectorAll<SVGTextElement>('text, tspan'))) {
        el.style.fill = entry.stroke;
        el.style.fontWeight = '700';
      }
      for (const el of Array.from(label.querySelectorAll<HTMLElement>('.nodeLabel, span, p'))) {
        el.style.color = entry.stroke;
        el.style.fontWeight = '700';
      }
      for (const lr of Array.from(label.querySelectorAll<SVGElement>('rect'))) {
        lr.style.fill = entry.fill;
      }
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
  styleLabelText(svg, opts.dark === true);

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

/**
 * Lighter-touch pass for the Sketch theme: leave mermaid's hand-drawn shapes
 * alone (no recolouring/shadows that would fight the whiteboard look), but
 * darken the edges and message/edge labels — mermaid's defaults are too faint,
 * especially against the light paper canvas.
 */
export function enhanceContrast(root: ParentNode, opts: ColorizeOptions = {}): void {
  const svg = resolveSvg(root);
  if (!svg) {
    return;
  }
  styleEdges(svg, opts.dark === true);
  styleLabelText(svg, opts.dark === true);
}

/** Pie / donut: repaint with the vibrant palette (mermaid's defaults read dead),
 * add white separators + contrast-aware labels. */
function stylePie(svg: Element, dark: boolean): void {
  const slices = Array.from(svg.querySelectorAll<SVGElement>('path.pieCircle'));
  const swatches = Array.from(svg.querySelectorAll<SVGElement>('g.legend rect, rect.legend'));
  if (slices.length === 0 && swatches.length === 0) {
    return;
  }

  // Key the remap on the CURRENT fill: mermaid colours slices and their legend
  // swatch from one ordinal scale keyed on label, so equal fills = same datum.
  const remap = new Map<string, string>();
  let next = 0;
  const newColorFor = (old: string): string => {
    const key = canonColor(old) || `#slot-${next}`;
    let c = remap.get(key);
    if (!c) {
      c = PIE_PALETTE[next % PIE_PALETTE.length];
      remap.set(key, c);
      next += 1;
    }
    return c;
  };

  for (const slice of slices) {
    const old = slice.style.fill || slice.getAttribute('fill') || '';
    const c = newColorFor(old);
    slice.style.fill = c;
    slice.style.opacity = '1'; // dark base theme's pieOpacity < 1 greys slices out.
    slice.style.stroke = dark ? '#0F172A' : '#FFFFFF';
    slice.style.strokeWidth = '2px';
    slice.style.strokeLinejoin = 'round';
  }
  for (const sw of swatches) {
    const old = sw.style.fill || sw.getAttribute('fill') || '';
    const c = newColorFor(old);
    sw.style.fill = c;
    sw.style.stroke = c;
    sw.setAttribute('rx', '3');
    sw.setAttribute('ry', '3');
  }
  // Percent labels share the slice order — pick white/dark per slice colour.
  Array.from(svg.querySelectorAll<SVGElement>('text.slice')).forEach((label, i) => {
    const slice = slices[i];
    const c = slice ? slice.style.fill || PIE_PALETTE[0] : PIE_PALETTE[0];
    label.style.fill = readableTextOn(c);
    label.style.fontWeight = '600';
  });
  for (const title of Array.from(svg.querySelectorAll<SVGElement>('text.pieTitleText'))) {
    title.style.fontWeight = '700';
    title.style.fill = dark ? '#E2E8F0' : '#1F2937';
  }
  for (const t of Array.from(svg.querySelectorAll<SVGElement>('g.legend text'))) {
    t.style.fill = dark ? '#E2E8F0' : '#1F2937';
  }
  for (const oc of Array.from(svg.querySelectorAll<SVGElement>('circle.pieOuterCircle'))) {
    oc.style.stroke = dark ? '#334155' : '#CBD5E1';
  }
}

/**
 * Same label weights as boostLegibility, but declared as CSS and injected into
 * <head> BEFORE the first mermaid.render(). boostLegibility() bumps weight
 * AFTER render — yet mermaid sizes each label's <foreignObject> from the text
 * width it measures DURING render, so post-hoc bold spills past the box and the
 * <foreignObject> clips the trailing glyph (the missing "d" in
 * "react-super-mermaid", etc.). Pre-declaring the weights makes mermaid measure
 * the bold metrics so the box already fits. The selectors only ever match
 * rendered mermaid diagrams, so this is safe even in the shared markdown-preview
 * DOM. Must run before any render — callers invoke it from initMermaid().
 */
export const LEGIBILITY_CSS = `
g.node text, g.node tspan, g.node .nodeLabel,
g.mindmap-node text, g.mindmap-node .nodeLabel,
g[class*="timeline-node"] text, text.actor { font-weight: 600 !important; }
.cluster-label text, .cluster-label .nodeLabel,
text.pieTitleText { font-weight: 700 !important; }
`;

let legibilityInjected = false;
export function ensureLegibilityStyles(): void {
  if (legibilityInjected || typeof document === 'undefined') {
    return;
  }
  legibilityInjected = true;
  if (document.getElementById('sm-legibility-metrics')) {
    return;
  }
  const style = document.createElement('style');
  style.id = 'sm-legibility-metrics';
  style.textContent = LEGIBILITY_CSS;
  (document.head ?? document.documentElement).appendChild(style);
}

/**
 * Legibility booster applied to EVERY theme (colorful, sketch, and the native
 * default/dark/neutral/forest pass-throughs): bumps label font-weight so small
 * text and thumbnails read clearly. Weight-only, so it never fights a theme's
 * colours.
 */
export function boostLegibility(root: ParentNode): void {
  const svg = resolveSvg(root);
  if (!svg) {
    return;
  }
  // Titles are left to each styler (which sets a heavier 700) so we don't knock
  // an already-bold colorful title back down to 600.
  for (const el of Array.from(
    svg.querySelectorAll<SVGElement>(
      'g.node text, g.node tspan, g.mindmap-node text, g[class*="timeline-node"] text, text.actor',
    ),
  )) {
    el.style.fontWeight = '600';
  }
  for (const el of Array.from(svg.querySelectorAll<HTMLElement>('.nodeLabel, g.node span, g.node p'))) {
    el.style.fontWeight = '600';
  }
  for (const el of Array.from(svg.querySelectorAll<SVGElement>('text'))) {
    if (!el.style.fontWeight) {
      el.style.fontWeight = '500';
    }
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
