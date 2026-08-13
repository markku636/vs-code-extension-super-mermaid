// 把隔壁 react-super-mermaid 的 build 產物同步進本專案的 node_modules。
//
// 本擴充是以「npm 安裝的 react-super-mermaid」在消費繪製引擎,但引擎與擴充是一起開發的:
// 每次改完 lib 都得把新的 dist 放進 node_modules,擴充 build 出來的 webview 才會帶到新行為。
// 這件事以前是手動做的(所以 node_modules 裡的 package.json 版號長期停在舊版,和 dist 對不上)。
//
// 用法:
//   node scripts/syncLib.mjs            # 需 lib 已 build 過
//   node scripts/syncLib.mjs --build    # 先在 lib 跑 npm run build 再同步
//   LIB_DIR=../somewhere node scripts/syncLib.mjs

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = resolve(ROOT, process.env.LIB_DIR ?? '../react-super-mermaid');
const DEST = join(ROOT, 'node_modules', 'react-super-mermaid');

if (!existsSync(join(LIB, 'package.json'))) {
  throw new Error(`找不到 react-super-mermaid 原始碼:${LIB}(可用 LIB_DIR 指定)`);
}
if (!existsSync(DEST)) {
  throw new Error(`node_modules/react-super-mermaid 不存在 —— 先跑 npm install`);
}

if (process.argv.includes('--build')) {
  console.log(`[sync-lib] 在 ${LIB} 執行 npm run build …`);
  execFileSync('npm', ['run', 'build'], { cwd: LIB, stdio: 'inherit', shell: true });
}

const distSrc = join(LIB, 'dist');
if (!existsSync(distSrc)) throw new Error(`lib 尚未 build:${distSrc} 不存在`);

// dist 整包換掉(避免上一版殘留的 chunk 檔留在原地被舊 import 撈到)。
rmSync(join(DEST, 'dist'), { recursive: true, force: true });
cpSync(distSrc, join(DEST, 'dist'), { recursive: true });
// package.json 一起帶,node_modules 的版號才會反映實際同步進來的內容。
cpSync(join(LIB, 'package.json'), join(DEST, 'package.json'));

const version = JSON.parse(readFileSync(join(DEST, 'package.json'), 'utf8')).version;
console.log(`[sync-lib] react-super-mermaid ${version} 已同步到 node_modules`);
