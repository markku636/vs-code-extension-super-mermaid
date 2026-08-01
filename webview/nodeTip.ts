// Node hover tooltips for the preview: a cursor-following HTML tip showing the
// node's full label, its author id, any authored `%% @tip` text, and the
// click-to-source hint. Native SVG <title> is not used on purpose — it is slow
// (~1s), single-line, and ignores the editor theme.
//
// `%% @tip` syntax (shared with react-super-mermaid, so diagrams written for
// the library light up here too):
//
//   %% @tip NodeId text shown on hover
//   %%   indented comment lines continue the same tip
//   %% @tip "Node label" match by label instead of id
//
// Directives are plain mermaid comments, so they never need stripping before
// mermaid.render().

export interface TipEntry {
  target: string;
  /** true = target matches the node's visible label (quoted form). */
  matchLabel: boolean;
  text: string;
}

const TIP_START_RE = /^@tip\b\s*(.*)$/i;
const QUOTED_TARGET_RE = /^"([^"]+)"\s*(.*)$/;
const BARE_TARGET_RE = /^(\S+)\s*(.*)$/;

/** Comment-line body ("%% foo" → "foo"); undefined for non-comments and `%%{init}`. */
function commentBody(line: string): string | undefined {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith('%%') || trimmed.startsWith('%%{')) {
    return undefined;
  }
  const body = trimmed.slice(2).replace(/\r$/, '');
  return body.startsWith(' ') ? body.slice(1) : body;
}

export function parseTipDirectives(source: string): TipEntry[] {
  if (!source.includes('@tip')) {
    return [];
  }
  const tips: TipEntry[] = [];
  let current: TipEntry | undefined;
  for (const line of source.split('\n')) {
    const body = commentBody(line);
    if (body === undefined) {
      if (line.trim()) {
        current = undefined; // real statements end the tip; blank lines don't
      }
      continue;
    }
    const start = TIP_START_RE.exec(body.trim());
    if (start) {
      current = undefined;
      const rest = start[1].trim();
      if (!rest) {
        continue;
      }
      const quoted = QUOTED_TARGET_RE.exec(rest);
      const bare = quoted ?? BARE_TARGET_RE.exec(rest);
      if (bare) {
        current = { target: bare[1], matchLabel: Boolean(quoted), text: bare[2].trim() };
        tips.push(current);
      }
      continue;
    }
    if (current && /^\s/.test(body)) {
      const cont = body.trim();
      current.text = current.text ? `${current.text}\n${cont}` : cont;
      continue;
    }
    current = undefined;
  }
  return tips.filter((t) => t.text);
}

export interface TipContent {
  title: string;
  body: string;
  /** Muted trailing line (id + click hint). */
  meta: string;
}

export interface NodeTipHost {
  /** Positioned container the tip div lives in (#canvas). */
  canvas: HTMLElement;
  /** Event-delegation root (#diagram). */
  diagram: HTMLElement;
  /** Enclosing node group for an event target (shared with click-to-source). */
  groupFor(target: EventTarget | null): Element | undefined;
  /** Tooltip content for a node group; undefined = no tip for this node. */
  contentFor(group: Element): TipContent | undefined;
  /** false while a mode that owns the pointer is active (presentation…). */
  enabled(): boolean;
}

export interface NodeTipController {
  /** Hide immediately (re-render, mode switches, export…). */
  hide(): void;
}

const SHOW_DELAY = 150;
const OFFSET_X = 14;
const OFFSET_Y = 18;
const EDGE_PAD = 6;

export function attachNodeTips(host: NodeTipHost): NodeTipController {
  const el = document.createElement('div');
  el.id = 'node-tip';
  el.setAttribute('role', 'tooltip');
  const titleEl = document.createElement('div');
  titleEl.className = 'node-tip-title';
  const bodyEl = document.createElement('div');
  bodyEl.className = 'node-tip-body';
  const metaEl = document.createElement('div');
  metaEl.className = 'node-tip-meta';
  el.append(titleEl, bodyEl, metaEl);
  host.canvas.appendChild(el);

  let current: Element | undefined;
  let visible = false;
  let suppressed = false; // while the pointer is down (pan drag)
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let lastX = 0;
  let lastY = 0;

  function hide(): void {
    clearTimeout(showTimer);
    showTimer = undefined;
    visible = false;
    el.classList.remove('show');
  }

  function position(): void {
    const rect = host.canvas.getBoundingClientRect();
    let left = lastX - rect.left + OFFSET_X;
    let top = lastY - rect.top + OFFSET_Y;
    // Flip to the cursor's other side near the right/bottom edge, then clamp.
    if (left + el.offsetWidth > host.canvas.clientWidth - EDGE_PAD) {
      left = lastX - rect.left - el.offsetWidth - OFFSET_X;
    }
    if (top + el.offsetHeight > host.canvas.clientHeight - EDGE_PAD) {
      top = lastY - rect.top - el.offsetHeight - OFFSET_Y;
    }
    el.style.left = `${Math.max(EDGE_PAD, left)}px`;
    el.style.top = `${Math.max(EDGE_PAD, top)}px`;
  }

  function scheduleShow(group: Element): void {
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      if (suppressed || current !== group || !group.isConnected || !host.enabled()) {
        return;
      }
      const content = host.contentFor(group);
      if (!content) {
        return;
      }
      titleEl.textContent = content.title;
      titleEl.hidden = !content.title;
      bodyEl.textContent = content.body;
      bodyEl.hidden = !content.body;
      metaEl.textContent = content.meta;
      metaEl.hidden = !content.meta;
      visible = true;
      position();
      el.classList.add('show');
    }, SHOW_DELAY);
  }

  host.diagram.addEventListener('pointerover', (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
    const group = host.groupFor(e.target);
    if (group === current) {
      return;
    }
    current = group;
    hide();
    if (group && !suppressed && host.enabled()) {
      scheduleShow(group);
    }
  });
  host.diagram.addEventListener('pointermove', (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
    if (visible) {
      position();
    }
  });
  host.diagram.addEventListener('pointerout', (e) => {
    // Moving between children of the same group is not a leave.
    if (current && e.relatedTarget instanceof Element && current.contains(e.relatedTarget)) {
      return;
    }
    current = undefined;
    hide();
  });
  host.diagram.addEventListener('pointerdown', () => {
    suppressed = true;
    hide();
  });
  // Drags often end outside the diagram — listen on window or the tip sticks hidden.
  window.addEventListener('pointerup', () => {
    suppressed = false;
    if (current) {
      scheduleShow(current);
    }
  });

  return { hide };
}
