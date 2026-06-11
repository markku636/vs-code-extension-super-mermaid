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

const contexts = [extensionCtx, webviewCtx, markdownPreviewCtx];

if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('[esbuild] watching for changes...');
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
  console.log('[esbuild] build complete');
}
