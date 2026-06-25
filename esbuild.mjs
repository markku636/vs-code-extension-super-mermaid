import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const extensionCtx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: watch,
  minify: !watch,
});

const webviewCtx = await esbuild.context({
  entryPoints: ['webview/main.ts'],
  outfile: 'dist/webview.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  sourcemap: watch,
  minify: !watch,
});

const markdownPreviewCtx = await esbuild.context({
  entryPoints: ['webview/markdownPreview.ts'],
  outfile: 'dist/markdownPreview.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  sourcemap: watch,
  minify: !watch,
});

// 繪製編輯器 webview:import react-super-mermaid/editor(框架無關,零 React)+ mermaid,全部 inline。
const diagramEditorCtx = await esbuild.context({
  entryPoints: ['webview/diagramEditor.ts'],
  outfile: 'dist/diagramEditor.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  sourcemap: watch,
  minify: !watch,
});

// 整份 Markdown 文件預覽 webview:host 用 markdown-it 渲染 HTML 後送進來,
// 本檔負責把 ```mermaid 區塊渲染成自動上色的 SVG(共用 colorize)。
const markdownDocumentCtx = await esbuild.context({
  entryPoints: ['webview/markdownDocument.ts'],
  outfile: 'dist/markdownDocument.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  sourcemap: watch,
  minify: !watch,
});

const contexts = [
  extensionCtx,
  webviewCtx,
  markdownPreviewCtx,
  diagramEditorCtx,
  markdownDocumentCtx,
];

if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('[esbuild] watching for changes...');
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
  console.log('[esbuild] build complete');
}
