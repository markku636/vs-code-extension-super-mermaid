// Injected into VS Code's BUILT-IN markdown preview via the
// "markdown.previewScripts" contribution point. Finds ```mermaid code blocks
// (rendered by markdown-it as <pre><code class="language-mermaid">) and
// replaces them with rendered SVG.
import mermaid from 'mermaid';
import { boostLegibility, colorizeDiagram, ensureLegibilityStyles } from './colorize';

let seq = 0;
let rendering = false;
let pending = false;

function isDarkTheme(): boolean {
  const cls = document.body.className;
  if (cls.includes('vscode-high-contrast-light')) {
    return false;
  }
  return cls.includes('vscode-dark') || cls.includes('vscode-high-contrast');
}

function initMermaid(): void {
  // Inject label-weight CSS before the first render so mermaid measures the
  // boosted metrics and node boxes fit the bold text (no clipped glyphs).
  ensureLegibilityStyles();
  mermaid.initialize({
    startOnLoad: false,
    theme: isDarkTheme() ? 'dark' : 'default',
    fontFamily:
      getComputedStyle(document.body).getPropertyValue('--vscode-font-family').trim() || 'sans-serif',
    flowchart: { nodeSpacing: 60, rankSpacing: 65, padding: 12 },
    sequence: { actorMargin: 70, boxMargin: 12 },
  });
}

async function renderAll(): Promise<void> {
  // The update event can fire while a previous pass is still awaiting
  // mermaid.render — coalesce instead of interleaving DOM mutations.
  if (rendering) {
    pending = true;
    return;
  }
  rendering = true;
  try {
    initMermaid();
    const codes = Array.from(
      document.querySelectorAll<HTMLElement>('pre > code.language-mermaid, pre > code.language-mmd'),
    );
    for (const code of codes) {
      const pre = code.parentElement;
      const source = (code.textContent ?? '').trim();
      if (!pre || !source) {
        continue;
      }
      const id = `md-mmd-${++seq}`;
      try {
        const { svg } = await mermaid.render(id, source);
        const container = document.createElement('div');
        container.className = 'mermaid-preview-block';
        container.innerHTML = svg;
        const svgEl = container.querySelector('svg');
        if (svgEl) {
          colorizeDiagram(svgEl, { dark: isDarkTheme() });
          boostLegibility(svgEl);
        }
        pre.replaceWith(container);
      } catch {
        // Invalid/incomplete diagram (e.g. mid-typing): clean up mermaid's
        // temp error node and leave the original code block visible.
        document.getElementById('d' + id)?.remove();
      }
    }
  } finally {
    rendering = false;
    if (pending) {
      pending = false;
      void renderAll();
    }
  }
}

// Re-render when the preview content updates (typing in the editor) and when
// the VS Code theme changes.
window.addEventListener('vscode.markdown.updateContent', () => void renderAll());
new MutationObserver(() => void renderAll()).observe(document.body, {
  attributes: true,
  attributeFilter: ['class'],
});

void renderAll();
