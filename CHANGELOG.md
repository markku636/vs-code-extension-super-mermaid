# Changelog

## 0.8.75 — vibrant xychart bars

- **Improvement** (via shared core): xychart bar/line charts are now colourized
  (vibrant bars instead of mermaid's near-invisible pale fill).

## 0.8.74 — pie legend colours match slices

- **Fix** (via shared core): pie-chart legend swatches now match their slice
  colours (were diverging from the 3rd item on under colourful/auto themes).

## 0.8.73 — robust empty diagram

- **Fix** (via shared core): opening an empty / whitespace-only mermaid block in
  the Draw editor no longer throws "No diagram type detected" — the empty-canvas
  hint shows gracefully.

## 0.8.72 — sketch/clean look toggle in the Draw editor

- New **✏ 手繪** toolbar button toggles the canvas between **clean** (crisp
  rounded shapes + soft shadow) and **sketch** (Excalidraw-style hand-drawn
  outlines + handwritten font) at runtime, via the shared core's new
  `setLook`/`getLook`.

## 0.8.x — Visual Draw editor

A full **Excalidraw-style visual editor** that round-trips to clean Mermaid. Click the **✏ Draw** CodeLens above a ```` ```mermaid ```` block (or run **Super Mermaid: Draw Diagram**).

### Diagram types (all draw ↔ mermaid, round-trip idempotent)
- **Flowchart** — shapes, connections, colours, align/distribute, group into subgraphs, flow direction, auto-tidy.
- **State** — states, transitions, `[*]` start/end, composite states; notes / `<<fork>>` / classDef preserved.
- **ER** — entities with attributes (type / name / keys / comment) editable in-place; crow's-foot cardinality.
- **Class** — members & methods compartments (editable), «stereotypes», inheritance / composition / aggregation / dependency.
- **Mindmap** — tree with dedicated layout; node shapes preserved.
- **Sequence** — participants + messages on lifelines; add / edit / delete participants & messages, toggle arrows, notes & fragment boxes; fits the whole diagram on open.

Data charts (pie / gantt / journey / timeline / quadrant / sankey / xychart / gitGraph) are edited with the live preview, not the drag editor.

### Interactions (homage to draw.io / Excalidraw)
- Hover-to-connect from node edges; drag to empty space spawns a connected node.
- Empty-canvas drag pans; Shift+drag marquee-selects; click deselects.
- Double-click to rename / edit cell content; double-click empty canvas adds a node; **Tab** adds a connected node.
- Right-click context menus (shape, colour, align, group, type-specific actions); menu stays on-screen and closes on Escape.
- `Ctrl+D` duplicate · `Ctrl+G` group · arrow-key nudge · undo / redo.
- Built-in **source panel** (live Mermaid + copy) and **SVG / PNG export** (saved via a host dialog).

### Look
- Editor colours match the auto-coloured **Colorful** preview exactly (same palette & order), tinted subgraphs, soft node shadows, readable edge labels & dropdowns.

### 0.8.36 – 0.8.59 — full-fidelity rendering & polish
- **Notation rendered faithfully**: class UML markers (inheritance/composition/aggregation), generics `Foo<T>`, abstract→italic / static→underline; ER crow's-foot cardinality + attribute tables; sequence alt/loop fragments; composite-state & subgraph edges.
- **Custom styling applied**: flowchart `linkStyle` edge colours/widths (matching arrowheads), `classDef`/inline `style` node fill·stroke·width·text-colour, markdown labels (bold/italic/code) on nodes & edges.
- **Layout**: parallel/bidirectional edges fan apart, label-fit node sizing, dark-mode label legibility, compartments fill their box.
- **Data-safety**: relation cardinality, namespaces, `&`/`#` escapes and class generics preserved; a failed parse is never overwritten with empty.
- **UX**: type-aware toolbar, 11-shape switcher with tooltips, editable sequence notes, type-aware empty-canvas onboarding hint.

### Notes
- The packaged extension always rebuilds the bundled `react-super-mermaid` engine first, so a build can never ship stale editor code.
