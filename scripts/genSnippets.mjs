// Generates snippets/mermaid.json and snippets/markdown.json from
// src/templates.ts (single source of truth). Runs as part of `npm run build`.
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outFile = path.join(root, 'dist', 'templates.cjs');

esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'templates.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: outFile,
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const { TEMPLATES } = require(outFile);

const mermaidSnippets = {};
const markdownSnippets = {};
for (const t of TEMPLATES) {
  const lines = t.body.split('\n');
  mermaidSnippets[`Mermaid ${t.label}`] = {
    prefix: t.prefix,
    description: t.description,
    body: lines,
  };
  markdownSnippets[`Mermaid ${t.label}`] = {
    prefix: t.prefix,
    description: t.description,
    body: ['```mermaid', ...lines, '```'],
  };
}

const snippetsDir = path.join(root, 'snippets');
fs.mkdirSync(snippetsDir, { recursive: true });
fs.writeFileSync(path.join(snippetsDir, 'mermaid.json'), JSON.stringify(mermaidSnippets, null, 2) + '\n');
fs.writeFileSync(path.join(snippetsDir, 'markdown.json'), JSON.stringify(markdownSnippets, null, 2) + '\n');
fs.rmSync(outFile, { force: true });
console.log(`[genSnippets] wrote ${Object.keys(mermaidSnippets).length} snippets x2`);
