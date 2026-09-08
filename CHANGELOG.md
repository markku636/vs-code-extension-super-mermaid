# Changelog

## Unreleased — the drawing editor's right-click menu and shortcuts work again

Two dead inputs in the drawing editor, both from `react-super-mermaid` and both invisible to any
test that drives the editor through its API rather than through a real mouse and keyboard.

- **Fix**: picking anything from a right-click menu did nothing. The library closes the menu from a
  `pointerdown` listener on `document`, which runs *before* the item's own `click` — the item is out
  of the DOM by the time the click would be dispatched, so no menu command ever ran. The webview now
  keeps a pointerdown inside the menu from reaching `document`; closing is left to the item handler,
  which calls the library's own close first.
- **Fix**: keyboard shortcuts (Delete, `?`, Ctrl+Z, the arrow nudges, V / N / E) were dead until the
  canvas itself was clicked, and every toolbar click killed them again — the library binds its
  `keydown` to the canvas host and nothing ever focuses it, so on a freshly opened panel the focus is
  still on `<body>` and afterwards it sits on whichever toolbar button was pressed last. The webview
  now replays the event on the canvas host unless the focus is already inside the canvas or in a
  field that must keep its own keys (input / textarea / select / contenteditable, so the source panel
  and the inline label editors are untouched). It listens on `window` in the capture phase and does
  not skip events whose default is already prevented: inside a VS Code webview the page shares the
  keydown with the workbench's own keybinding dispatch, and a shortcut VS Code has claimed must still
  reach the canvas. What no webview code can fix is a keystroke that never arrives — VS Code hands
  keys to whatever *it* considers focused, so the panel still needs one click (or to be the active
  tab) before it hears anything at all.
- **New**: the canvas shortcuts are contributed as real VS Code keybindings too, scoped to the panel
  (`when: activeWebviewPanelId == 'superMermaidEditor' && !inputFocus && !terminalFocus &&
  !listFocus`) and forwarded into the webview by `superMermaid.editorKey`. This is the part a page
  listener cannot cover: a keystroke only reaches a webview while VS Code considers the webview
  focused, so with the panel as the active tab but the focus parked in the workbench, nothing arrived
  at all. Delete / Backspace, `?`, Ctrl+Z / Y / Shift+Z, Ctrl+A / D / G / C / V, the arrow nudges
  (plain and with Shift) and V / N / E now work whenever the panel is the active tab. Tab and Escape
  are deliberately left to VS Code and keep working the moment the canvas has the focus.
- **New**: the webview drops a forwarded stroke it has already seen as a real keystroke within
  400 ms, so the two routes never both fire — no double undo, no node duplicated twice, and nothing
  stolen from a textarea inside the panel.
- **New**: `npm run verify:ui` case *右鍵選單指令 + 工具列焦點快捷鍵*, driven with a real mouse and
  keyboard — right-clicks a node and clicks the menu's last item; selects a node, clicks a toolbar
  button and presses Delete and `?`; posts a stroke the way the host does with no keystroke at all;
  and presses Ctrl+D for real before echoing the same stroke from the host, which must not duplicate
  twice. Every symptom above fails this case without its fix.

## Unreleased — Traditional Chinese is back

This fork's upstream is a zh-TW project, and the Russian localization replaced its Chinese UI
strings with English source strings without putting the Chinese back as a bundle. A zh-TW user of
the upstream extension therefore lost their language. Now it is a full bundle again, and one of the
choices in the toolbar's language picker.

- **New**: `l10n/bundle.l10n.zh-tw.json` (all 268 host strings), `package.nls.zh-tw.json` for the
  manifest, and a zh-TW dictionary in `webview/i18n.ts`. Wherever the pre-i18n code had a Chinese
  string, that exact wording is restored — toolbar tooltips, arrow names, template descriptions, the
  copy-button states.
- **New**: the strings the drawing library renders itself (help overlay, context menu, shape
  captions) are not re-translated. `LIB_ZH_EN` already maps the library's zh-TW to English, so the
  zh-TW dictionary is that table read backwards: `{...libZhTw(), ...ZH_TW_OWN}`. One table, and the
  menu reads exactly as upstream prints it. The toolbar's shape captions were aligned to the same
  words (方框, 圓角, 六角…) so both places name a shape the same way.
- **Change**: `npm run check:l10n` now checks **every** `l10n/bundle.l10n.*.json`, not just the
  Russian one, and checks the webview dictionaries too — each language must carry the same keys as
  the reference dictionary, with `LIB_ZH_EN`'s English values counting as coverage.
- Simplified Chinese is deliberately absent: `zh-cn` falls back to English rather than being shown
  Traditional forms. Template *bodies* stay English for zh-TW — upstream's bodies were English too;
  only Russian has translated bodies (`src/templatesRu.ts`).

## Unreleased — pick the interface language in the toolbar

The extension spoke whatever language VS Code's **Display Language** was set to, and nothing else.
That is the wrong granularity for a diagram tool: people run an English VS Code and still want the
drawing editor in Russian (and the other way round), and switching VS Code's display language means
a restart of the whole editor.

- **New**: a 🌐 dropdown at the right of the drawing editor's toolbar — **Auto / English / Русский /
  繁體中文** — backed by the `superMermaid.language` setting (`auto` = follow VS Code, the default). Changing
  it takes effect at once: the drawing editor, the diagram preview and the Markdown preview rebuild
  their HTML (the toolbar strings are host-generated, so a rebuild is the only way), and the CodeLens
  titles and status bar re-render.
- **New**: `src/uiLocale.ts` — a `t()` that is call-compatible with `vscode.l10n.t` and delegates to
  it verbatim on `auto`. With an override it looks the string up in the same `l10n/bundle.l10n.ru.json`
  (imported, so it ends up inside `dist/extension.js`), including the keyed `message/comment` form
  used for plurals; `en` returns the source string, which is the English original. Every
  `vscode.l10n.t` call in `src/` goes through it now, and `npm run check:l10n` still sees them.
- **Fixed**: the drawing editor's keyboard-help overlay (`?`) and its right-click menus stayed in
  zh-TW whatever the language was. Those strings are hard-coded inside react-super-mermaid with no
  hook to replace them, so the webview now translates their DOM as the library appends it: a zh-TW →
  English map in `webview/i18n.ts` feeds the existing dictionary, which means a locale without a
  translation lands on English instead of Chinese. Covers all 68 strings of the help overlay and of
  every context menu (canvas, node, edge, sequence, gitgraph, kanban / journey, requirement),
  including the shape-strip and colour-swatch tooltips.
- Not covered, by construction: command titles, menu entries and the settings page itself come from
  `package.nls.*.json`, which VS Code resolves from its own display language before the extension
  runs. Both READMEs say so.

## Unreleased — a clean clone builds again

`webview/main.ts` imported `stripHtmlFormattingTags` from `react-super-mermaid/orid`, which only
exists in the library's unpublished 0.28.1 — npm still serves 0.28.0, so `npm install` + `npm run
build` failed on `tsc` for anyone without the library's sources checked out next door.

- **Fix**: the helper now lives in `webview/stripHtmlTags.ts`. Same behaviour (inline formatting
  tags dropped from the export render, `<br>` and label text kept), no dependency on an unpublished
  version — clone, `npm install`, `.\pack.ps1` works unattended. Revert to the library import once
  0.28.1 is on npm.
- **Fix**: `pack.ps1` installs with `code --install-extension --force`; without it the CLI treats an
  unchanged version number as "already installed" and silently skips the reinstall.

## Unreleased — Russian localization

The UI was a mix of English and Traditional Chinese, and neither followed the editor's display
language. Everything user-facing now goes through a translation layer with English as the source
language and a Russian bundle alongside it, so the extension speaks Russian in a Russian VS Code and
English everywhere else.

- **New**: `package.nls.json` / `package.nls.ru.json` for the manifest (command titles, settings
  descriptions), `l10n/bundle.l10n.ru.json` + `vscode.l10n.t()` for the extension host, and
  `webview/i18n.ts` for strings that live inside a webview (the host stamps the display language on
  `<body data-locale>`). `npm run check:l10n` reports missing and unused keys.
- **New**: Russian variants of all 23 diagram templates (`src/templatesRu.ts`). Mermaid's grammar
  rejects non-ASCII in a few positions, so `requirement` names, `sankey` nodes and git branch names
  stay Latin, and `xychart` axis labels / `architecture` `[labels]` are quoted. Every Russian body is
  covered by `npm run verify:roundtrip` alongside the English one.
- **Change**: the drawing editor's toolbar, arrow names and shape captions are no longer
  Traditional Chinese only. The captions are the extension's own table now — the library's
  `shapeMeta().label` is zh-TW with no translation hook.
- **Change**: `snippets/*.json` is generated in Russian. `contributes.snippets` takes one fixed path
  with no locale switch, so the shipped snippets can only be one language; `SNIPPET_LOCALE=en npm run
  gen:snippets` regenerates the English set. The **Insert Diagram Template** command is unaffected —
  it follows the editor's language at runtime.
- **Fix**: outline anchors in the full-document Markdown preview dropped every Cyrillic character
  (the slug filter was `\w` plus a CJK range, and `\w` is ASCII-only), so Russian headings all
  collapsed to the same `section` id. It now keeps any Unicode letter or digit.
- Cyrillic in the hand-drawn **Sketch** look was checked, not assumed: the bundled Excalifont's cmap
  covers the full Russian alphabet, so no font fallback is needed.
- **Docs**: `README.ru.md`, linked from the English README.

## 0.20.1 — `<b>` was showing up in exported PNGs

The live preview renders labels with `htmlLabels` on, so inline HTML like `<b>` and `<i>` becomes
real bold and italics. Exports re-render with `htmlLabels` off to keep the SVG canvas-safe — and in
that mode Mermaid only understands `<br>`; every other inline tag was drawn into the exported image
as literal text, tags and all.

- **Fix**: the export path (PNG and SVG alike) now strips inline HTML tags (`<b>`, `<i>`,
  `<span style=…>`, …) from the source before rendering. Label text and `<br>` line breaks survive;
  the preview keeps its real bold. (lib 0.28.1)

## 0.20.0 — ORID, a diagram type Mermaid doesn't have

Every retrospective and incident review has the same shape, and Mermaid has no diagram for it — so
you rebuild it by hand as four subgraphs with four colour rules, every single time. ORID (the ICA
*focused conversation* method) is now a diagram type here, not a snippet.

- **New**: `orid` blocks — `title`, then `objective` / `reflective` / `interpretive` / `decisional`
  stage lines, then one indented line per item. They render as a vertical funnel: one colour-coded
  band per stage (blue facts → orange feelings → purple meaning → green action), items laid out in
  rows inside it, always in canonical O→R→I→D order however you wrote them. A stage you declared but
  left empty shows a dashed placeholder rather than collapsing to a sliver.
- **New**: the **✏ Edit** CodeLens on an `orid` block opens a structured four-stage form (add /
  remove / reorder items, per-stage prompts, live preview) that writes clean ORID back to the file.
- Because ORID is transpiled to a flowchart just before rendering, **everything else already works on
  it**: both themes, dark mode, live preview, find-in-diagram, gallery, presentation mode, PNG/SVG
  export, the built-in Markdown preview, the full-document preview and its PNG/PDF export, plus
  `%% @tip` and `%% @check` (item ids are `O1`, `R2`, `I1`, `D3`…).
- Editor smarts: `orid` in the diagram-type completion list, stage-keyword completions with prompts,
  syntax highlighting, error squiggles, and hovering a stage keyword explains what belongs in it.
- **New templates**: *ORID - Focused Conversation* and *ORID - Blank Four Stages* in
  `Super Mermaid: Insert Diagram Template`, plus `mmd-orid` / `mmd-orid-blank` snippets (23 total).
- Write an item that itself begins with a stage keyword as `- objective is a vague word`; the `-`
  keeps it an item. Single-letter abbreviations are deliberately not accepted — an item starting
  `I feel…` would otherwise open an Interpretive stage and swallow the rest of the block.
- **Fix (all diagram types)**: `~~~` invisible links were repainted as visible slate lines by the
  Colorful post-process. They now stay invisible.

## 0.19.0 — drag a message across lifelines

Dragging a message could change *when* it happens but never *who it is between* — on the one diagram
type whose whole point is who talks to whom. Changing that meant editing the source by hand.

- **New**: drag a message sideways to move it across lifelines. Where you grab it decides what moves:
  the tail re-points the sender, the arrow head re-points the recipient, and the middle carries the
  whole message to another pair of lanes with its span intact. A rubber band and an outline on the
  target participant show the result before you let go.
- A drop that would leave a message talking to itself, or push either end past the edge of the
  diagram, keeps the last valid pair. Reordering and re-targeting in one drag are one undo.
- `verify:ui` gained a cross-lane case that asserts the recipient specifically changed, not merely
  that the source text differs — an implementation that only moved messages up and down would pass
  the weaker check. Confirmed to fail on the previous engine.

## 0.18.0 — sequence messages can be selected, deleted, and found

Clicking a message on a sequence diagram did nothing visible, and Delete had nothing to act on:
messages and notes are not nodes, so they never entered the selection at all. Meanwhile every action
for building a sequence diagram lived in the context menu, which made this the emptiest toolbar of
any diagram type — you had to know to right-click.

- **New**: click a message or a note to select it — you get a selection box — and press Delete to
  remove it.
- **New**: the toolbar has **＋參與者 / ＋訊息 / ＋筆記**, and, when a message is selected,
  **✎ 文字** and **⇢ 實／虛**. All of them already existed behind the right-click menu.
- **New**: hovering a message outlines it, and the cursor is `ns-resize` instead of a text caret, so
  it looks like something you can pick up. The line that shows where a dragged message will land is
  now solid with end caps rather than a faint dashed guide.
- `verify:ui` gained a click-then-Delete case alongside the drag cases. Confirmed to fail on the old
  engine: no selection box, and the message count unchanged after Delete.

## 0.17.0 — the canvas answers you again while you drag

Rendering a sequence diagram cleared the overlay layer, and that layer belongs to the drawing
engine's `Overlay` — its groups are built once and held by reference, so clearing them took them out
of the document permanently. Every selection box, insertion line, snap guide, resize handle and
rubber band after that was drawn where nobody could see it. The drags themselves still applied, so
the source changed while the canvas sat there looking frozen. It was not confined to the diagram
that caused it: once a sequence had rendered, switching to a flowchart cleared the layer a second
time and the feedback stayed invisible for the rest of the session.

- **New**: in a sequence diagram, drag a message or a note up and down to change where it sits in
  time. Pressing one used to do nothing at all — not even pan the canvas — because the press was
  consumed by the double-click-to-edit path. An insertion line now spans the lifelines at the landing
  position while you drag. Dragging a `loop` / `alt` / `opt` header carries the whole block with it.
- **New**: dragging a *lifeline* reorders its participant. Participants were matched by hit-testing
  the DOM, and a lifeline does not take pointer events, so dragging one panned the canvas instead.
  The space between lifelines still pans.
- `verify:ui` now drives real mouse drags and asserts two separate things per gesture: that the state
  actually changed, and that the overlay drew something mid-gesture. A test that only checked the
  first would have passed straight through this bug. Confirmed to fail on the three affected cases
  with the old engine, including a flowchart drag performed after a sequence has been opened.

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
