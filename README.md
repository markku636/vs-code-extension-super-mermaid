# Super Mermaid

> A Mermaid preview extension for VS Code. Diagrams get colored automatically — zero setup, ready to paste into slides. Live updates as you type, and PNG export up to 4x resolution.

![Preview panel](docs/images/preview-panel.png)

## Features

- **Auto coloring**: Colorful is the default theme — flowcharts, sequence diagrams, ER diagrams, Gantt charts, pie charts, mindmaps, and timelines all get a modern palette with rounded corners and soft shadows, without changing a single line of mermaid code. Not your style? The toolbar can switch back to Sketch / Auto / Light / Dark / Neutral / Forest
- **Sketch style**: a hand-drawn whiteboard look (mermaid's built-in `handDrawn` renderer) — one pick in the theme dropdown, applies to exports too
- **Live preview**: updates about 0.3s after you type; mouse-wheel zoom, drag to pan, a Fit button on the toolbar and a floating `−` / `%` / `+` zoom pill in the corner
- **Click a node to jump to its code**: clicking a node, subgraph, or actor in the preview moves the editor cursor to the line that defines it
- **Find in diagram**: press `/` (or `Ctrl+F`) and type — everything else dims, matches stay lit, `Enter` cycles through them and the view centers on each
- **Presentation mode**: press `p` for a full-screen slideshow of every diagram in the document — arrow keys to switch, `Esc` to leave; great for walking through architecture in a meeting
- **Export**: PNG / JPG / WebP / SVG at 1x / 2x / 4x resolution (pick 4x for slides — stays sharp when projected), transparent background supported, and Export All saves every diagram in the document at once
- **Copy as image**: press `c` to put the current diagram on the clipboard as a PNG — paste straight into Slack, Teams, or PowerPoint
- **Share to mermaid.live**: one click builds a link that opens the current diagram in the mermaid.live editor — the code lives only in the URL fragment, nothing is uploaded until someone opens the link
- **Both sources work**: ```` ```mermaid ```` blocks inside Markdown, or standalone `.mmd` / `.mermaid` files
- **Works in the built-in Markdown preview too**: the standard preview (`Ctrl+Shift+V`) renders mermaid blocks as diagrams with the same auto coloring
- **Editor language features**: mermaid syntax highlighting, `%%` comment toggle with Ctrl+/, keyword completion, and syntax errors get red squiggles while the preview is open
- **Template library**: the `Super Mermaid: Insert Diagram Template` command offers 21 diagram templates, plus `mmd-*` snippets
- **Gallery view**: see every diagram in the document on one page, click a thumbnail to open it
- **All mermaid diagram types supported**: flowchart, sequenceDiagram, erDiagram, classDiagram, gantt, pie, mindmap, timeline, journey, C4, architecture…
- **Fully offline**: the mermaid engine is bundled inside the extension — no network connection needed, and your code never leaves your machine

Same mermaid source, zero configuration — this is the difference:

| mermaid default theme | Super Mermaid Colorful (default) | Sketch (hand-drawn) |
| --- | --- | --- |
| ![Default theme](docs/images/theme-default-flowchart.png) | ![Colorful theme](docs/images/demo-flowchart.png) | ![Sketch theme](docs/images/theme-sketch-flowchart.png) |

See [docs/DEMO.md](docs/DEMO.md) for what the other diagram types look like.

## How to use

### Open the preview

1. Open any `.md` file with a ```` ```mermaid ```` block, or a `.mmd` / `.mermaid` file
2. Any of these works:
   - Click the preview icon at the top right of the editor
   - Right-click in the editor → **Super Mermaid: Open Preview to the Side**
   - Right-click a `.md` / `.mmd` file in the Explorer → same command
   - Command Palette (`Ctrl+Shift+P`) → **Super Mermaid: Open Preview to the Side**
3. Then just edit and watch — it refreshes about every 0.3s. On a syntax error a red message pops up and the diagram stays at the last successful render instead of going blank

### Toolbar (left to right)

| Control | What it does |
| --- | --- |
| Diagram dropdown | Switch between diagrams when one markdown file has several (also follows your cursor in the editor) |
| ▶ | Presentation mode: full-screen slideshow — click / arrow keys to switch, `Esc` or the ✕ button to leave |
| ◎ | Fit: fit the whole diagram into the window (double-clicking the canvas does the same) |
| ▦ | Gallery: thumbnail overview of all diagrams, click a card to open it |
| 🔍 | Find in diagram: type to dim everything except matches, `Enter` cycles through them |
| ⧉ | Open the preview in a new window |
| ⤢ | Maximize the preview panel (`f`) |
| Theme dropdown | Colorful (default) / Sketch / Auto / Light / Dark / Neutral / Forest — remembers your choice |
| 🔗 | Share to mermaid.live: opens or copies a link with the diagram encoded in the URL |
| ⬇ Export menu | Copy as image, Export SVG / PNG / JPG / WebP, Export all (whole document at once), resolution 1x/2x/4x, transparent background |
| ⋯ More | Lock to current file, Re-render, Fit Width |

Zoom sits in a floating `−` / `%` / `+` pill in the bottom-right corner of the canvas — click the `%` to jump back to 100%. When the panel is maximized or popped out to its own window, a ✕ in the top-right corner (or `Esc`) restores the layout and hands focus back to the editor.

### Keyboard shortcuts (when the preview panel has focus)

| Key | Action |
| --- | --- |
| Wheel / drag | Zoom / pan |
| `+` / `=` | Zoom in |
| `-` | Zoom out |
| `0` or double-click | Fit (whole diagram into the window) |
| `1` | Actual size (100%) |
| `w` | Fit Width |
| `g` | Gallery (press again to go back to single view) |
| `f` | Maximize / restore the panel |
| `c` | Copy the current diagram to the clipboard as a PNG |
| `/` or `Ctrl+F` | Find in diagram (`Enter` next, `Shift+Enter` previous, `Esc` close) |
| `p` | Presentation mode (`←` `→` / `Space` / `PgUp` `PgDn` to switch, `Esc` to leave) |
| Click a node | Jump the editor to the line that defines it |

### Export tips

- Export and copy resolution is controlled by the 1x / 2x / 4x setting in the Export menu; the default is 2x — use 4x for slides
- The background color follows the current theme; diagrams containing HTML tags (like journey) can't be rasterized, so they're automatically saved as SVG instead

---

Source code, issue tracker, and development docs: [GitHub Repository](https://github.com/markku636/vs-code-extension-super-mermaid)

Author's blog: [Mark Ku's Blog](https://blog.markkulab.net/)
