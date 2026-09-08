// Generates snippets/mermaid.json and snippets/markdown.json from
// src/templates.ts (single source of truth). Runs as part of `npm run build`.
//
// Language: VS Code has no way to pick a snippet file by display language —
// `contributes.snippets` takes one fixed path — so the shipped snippets are
// generated in ONE language. This build targets Russian users, so labels and
// descriptions come from l10n/bundle.l10n.ru.json and bodies from
// src/templatesRu.ts, falling back to the English source wherever a template
// has no Russian variant. Set SNIPPET_LOCALE=en to generate the English set.
//
// The QuickPick ("Insert Diagram Template") is not affected by this: it goes
// through vscode.l10n and follows the editor's display language at runtime.
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outFile = path.join(root, 'dist', 'templates.cjs');
const locale = process.env.SNIPPET_LOCALE ?? 'ru';

esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'templates.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: outFile,
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const { TEMPLATES, localizedBody } = require(outFile);

const bundlePath = path.join(root, 'l10n', `bundle.l10n.${locale}.json`);
const bundle = fs.existsSync(bundlePath)
  ? JSON.parse(fs.readFileSync(bundlePath, 'utf8'))
  : {};
const t = (s) => bundle[s] ?? s;

const mermaidSnippets = {};
const markdownSnippets = {};
for (const template of TEMPLATES) {
  const lines = localizedBody(template, locale).split('\n');
  const entry = { prefix: template.prefix, description: t(template.description) };
  const name = `Mermaid ${t(template.label)}`;
  mermaidSnippets[name] = { ...entry, body: lines };
  markdownSnippets[name] = { ...entry, body: ['```mermaid', ...lines, '```'] };
}

const snippetsDir = path.join(root, 'snippets');
fs.mkdirSync(snippetsDir, { recursive: true });
fs.writeFileSync(path.join(snippetsDir, 'mermaid.json'), JSON.stringify(mermaidSnippets, null, 2) + '\n');
fs.writeFileSync(path.join(snippetsDir, 'markdown.json'), JSON.stringify(markdownSnippets, null, 2) + '\n');
fs.rmSync(outFile, { force: true });
console.log(`[genSnippets] wrote ${Object.keys(mermaidSnippets).length} snippets x2 (${locale})`);
