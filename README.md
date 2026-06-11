# Super Mermaid

> 在 VS Code 裡把 Mermaid 圖表變成**拿得出手的圖**——自動上色、即時預覽、一鍵匯出高解析 PNG。

![預覽面板](docs/images/preview-panel.png)

## 特點

- **自動上色(Colorful 主題,預設)**:節點 / 子圖 / 序列圖角色 / ER 表格 / 甘特 / 圓餅 / 心智圖 / 時間軸自動套用現代色票,圓角 + 柔和陰影,**不用改任何一行 mermaid 程式碼**;也可一鍵切回 Auto / Light / Dark / Neutral / Forest
- **即時預覽**:邊打字邊更新(約 0.3 秒),滾輪縮放、拖曳平移,Fit / Fit Width / 100% 一鍵切換
- **一鍵匯出**:PNG / JPG / WebP / SVG,解析度 **1x / 2x / 4x**(4x 貼簡報放大投影也銳利)、**透明背景**、**Export All** 整份批次匯出
- **兩種來源都支援**:Markdown 的 ```` ```mermaid ```` code block,以及獨立的 `.mmd` / `.mermaid` 檔
- **內建 Markdown 預覽整合**:`Ctrl+Shift+V` 的標準 Markdown 預覽裡,mermaid 區塊也直接渲染成圖(同樣自動上色)
- **編輯器語言功能**:mermaid 語法上色、`%%` 註解 Ctrl+/、關鍵字自動補全、語法錯誤紅線(預覽開啟時)
- **範本庫**:`Super Mermaid: Insert Diagram Template` 指令(21 種圖型範本)+ `mmd-*` snippets
- **Gallery 縮圖牆**:一頁總覽全部圖表,點卡片進單圖
- **支援所有 mermaid 圖表類型**:flowchart、sequenceDiagram、erDiagram、classDiagram、gantt、pie、mindmap、timeline、journey、C4、architecture⋯
- **完全離線運作**:mermaid 引擎打包在 extension 內,不用連網、程式碼不會外流

同一段 mermaid 程式碼,零設定的前後對比:

| mermaid 預設主題 | Super Mermaid Colorful(預設) |
| --- | --- |
| ![預設主題](docs/images/theme-default-flowchart.png) | ![Colorful 主題](docs/images/demo-flowchart.png) |

> 📷 九種圖表類型的完整效果見 **[docs/DEMO.md](docs/DEMO.md)**。

## 怎麼使用

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

### 匯出小提醒

- 匯出與複製的 PNG 解析度由工具列的 1x / 2x / 4x 控制(預設 2x,要貼簡報建議 4x)
- 背景色跟隨目前主題;journey 等少數含 HTML 標籤的圖型無法轉點陣圖,匯出時會自動改存 SVG

---

原始碼、回報問題、開發文件見 [GitHub Repository](https://github.com/markku636/vs-code-extension-super-mermaid)。
