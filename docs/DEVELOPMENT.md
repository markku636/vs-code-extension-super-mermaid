# 開發文件

從原始碼打包、專案結構與開發流程說明。一般使用者請看 [README](../README.md)。

## 從原始碼打包

前置:Node.js 18+、`code` 指令可用。在專案根目錄執行:

```powershell
.\pack.ps1              # 一鍵搞定:build + 打包 VSIX + 安裝到 VS Code
```

其他用法:

```powershell
.\pack.ps1 -Bump          # patch 版號自動 +1,再 build + 打包 + 安裝(改完程式碼後用這個)
.\pack.ps1 -PackageOnly   # 只產出 .vsix 不安裝(要把檔案拿給別人裝時用)
```

腳本第一次執行會自動 `npm install`。完成後 **Reload Window** 讓新版生效。

不想用腳本的話,手動等效指令:

```powershell
npm install                # 第一次需要
npm run package            # 自動先 build,再產出 super-mermaid-<version>.vsix
code --install-extension .\super-mermaid-<version>.vsix
```

> 更新版本注意:**只跑 `npm run build` 不會更新已安裝的副本**,要重新打包 + 安裝才會生效;建議直接用 `.\pack.ps1 -Bump` 一次完成加版號、打包、安裝。

### npm scripts

| 指令 | 用途 |
| --- | --- |
| `npm run build` | 型別檢查 + esbuild 打包到 `dist/` |
| `npm run watch` | esbuild watch 模式(開發用) |
| `npm run type:check` | 只跑 TypeScript 型別檢查 |
| `npm run package` | 打包 VSIX |
| `npm run gen:demo-images` | 重新產生 README / docs 的示範圖(需先 build,用本機 Chrome) |

## 開發流程

```powershell
npm install
npm run watch        # 或 npm run build
```

在 VS Code 開啟本資料夾按 **F5** 啟動 Extension Development Host(父層 workspace 也有「Run Super Mermaid Extension」launch 設定可直接用)。

改了 `webview/main.ts` 或 `media/webview.css` 後,可用 `test/harness.html` 在一般瀏覽器快速驗證(需先 build,再用任一靜態伺服器開啟,因為瀏覽器擋 file:// 模組載入)。

## 資料夾結構

```
super-mermaid/
├── package.json          # extension 定義:commands / menus / language 註冊、build 與 package scripts
├── tsconfig.json         # TypeScript 設定(src 與 webview 共用,只做型別檢查不輸出)
├── esbuild.mjs           # 打包腳本:兩個 entry,輸出到 dist/
├── LICENSE               # MIT(vsce 打包需要)
├── .vscodeignore         # 打包 VSIX 時排除的檔案(原始碼、node_modules、test 等)
├── .vscode/
│   ├── launch.json       # F5 啟動 Extension Development Host
│   └── tasks.json        # F5 前自動 build 的 task
├── language-configuration.json  # %% 註解 / 括號配對(vendored, MIT)
├── THIRD-PARTY-NOTICES.md       # 語法上色 grammar 的 MIT 出處
├── syntaxes/             # TextMate grammars(vendored 自 bpruitt-goddard, MIT)
├── snippets/             # mmd-* snippets(由 scripts/genSnippets.mjs 從 templates.ts 生成)
├── scripts/
│   ├── genSnippets.mjs   # build 時生成 snippets
│   └── genDemoImages.mjs # 用 headless Chrome 驅動匯出管線,產生 docs/images 示範圖
├── src/                  # 【Extension Host 端,跑在 Node】
│   ├── extension.ts      # 進入點:註冊指令與事件監聽(文件變更、游標移動、切換編輯器)
│   ├── previewPanel.ts   # WebviewPanel 管理:HTML/CSP、postMessage 協定、匯出存檔、Export All、診斷轉發
│   ├── mermaidExtract.ts # 抽 ```mermaid fenced block(行號/frontmatter title/blockAtPosition)
│   ├── codeLensProvider.ts      # 區塊上方「Edit Diagram」CodeLens
│   ├── completionProvider.ts    # 依圖型分派的關鍵字/箭頭/snippet 補全
│   ├── diagnostics.ts    # 語法錯誤 → 編輯器紅線(行號對映與 clamp)
│   ├── statusBar.ts      # 狀態列「N diagrams」
│   ├── templates.ts      # 21 個圖表範本(單一資料來源)
│   └── insertTemplate.ts # Insert Diagram Template 指令
├── webview/              # 【Webview 端,跑在瀏覽器環境】
│   ├── main.ts           # mermaid 渲染、svg-pan-zoom 縮放拖曳、快捷鍵、匯出/複製產圖、主題切換
│   ├── colorize.ts       # Colorful 風格:調色盤循環上色(flowchart 節點/子圖/sequence 角色/ER 表格)
│   └── markdownPreview.ts # 注入「內建 Markdown 預覽」的渲染腳本(markdown.previewScripts)
├── media/
│   ├── webview.css       # preview 面板樣式(用 --vscode-* CSS 變數跟隨主題)
│   └── icon.svg          # 面板分頁圖示
├── docs/
│   ├── DEMO.md           # 圖表效果展示(各圖型成品圖 + 原始碼)
│   └── images/           # README / DEMO 引用的示範圖(gen:demo-images 產生)
├── examples/
│   ├── demo.md           # 九種圖表類型展示文件(DEMO.md 圖片的原始碼)
│   ├── architecture.mmd  # 獨立 .mmd 範例:部署架構圖
│   └── sample.mmd        # 測試用範例
├── test/
│   ├── harness.html          # 瀏覽器煙霧測試:模擬 VS Code webview 環境載入 dist/webview.js
│   └── markdown-harness.html # 模擬內建 Markdown 預覽 DOM,測 dist/markdownPreview.js
└── dist/                 # build 輸出(不進版控)
    ├── extension.js      # src/ 打包結果
    ├── webview.js        # 面板 webview 打包結果(含 mermaid + svg-pan-zoom,約 3MB,離線可用)
    └── markdownPreview.js # 內建 Markdown 預覽注入腳本(含 mermaid,約 3MB)
```

兩端透過 `postMessage` 溝通:extension 端送 `update`(圖表內容)/ `setActive`(切換圖表);webview 端送 `export`(存檔)/ `copyText`(複製)/ `revealBlock`(捲動編輯器)/ `setLocked`(鎖定)。
