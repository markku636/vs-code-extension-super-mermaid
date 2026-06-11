# Super Mermaid

> 在 VS Code 裡把 Mermaid 圖表變成**拿得出手的圖**——自動上色、即時預覽、一鍵匯出高解析 PNG。

支援兩種來源:

- Markdown 檔案內的 ```` ```mermaid ```` code block
- 獨立的 `.mmd` / `.mermaid` 檔案(已註冊 `mermaid` language)

## 為什麼你會想要它

寫 Mermaid 的人,遲早會撞上這兩面牆:

### 😩 痛點一:只是想要一張 PNG,卻要繞一大圈

要把圖貼進簡報、Confluence、聊天群組,流程通常是:開 mermaid.live → 貼程式碼 → 下載或截圖 → 貼上才發現**解析度糊掉、背景色卡在圖上、邊緣鋸齒**,投影到大螢幕直接破功,只好回頭重來一次。圖一多,每張都要這樣折騰。

**✅ Super Mermaid:不離開編輯器,一鍵匯出**

- PNG / JPG / WebP / SVG 任選,解析度 **1x / 2x / 4x**——4x 貼簡報放大投影也銳利
- **透明背景**選項,貼到任何底色的投影片、文件都乾淨服貼
- **Export All**:整份 markdown 十幾張圖?一個動作全部批次匯出,檔名自動編號
- 匯出的 SVG 不含 foreignObject,貼進 Confluence / Inkscape 不會破圖

### 😩 痛點二:預設的 Mermaid 圖,實在拿不出手

mermaid 預設長相:米白方塊、黑線、整張圖一個顏色,放進提案簡報瞬間「工程師感」爆棚。想讓它能看,就得手寫 `classDef`、`style`,一個節點一個節點上色——圖一改結構,顏色又要重調一輪。

**✅ Super Mermaid:Colorful 主題(預設),零設定自動上色**

- 節點 / 子圖 / 序列圖角色 / ER 表格 / 甘特 / 圓餅 / 心智圖 / 時間軸,**自動循環現代色票**(Tailwind 色系)
- 圓角 + 柔和陰影,渲染出來就是商用繪圖工具的質感
- **不用改任何一行 mermaid 程式碼**;匯出的 PNG / SVG 也同樣帶著上色效果,所見即所得
- 不喜歡多彩?工具列一鍵切回 Auto / Light / Dark / Neutral / Forest,選擇會記住

## 安裝

### 你只是拿到一個 .vsix 檔(最常見,不用裝 Node)

```powershell
code --install-extension .\super-mermaid-<version>.vsix   # <version> 換成檔名上的實際版號
```

或在 VS Code 內:Extensions 面板 → 右上角 `...` 選單 → **Install from VSIX...** → 選取 .vsix 檔。

裝完後 **Reload Window**(命令面板 `Ctrl+Shift+P` → `Developer: Reload Window`)即生效。

> ⚠️ **不要在檔案總管直接雙擊 .vsix 檔**。Windows 會把 .vsix 交給 **Visual Studio(大台 IDE)的 VSIX Installer**,跳出「Install Failed — One or more extensions are for Visual Studio Code. Try installing them in Visual Studio Code.」錯誤。Visual Studio 與 VS Code 的擴充套件不通用,請一律用上面兩種方式安裝。

確認是否安裝成功:

```powershell
code --list-extensions | Select-String mermaid    # 看到 mark-ku.super-mermaid 即成功
```

### 從原始碼打包(開發者)

前置:Node.js 18+、`code` 指令可用。在專案根目錄執行:

```powershell
.\pack.ps1              # 一鍵搞定:build + 打包 VSIX + 安裝到 VS Code
```

其他用法:

```powershell
.\pack.ps1 -Bump          # patch 版號自動 +1,再 build + 打包 + 安裝(改完程式碼後用這個)
.\pack.ps1 -PackageOnly   # 只產出 .vsix 不安裝(要把檔案拿給別人裝時用)
```

腳本第一次執行會自動 `npm install`。完成後一樣 **Reload Window** 讓新版生效。

不想用腳本的話,手動等效指令:

```powershell
npm install                # 第一次需要
npm run package            # 自動先 build,再產出 super-mermaid-<version>.vsix
code --install-extension .\super-mermaid-<version>.vsix
```

> 更新版本注意:**只跑 `npm run build` 不會更新已安裝的副本**,要重新打包 + 安裝才會生效;建議直接用 `.\pack.ps1 -Bump` 一次完成加版號、打包、安裝。

其他 npm scripts:

| 指令 | 用途 |
| --- | --- |
| `npm run build` | 型別檢查 + esbuild 打包到 `dist/` |
| `npm run watch` | esbuild watch 模式(開發用) |
| `npm run type:check` | 只跑 TypeScript 型別檢查 |
| `npm run package` | 打包 VSIX |

## 更多亮點

- **內建 Markdown 預覽整合**:`Ctrl+Shift+V` 開的標準 Markdown 預覽裡,mermaid 區塊也會直接渲染成圖(同樣自動上色)
- **編輯器語言功能**:mermaid 語法上色(.mmd 與 markdown 區塊)、`%%` 註解 Ctrl+/、關鍵字自動補全、**語法錯誤紅線**(預覽開啟時即時診斷)
- **範本庫**:`Super Mermaid: Insert Diagram Template` 指令(21 種圖型範本)+ `mmd-*` snippets
- **Gallery 縮圖牆**(`g`):一頁看全部圖表,點卡片進單圖
- **狀態列**:`$(graph) N diagrams`,點擊開預覽
- 支援所有 mermaid 圖表類型:flowchart、sequenceDiagram、erDiagram、classDiagram、gantt、pie、mindmap、timeline、journey、C4、architecture⋯
- 圖表 frontmatter(`---\ntitle: X\n---`)的標題會顯示在下拉選單與 Gallery 卡片上
- 完全離線運作:mermaid 引擎打包在 extension 內,不用連網、程式碼不會外流

> 註:語法錯誤紅線由預覽面板內的 mermaid 引擎驗證,**預覽開啟期間**才會出現/更新;markdown 內自動補全預設要按 `Ctrl+Space` 觸發。journey 等少數圖型含 HTML 標籤無法轉點陣圖,匯出時會自動改存 SVG。

---

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
├── scripts/genSnippets.mjs      # build 時生成 snippets
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
├── examples/
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

---

## 如何使用

### 開啟 preview

1. 開啟任一含 ```` ```mermaid ```` 區塊的 `.md` 檔,或 `.mmd` / `.mermaid` 檔
2. 四種方式擇一:
   - 點編輯器右上角的 **preview 圖示**
   - 在編輯器內 **右鍵** → **Super Mermaid: Open Preview to the Side**
   - 在檔案總管對 `.md` / `.mmd` 檔 **右鍵** → 同上
   - 命令面板(`Ctrl+Shift+P`)→ **Super Mermaid: Open Preview to the Side**
3. 編輯內容時 preview 約 0.3 秒後自動更新;語法錯誤會顯示紅色錯誤訊息,並保留上一次成功的圖

### 工具列(由左到右)

| 控制項 | 功能 |
| --- | --- |
| 圖表下拉選單 | 同一份 markdown 有多張圖時切換(也會跟著編輯器游標自動切換) |
| `−` / `%` / `+` | 縮小、目前縮放比例(點擊回到 100%)、放大 |
| ⛶ | Fit:整張圖塞進視窗(雙擊畫布同效) |
| ↔ | Fit Width:填滿寬度,適合寬版流程圖 |
| ▦ | Gallery 縮圖牆:全部圖表一頁總覽,點卡片進單圖 |
| 主題下拉選單 | **Colorful(預設,多彩)**/ Auto / Light / Dark / Neutral / Forest,會記住選擇 |
| ⬇ **匯出選單** | Export SVG / PNG / JPG / WebP、**Export all**(整份批次匯出)、解析度 1x/2x/4x、透明背景 |
| ⋯ **更多選單** | 鎖定目前檔案、重新渲染、面板最大化、開新視窗 |

### 快捷鍵(focus 在 preview 面板時)

| 鍵 | 功能 |
| --- | --- |
| 滾輪 / 拖曳 | 縮放 / 平移 |
| `+` / `=` | 放大 |
| `-` | 縮小 |
| `0` 或雙擊 | Fit(整張圖塞進視窗) |
| `1` | 實際大小(100%) |
| `w` | Fit Width(填滿寬度) |
| `g` | Gallery 縮圖牆(再按返回單圖) |
| `f` | 面板最大化 / 還原 |

### 匯出 PNG 說明

- 匯出與複製的 PNG 解析度由工具列的 1x / 2x / 4x 控制(預設 2x,要貼簡報建議 4x)
- 背景色跟隨目前主題;匯出的 SVG 不含 foreignObject,在 Confluence / Inkscape 等環境相容性佳

---

## 開發

```powershell
npm install
npm run watch        # 或 npm run build
```

在 VS Code 開啟本資料夾按 **F5** 啟動 Extension Development Host(父層 workspace 也有「Run Super Mermaid Extension」launch 設定可直接用)。

改了 `webview/main.ts` 或 `media/webview.css` 後,可用 `test/harness.html` 在一般瀏覽器快速驗證(需先 build,再用任一靜態伺服器開啟,因為瀏覽器擋 file:// 模組載入)。
