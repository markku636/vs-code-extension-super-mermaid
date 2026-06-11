# Super Mermaid

> 一款在 VS Code 預覽 Mermaid 圖表擴充套件，圖會自動上色,什麼都不用設定就能直接貼簡報;打字即時更新,PNG 最高可匯 4x 解析度,

![預覽面板](docs/images/preview-panel.png)

## 特點

- **自動上色**:預設就是 Colorful 主題,流程圖、序列圖、ER 圖、甘特圖、圓餅圖、心智圖、時間軸通通套上現代配色,圓角加柔和陰影,一行 mermaid 程式碼都不用改。不喜歡的話,工具列也能切回 Auto / Light / Dark / Neutral / Forest
- **即時預覽**:打字後約 0.3 秒更新,滾輪縮放、拖曳平移,Fit / Fit Width / 100% 都在工具列上
- **匯出**:PNG / JPG / WebP / SVG 都行,解析度 1x / 2x / 4x(要貼簡報選 4x,投影放大也不會糊),支援透明背景,Export All 可以把整份文件的圖一次匯完
- **兩種來源都吃**:Markdown 裡的 ```` ```mermaid ```` 區塊,或獨立的 `.mmd` / `.mermaid` 檔
- **內建 Markdown 預覽也有效**:`Ctrl+Shift+V` 開的標準 Markdown 預覽,mermaid 區塊一樣渲染成圖、一樣自動上色
- **編輯器語言功能**:mermaid 語法上色、`%%` 註解 Ctrl+/、關鍵字自動補全,預覽開著時語法錯誤會畫紅線
- **範本庫**:`Super Mermaid: Insert Diagram Template` 指令有 21 種圖型範本,另外還有 `mmd-*` 開頭的 snippets
- **Gallery 縮圖牆**:一頁看完文件裡所有圖表,點縮圖進單圖
- **所有 mermaid 圖型都支援**:flowchart、sequenceDiagram、erDiagram、classDiagram、gantt、pie、mindmap、timeline、journey、C4、architecture⋯
- **完全離線**:mermaid 引擎直接包在套件裡,不用連網,程式碼也不會跑出去

同一段 mermaid,什麼都沒設定,左右就差這麼多:

| mermaid 預設主題 | Super Mermaid Colorful(預設) |
| --- | --- |
| ![預設主題](docs/images/theme-default-flowchart.png) | ![Colorful 主題](docs/images/demo-flowchart.png) |

其他圖表類型的效果可以看 [docs/DEMO.md](docs/DEMO.md)。

## 怎麼用

### 開啟預覽

1. 打開任何一個有 ```` ```mermaid ```` 區塊的 `.md` 檔,或是 `.mmd` / `.mermaid` 檔
2. 下面幾種方式都行:
   - 點編輯器右上角的 preview 圖示
   - 編輯器內右鍵 → **Super Mermaid: Open Preview to the Side**
   - 檔案總管對 `.md` / `.mmd` 檔右鍵 → 同上
   - 命令面板(`Ctrl+Shift+P`)→ **Super Mermaid: Open Preview to the Side**
3. 之後邊改邊看就好,約 0.3 秒更新一次;打錯語法會跳紅色錯誤訊息,圖會停在上一次成功的版本,不會整個白掉

### 工具列(由左到右)

| 控制項 | 功能 |
| --- | --- |
| 圖表下拉選單 | 同一份 markdown 有多張圖時切換(也會跟著編輯器游標自動跳) |
| `−` / `%` / `+` | 縮小、目前縮放比例(點一下回到 100%)、放大 |
| ⛶ | Fit:整張圖塞進視窗(雙擊畫布也一樣) |
| ↔ | Fit Width:填滿寬度,寬版流程圖用這個 |
| ▦ | Gallery 縮圖牆:全部圖表一頁總覽,點卡片進單圖 |
| 主題下拉選單 | Colorful(預設)/ Auto / Light / Dark / Neutral / Forest,會記住你選的 |
| ⬇ 匯出選單 | Export SVG / PNG / JPG / WebP、Export all(整份一次匯)、解析度 1x/2x/4x、透明背景 |
| ⋯ 更多選單 | 鎖定目前檔案、重新渲染、面板最大化、開新視窗 |

### 快捷鍵(focus 在 preview 面板時)

| 鍵 | 功能 |
| --- | --- |
| 滾輪 / 拖曳 | 縮放 / 平移 |
| `+` / `=` | 放大 |
| `-` | 縮小 |
| `0` 或雙擊 | Fit(整張圖塞進視窗) |
| `1` | 實際大小(100%) |
| `w` | Fit Width(填滿寬度) |
| `g` | Gallery 縮圖牆(再按一次回單圖) |
| `f` | 面板最大化 / 還原 |

### 匯出小提醒

- 匯出跟複製的 PNG 解析度由工具列的 1x / 2x / 4x 控制,預設 2x,要貼簡報建議開 4x
- 背景色會跟著目前主題走;journey 這類含 HTML 標籤的圖沒辦法轉點陣圖,匯出時會自動改存 SVG

---

原始碼、回報問題、開發文件都在 [GitHub Repository](https://github.com/markku636/vs-code-extension-super-mermaid)。
