# Changelog

## 0.16.0 — you can see where a drag will land

- **New**: dragging a card, a commit or a block now outlines the column / lane / cell it will drop
  into, and the outline follows the pointer. On these types letting go rewrites the source, so
  previously the only way to find out where it would land was to drop it and look.
- The drag test asserts the outline shows during the gesture and clears after it.

## 0.15.4 — the UI check now measures whether text on a node is readable

Twice now, text drawn on a node has taken the theme's colour and disappeared on a dark canvas
(0.13.0 for C4 / requirement / pie, 0.15.3 for gantt) — node fills come from a fixed light palette
and never follow the theme. Both times it was caught by a human looking at a screenshot.

`verify:ui` now measures it: every text element **drawn inside a node's own fill** is checked for
contrast against that fill, in both themes. Text placed outside the node is exempt, since the canvas
is behind it. Confirmed to fail on the 0.15.3 bug (contrast 1.03) and pass once fixed.

## 0.15.3 — a gantt `done` bar's label was invisible in dark mode

Moving the label inside the bar (0.15.0) also gave it the theme's text colour, and a `done` bar is
filled with a pale colour that never follows the theme — so on a dark canvas the label disappeared.

## 0.15.2 — mindmap branches curve

- Mindmap branches are drawn as smooth curves instead of straight lines, so they read as branches
  growing out of the parent rather than as flowchart arrows.

## 0.15.1 — the grid-shaped types get their grid back

- **block**: the `columns N` grid is drawn as a faint backdrop, so you can see which cell you're
  dragging a block into — previously there were no cell boundaries on the canvas at all.
- **packet**: a 96-bit packet was so long and thin that 「符合畫面」 shrank it to half size. It now fits
  at around 90%, with readable field names.
- **quadrant**: CJK y-axis labels stack upright instead of lying on their side.

## 0.15.0 — architecture diagrams get real icons

- **architecture**: connections stopped a visible distance short of the boxes they pointed at — the
  drawn box was much smaller than the node the line attached to. The box is the node now.
- **architecture**: `cloud` / `database` / `disk` / `server` / `internet` are drawn as real icons
  instead of the first letter of the icon name (which made `database` and `disk` both a large "D").
  Still no icon library in the bundle — the glyphs are hand-drawn paths.
- **Fix**: 「符合畫面」 cropped group and lane names off the top of the canvas, because it measured the
  nodes but not the boxes drawn around them.

## 0.14.2 — cards, bars and people

- Kanban cards, journey cards and gantt bars showed a small torn notch at each corner: a hand-drawn
  rectangle was being painted underneath the card's own box. Gone.
- A gantt task name is written inside its bar when it fits, instead of hanging off the right edge
  into the next bar along.
- A C4 `Person` drew its head in the same colour as the box beneath it, which read as an empty ring.
  It's a filled head and shoulders now.

## 0.14.1 — the chart types read better

- **pie**: the slice percentage was being drawn twice, a few pixels apart, so the name and the
  percentage overlapped. One label per slice now — `name / value · share%` — on a small card that
  hugs its text.
- **sankey**: link width was compressed so hard that a flow of 30 and a flow of 45 looked the same,
  which is the one thing a sankey exists to show. Width is now proportional to the largest flow in
  the chart, and each link takes the colour of the node it flows out of.
- **xychart**: axis titles were parsed and never drawn. Both are drawn now, and a CJK y-axis title
  stacks upright instead of lying on its side.

## 0.14.0 — gitGraph closes the set: every Mermaid diagram type is drawable

- **New — gitGraph**: a commit's parents are never written in the source; they come from the order of
  the commands. So the entire diagram is recoverable from *which lane a commit is on and where it
  sits left-to-right* — drag sideways to reorder history, drag onto another lane to move a commit to
  that branch, and the `branch` / `checkout` / `commit` / `merge` stream is rebuilt from what you see.
  Right-click a commit to rename it, mark it highlight / reverse, or attach a tag; right-click a lane
  to rename, delete or add a branch. `cherry-pick` is still passed through read-only.
- The draw check now asserts that each case was **recognised as the type it claims to be**. A missing
  adapter registration used to fall back to flowchart silently and still pass every parse — this
  found exactly that, on the type being added.

## 0.13.0 — the visual editor covers nineteen diagram types

Everything Mermaid can draw except `gitGraph` now opens in the **✏ Draw** editor, and on the chart
types dragging edits the *data* rather than the layout.

- **New — gantt**: a bar's x is its start date, its width is its duration and its row is its section,
  so drag to reschedule, drag the edge to change duration, drag into another band to change section.
  The canvas draws a real time axis with `done` / `active` / `crit` styling and milestones as
  diamonds. A task written as `after a1` keeps that dependency until you drag it away, and `2w` comes
  back as weeks rather than `14d`.
- **New — pie**: the pie is drawn on the canvas with a percentage per slice; drag a slice handle
  around the circle to reorder, double-click to edit its label and value.
- **New — xychart**: each data point's vertical position is its value — drag it up and the number
  goes up, with bars and lines redrawn as you move.
- **New — architecture**: services, junctions and nested `group`s, with `a:L -- R:b` edges keeping
  the side they attach to.
- **New — block**: blocks flow into the `columns N` grid, so dragging one to another cell reorders
  the source; 「整理」 snaps everything back onto the grid.
- **New — packet**: a field's width is how many bits it takes and its order is its order; the bit
  numbers renumber themselves on save, so they can't drift the way hand-edited ranges do.
- **Fix**: quadrant chart points could not be dragged **at all** — the connect-anchor dots blanket a
  26px node, so every press started an edge instead of a move. Diagram types with no edge syntax now
  skip anchors entirely, and small nodes never surrender their whole hit area to anchors.
- **Fix**: on a dark theme, C4 boxes, requirement boxes and pie slices drew light text on their own
  light fill — effectively invisible — and the quadrant chart's four tints turned into indistinct
  grey-brown. Both are fixed, and the UI test suite now runs the whole matrix in dark mode too.
- Anything the editor doesn't fully understand is passed through **verbatim** and marked read-only
  rather than half-rewritten: an unusual gantt `dateFormat`, a nested `block:… end`, a horizontal
  xychart.

## 0.12.0 — the visual editor covers thirteen diagram types

The **✏ Draw** editor went from six drawable diagram types to thirteen, and dragging now *means*
something on the new ones instead of only tidying the layout.

- **New — requirement diagrams**: drop 需求 / 元素 boxes, drag to relate them, double-click for a
  structured editor (`id:` / `text:` / `risk:` / `verify:`), right-click an arrow to pick among the
  seven trace relations. Note that mermaid only accepts `[A-Za-z0-9_]` in a requirement **name**, so
  a Chinese name is slugged and reported — put the Chinese in `text:`.
- **New — C4 diagrams** (Context / Container / Component / Dynamic / Deployment): people, systems,
  containers, components, databases and queues, with `*_Boundary(…) { }` blocks preserved as nested
  groups and `Rel` / `BiRel` as edges.
- **New — kanban boards**: drag a card into another column to change its status, drag up/down to
  reorder. Right-click empty space to add a column, right-click a column to rename or delete it.
- **New — user journeys**: sections become lanes, tasks become cards showing the mood score and the
  actors — moving a task between stages is a drag.
- **New — quadrant charts**: a point's position *is* its value, so dragging it rewrites
  `[0.30, 0.60]`. The chart frame, both axes and the four quadrant names are drawn on the canvas.
- **New — sankey flows**: each link's width is its value; double-click a link to type a new one.
  (mermaid's sankey parser rejects non-ASCII names — the editor warns rather than mangling them.)
- **Fix**: the shape toolbar was hardcoded to *flowchart* shapes, so a class diagram offered
  「菱形 / 圓柱 / 梯形」 — shapes that type cannot serialize. Every diagram type now offers exactly its
  own shapes, and the buttons draw a real icon instead of a text glyph (`⬭ ⬡ ⛁` have no glyph in most
  system UI fonts, so 「圓角 / 橢圓 / 六角」 all rendered as the same circle).
- **Fix**: class boxes and ER entities were drawn much taller than their contents, leaving a slab of
  blank space under the last row; ER cardinality marks floated away from the entity; state
  start/end/fork markers were coloured from the node palette instead of ink.
- **Fix**: renaming an ER entity was silently discarded, a class with a label but no members lost the
  label, and `fork` / `choice` state nodes created in the editor lost their shape on reload.
- **Fix**: a mindmap node created by dragging became a second root, which mermaid rejects outright;
  dragging a connection on a mindmap now re-parents (mindmap has no edge syntax).
- The blank canvas now offers a starter template for all thirteen drawable types.

## 0.11.0 — share links open in the Super Mermaid live preview

- **Change**: the 🔗 share button now builds a link to the
  [Super Mermaid live preview](https://blog.markkulab.net/tools/mermaid-preview) instead of
  mermaid.live. The recipient lands on a page that renders the diagram with the same engine
  this extension uses — the colorful and sketch themes included — and can edit, re-theme and
  export it from there.
- **Change**: the link now carries the theme you actually had on screen (`rsmTheme`), so
  Colorful / Sketch survive the round trip. Previously they were flattened to mermaid's
  light / dark because that was all mermaid.live could express.
- **Unchanged**: the encoding is still pako-deflated base64url JSON in the URL **fragment** —
  nothing is uploaded, and the payload keeps mermaid.live's field shape, so swapping the
  domain still opens the same diagram there.

## 0.10.0 — hover tooltips in the preview + hover hints in the editor

Hovering now answers "what is this node?" on both sides of the split.

- **Feature**: resting the mouse on a node / subgraph / actor in the **preview** shows a
  theme-aware tooltip: the node's **full label** (long labels get squeezed once a diagram is
  fitted to the panel), plus a muted meta line with the author id, the source line (`L12`),
  and the click-to-open-source hint. It follows the cursor, flips near the panel edges,
  hides while you drag-pan, and never intercepts the pointer.
- **Feature**: author tooltip text **inside the diagram** with `%% @tip` comments —
  `%% @tip NodeId shown on hover`, indented `%%` lines continue the note, and a quoted
  target (`%% @tip "Node label" …`) matches by label instead of id. Same syntax as the
  react-super-mermaid library, so one diagram carries its tips across both. Directives are
  plain mermaid comments — nothing to strip, older versions simply ignore them.
- **Feature**: a real **editor hover provider** — hovering a node id in a ```` ```mermaid ````
  block or a `.mmd` file pops the node's label, shape (rectangle / decision / database /
  participant…), how many statements connect it, and any `%% @tip` / `%% @check` notes for
  that node. The hover only fires on words that demonstrably are nodes (a definition, an
  edge, or an authored note), so prose in Markdown never triggers it.
- **Internal**: the node-id / label extraction used by click-to-source is now shared with the
  hover tooltip (`authorIdFor` / `nodeLabelFor`), so both features resolve nodes identically.

## 0.9.6 — Markdown preview: readable, print-quality PNG / PDF export

Export used to be a screenshot of the preview: whatever dark theme was on screen
became the exported page, rasterized at 1–2x (≈100–200 DPI once scaled onto A4)
and sliced at fixed page heights. The result was muddy colors and soft text. The
exporter now builds its own document instead of photographing the screen.

- **Feature**: exports default to a new **Paper (light)** appearance — white page,
  near-black text, high-contrast syntax colors, solid table / code borders, and
  mermaid diagrams re-rendered in the light palette — regardless of which preview
  theme is on screen. **Export ▾ → Appearance** switches back to **Match preview
  theme** if you want the dark look; the choice is remembered.
- **Fix**: text is no longer blurry. Capture runs at **3x** (≈340 DPI at A4 width
  instead of 99–198 DPI), automatically stepping down only if a document is long
  enough to hit the browser's canvas limits. Fonts and images are awaited before
  capture so nothing is rasterized half-loaded.
- **Fix**: PDF page breaks land on **line and block boundaries** — measured from
  real line boxes, table rows and block starts — instead of slicing at a fixed
  page height, which used to cut lines of text in half.
- **Fix**: PDF pages get **36pt margins**; content no longer runs into the paper
  edge.
- **Fix**: long code lines and wide tables **wrap into the page** instead of being
  clipped at the scroll edge (a scrollbar has no meaning on paper).
- **Fix**: export renders off-screen from the document source, so the preview no
  longer flickers mid-export and search highlights never leak into the output.

## 0.9.5 — Markdown preview: find bar, content width modes, stable export

- **Feature**: **Find in document** (`Ctrl+F`, or the toolbar **Find** button) —
  match count, prev / next (`Enter` / `Shift+Enter`), `Esc` to close. Highlights
  reach the label text inside mermaid diagrams. The native webview find widget is
  disabled so the two no longer fight over `Ctrl+F`.
- **Feature**: the **Wide** toggle becomes a three-way **content width** cycle —
  **Auto** / **Full** / **Reading** (toolbar button, or press `w`). Auto keeps the
  920px reading column on narrow panels and goes full-width at ≥1200px, so wide
  tables stop being cut off without permanently wasting a large screen. An
  existing `wide = true` preference migrates to **Full**.
- **Fix**: PNG / PDF export pins the content to a fixed 820px document width
  during capture, so the exported page no longer changes with the preview panel's
  width.
- **Fix**: PDF export produced a corrupt file — jsPDF's `datauristring` emits
  `data:application/pdf;filename=generated.pdf;base64,…`, and the decoder only
  stripped a bare `;base64,` prefix, leaving the `filename=` segment in the
  payload. It now strips through the first comma (base64 never contains one).
- **Build**: re-declare `react-super-mermaid` as a devDependency, pinned to the
  published npm release instead of the long-gone `file:../react-super-mermaid`
  path. Without it `tsc` could not resolve `react-super-mermaid/editor`, so
  `npm run build` — and therefore `vsce package` — failed on a fresh clone.

## 0.9.4 — Markdown preview: light callouts (no dark blockquote band)

- **Fix**: blockquotes / callouts now render as a **light, subtle box** in the
  Light theme (and a subtle raised box in dark themes) instead of appearing as a
  dark band with faint text. The background is driven by the theme-tuned
  `--md-code-bg` (light under light themes, subtle under dark), the left accent
  border uses the theme accent, and the text is full-contrast `--md-fg`. This
  removes the "black background, unreadable" callouts in the Light theme and in
  exported PDF / PNG.

## 0.9.2 — Markdown preview: readable Light theme (export PDF fix)

- **Fix**: the **Light** preview theme (`daylight`) was tinted **purple** and hard
  to read — blockquote / muted text used `#635D97` and links/accent `#644AC9`.
  Retuned to neutral, high-contrast colors: muted text `#4B5563`, accent/links
  `#0969DA` (GitHub blue), and light-theme code `number` highlight `#0550AE`
  (was purple). Inline `code` stays dark-text-on-light-background. Since PDF /
  PNG export rasterizes the live preview, exporting in the Light theme now
  produces clean, legible output.

## 0.8.97 — Markdown preview: export to PNG / PDF

- **Feature**: the full Markdown document preview now has an **Export** button in
  its toolbar. It rasterizes the rendered document exactly as shown — chosen
  preview theme, tables, highlighted code, and auto-colored Mermaid diagrams —
  and saves it as a **PNG** image or a multi-page **PDF** (`html2canvas` +
  `jsPDF`, bundled into the webview; works fully offline). The save dialog
  defaults to the document's folder, and a notification offers **Open** /
  **Reveal in Explorer** afterwards.

## 0.8.82 — Draw editor: clear previous diagram on switch

- **Fix** (via shared core): in the visual Draw editor, switching from a
  **sequence** diagram to another diagram (e.g. flowchart) left the old diagram
  rendered underneath the new one. The sequence renderer writes straight into
  the SVG layers and bypasses the node cache that the diff renderer relies on to
  remove stale elements; the layers are now hard-cleared when leaving sequence
  mode.

## 0.8.80 — gantt dark-aware (chart dark-mode pass complete)

- **Fix** (via shared core): gantt bars readable in dark mode; all chart types
  now render consistently in light & dark.

## 0.8.79 — timeline + mindmap dark-aware

- **Fix** (via shared core): timeline + mindmap cards/nodes are readable in dark
  mode (were bright light cards with hard-to-read text).

## 0.8.78 — journey chart dark-aware

- **Fix** (via shared core): user-journey task labels are now readable in dark
  mode (were faint light-on-light).

## 0.8.77 — quadrant zones dark-aware

- **Fix** (via shared core): quadrant zone tints are now dark-aware (were light
  rectangles in dark mode).

## 0.8.76 — quadrant chart: distinct zones + visible points

- **Improvement/fix** (via shared core): quadrant charts get 4 distinct soft
  zone tints and visible vibrant data points (were pale/indistinguishable with
  invisible NaN-coloured dots).

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
