// Lists every translatable source string in src/ so each l10n/bundle.l10n.*.json
// can be checked for gaps. Every host bundle is checked, not just one — a second
// language is only useful if it is as complete as the first.
//
// The webview dictionaries in webview/i18n.ts are checked too, but differently:
// they live in TypeScript, not JSON, so the first dictionary in the file is the
// reference and every other one must carry exactly its keys.
//
// Two shapes are picked up:
//   vscode.l10n.t('…')                     — the extension host
//   t('…')                                 — editorPanelHtml's injected translator
//   vscode.l10n.t({ message: '…', comment: […] })  — keyed as "message/comment"
//
// Dynamic calls (a variable instead of a literal) cannot be seen here; those
// keys are listed in DYNAMIC below so the report stays honest.
//
// Usage:
//   node scripts/extractL10n.mjs            # report missing / unused keys
//   node scripts/extractL10n.mjs --list     # print every source string

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, 'src');
const L10N = path.join(ROOT, 'l10n');
const I18N = path.join(ROOT, 'webview', 'i18n.ts');

/** Strings reached through a variable, so no regex can find them. */
const DYNAMIC = [
  // previewPanel: the webview's `what` field for the copy-to-clipboard toast
  'SVG markup',
];

const STRING = String.raw`'((?:[^'\\]|\\.)*)'`;
const PATTERNS = [
  new RegExp(String.raw`vscode\.l10n\.t\(\s*${STRING}`, 'g'),
  new RegExp(String.raw`(?<![.\w])t\(\s*${STRING}`, 'g'),
];
const KEYED = new RegExp(
  String.raw`message:\s*${STRING}\s*,\s*comment:\s*\[\s*${STRING}`,
  'g',
);

function unescape(s) {
  return s.replace(/\\(['"\\nt`$])/g, (_, c) =>
    c === 'n' ? '\n' : c === 't' ? '\t' : c,
  );
}

const found = new Set(DYNAMIC);
for (const name of fs.readdirSync(SRC)) {
  if (!name.endsWith('.ts')) continue;
  const text = fs.readFileSync(path.join(SRC, name), 'utf8');
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) found.add(unescape(m[1]));
  }
  for (const m of text.matchAll(KEYED)) {
    found.add(`${unescape(m[1])}/${unescape(m[2])}`);
  }
}

// Template labels / descriptions are translated through a variable too.
const templates = fs.readFileSync(path.join(SRC, 'templates.ts'), 'utf8');
for (const m of templates.matchAll(/^\s{4}(?:label|description): '((?:[^'\\]|\\.)*)',$/gm)) {
  found.add(unescape(m[1]));
}

const sources = [...found].sort((a, b) => a.localeCompare(b));

if (process.argv.includes('--list')) {
  for (const s of sources) console.log(s);
  process.exit(0);
}

let failures = 0;

// ── host bundles: every l10n/bundle.l10n.<lang>.json against the source strings.
const bundles = fs
  .readdirSync(L10N)
  .filter((n) => /^bundle\.l10n\..+\.json$/.test(n))
  .sort();
if (bundles.length === 0) {
  console.log('[extractL10n] no l10n/bundle.l10n.*.json found');
  failures++;
}
for (const name of bundles) {
  const bundle = JSON.parse(fs.readFileSync(path.join(L10N, name), 'utf8'));
  const translated = new Set(Object.keys(bundle));
  const missing = sources.filter((s) => !translated.has(s));
  const unused = [...translated].filter((k) => !found.has(k));
  console.log(
    `[extractL10n] ${name}: ${sources.length} source strings, ${translated.size} translated`,
  );
  for (const s of missing) console.log(`  MISSING  ${JSON.stringify(s)}`);
  for (const s of unused) console.log(`  UNUSED   ${JSON.stringify(s)}`);
  failures += missing.length + unused.length;
}

// ── webview dictionaries: same keys in every language, first one is the reference.
/** Entries of an object literal body — 'quoted' or bare keys, one pair per line. */
function dictEntries(body) {
  const entries = [];
  // Bare keys can be CJK (LIB_ZH_EN's keys are the library's own zh-TW strings).
  const KEY = String.raw`(?:'((?:[^'\\]|\\.)*)'|([A-Za-z_ -￿][\w -￿]*))`;
  const VALUE = String.raw`\s*(?:\n\s*)?'((?:[^'\\]|\\.)*)'`;
  for (const m of body.matchAll(new RegExp(String.raw`^\s{2}${KEY}:${VALUE}`, 'gm'))) {
    entries.push([unescape(m[1] ?? m[2]), unescape(m[3])]);
  }
  return entries;
}

const i18n = fs.readFileSync(I18N, 'utf8');
const dicts = [...i18n.matchAll(/^const (\w+): Dict = \{$([\s\S]*?)^\};$/gm)].map((m) => ({
  name: m[1],
  entries: dictEntries(m[2]),
}));
if (dicts.length === 0) {
  console.log(`[extractL10n] no Dict literals found in ${path.basename(I18N)}`);
  failures++;
}
// LIB_ZH_EN maps the library's zh-TW back to English, and the zh-TW dictionary
// is built by reading it backwards — so its English *values* count as coverage.
const lib = dicts.find((d) => d.name === 'LIB_ZH_EN');
const libCovers = new Set((lib?.entries ?? []).map(([, en]) => en));
const [reference, ...others] = dicts.filter((d) => d !== lib);
if (reference) {
  const refKeys = reference.entries.map(([k]) => k);
  console.log(
    `[extractL10n] webview/i18n.ts: ${refKeys.length} keys in ${reference.name}` +
      (others.length ? `, compared against ${others.map((d) => d.name).join(', ')}` : '') +
      (lib ? ` (+${libCovers.size} via ${lib.name})` : ''),
  );
  for (const dict of others) {
    const have = new Set([...dict.entries.map(([k]) => k), ...libCovers]);
    const missing = refKeys.filter((k) => !have.has(k));
    const extra = dict.entries.map(([k]) => k).filter((k) => !refKeys.includes(k));
    for (const k of missing) console.log(`  MISSING  ${dict.name} ${JSON.stringify(k)}`);
    for (const k of extra) console.log(`  UNUSED   ${dict.name} ${JSON.stringify(k)}`);
    failures += missing.length + extra.length;
  }
}

process.exit(failures ? 1 : 0);
