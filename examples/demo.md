# Super Mermaid 圖表展示

開啟本檔案後，點編輯器右上角的 **preview 圖示**（或右鍵 → Super Mermaid: Open Preview to the Side），
用工具列下拉選單或按 `g` 開 Gallery 縮圖牆瀏覽全部圖表。所有圖表都是**零設定自動上色**——
沒有寫任何一行 `classDef` / `style`。

## 流程圖 Flowchart

```mermaid
---
title: 訂單處理流程
---
flowchart RL
    J([通知出貨])
    subgraph Client [客戶端]
        B[購物車結帳]
        A([使用者下單])
    end
    subgraph Backend [後端服務]
        C{庫存足夠?}
        D[建立訂單]
        E[發送補貨通知]
        F[呼叫金流 API]
    end
    subgraph Payment [金流]
        G{付款成功?}
        H[訂單成立]
        I[釋放庫存]
    end
    A --> B
    B --> C
    C -->|是| D
    D --> F
    F --> G
    C -->|否| E
    G -->|是| H
    G -->|否| I
    H --> J
```

## 循序圖 Sequence

```mermaid
---
title: 會員登入驗證
---
sequenceDiagram
    autonumber
    actor U as 使用者
    participant W as Web 前端
    participant API as Auth API
    participant DB as 資料庫

    U->>W: 輸入帳號密碼
    W->>API: POST /login
    API->>DB: 查詢使用者
    DB-->>API: 使用者資料
    alt 密碼正確
        API-->>W: 200 OK + JWT
        W-->>U: 導向會員中心
    else 密碼錯誤
        API-->>W: 401 Unauthorized
        W-->>U: 顯示錯誤訊息
    end
```

## 類別圖 Class

```mermaid
---
title: 訂單領域模型
---
classDiagram
    class Order {
        +String orderId
        +Date createdAt
        +OrderStatus status
        +total() Money
        +cancel() void
    }
    class OrderItem {
        +String sku
        +int quantity
        +Money unitPrice
    }
    class Customer {
        +String custId
        +String name
        +placeOrder() Order
    }
    class Payment {
        +String txnId
        +Money amount
        +capture() bool
    }
    Customer "1" --> "*" Order : 下單
    Order "1" *-- "1..*" OrderItem : 包含
    Order "1" --> "0..1" Payment : 付款
```

## 實體關聯圖 ER

```mermaid
---
title: 電商資料庫
---
erDiagram
    CUSTOMER ||--o{ ORDER : "下單"
    ORDER ||--|{ ORDER_ITEM : "包含"
    PRODUCT ||--o{ ORDER_ITEM : "被訂購"
    CUSTOMER {
        string cust_id PK
        string name
        string email
    }
    ORDER {
        string order_id PK
        string cust_id FK
        datetime created_at
        string status
    }
    ORDER_ITEM {
        string order_id FK
        string sku FK
        int quantity
        decimal unit_price
    }
    PRODUCT {
        string sku PK
        string name
        decimal price
    }
```

## 狀態圖 State

```mermaid
---
title: 訂單狀態機
---
stateDiagram-v2
    [*] --> 待付款
    待付款 --> 已付款 : 付款成功
    待付款 --> 已取消 : 逾時 / 取消
    已付款 --> 出貨中 : 揀貨完成
    出貨中 --> 已送達 : 物流簽收
    已送達 --> 退貨中 : 申請退貨
    退貨中 --> 已退款 : 退款完成
    已送達 --> [*] : 完成
    已取消 --> [*]
    已退款 --> [*]
```

## 甘特圖 Gantt

```mermaid
---
title: 產品開發時程
---
gantt
    title 2026 Q3 開發計畫
    dateFormat YYYY-MM-DD
    section 設計
        需求訪談       :done,    a1, 2026-07-01, 5d
        Wireframe     :active,  a2, after a1, 7d
        視覺設計       :         a3, after a2, 7d
    section 開發
        API 實作      :         b1, after a2, 14d
        前端頁面       :         b2, after a3, 14d
    section 上線
        整合測試       :         c1, after b2, 5d
        正式發布       :milestone, c2, after c1, 0d
```

## 圓餅圖 Pie

```mermaid
---
title: 流量來源占比
---
pie title 網站流量來源
    "自然搜尋" : 42
    "社群媒體" : 23
    "直接流量" : 18
    "廣告投放" : 12
    "其他" : 5
```

## 心智圖 Mindmap

```mermaid
---
title: 產品規劃心智圖
---
mindmap
  root((新產品規劃))
    目標客群
      中小企業
      自由工作者
    核心功能
      即時協作
      範本庫
      API 整合
    商業模式
      訂閱制
      企業授權
    風險
      競品壓力
      開發時程
```

## 時間軸 Timeline

```mermaid
---
title: 產品里程碑
---
timeline
    title 產品發展歷程
    section 2025
        Q1 : 完成 MVP : 種子輪募資
        Q3 : 正式上線 : 突破 1 萬用戶
    section 2026
        Q1 : 推出行動版
        Q2 : 企業版發布 : 通過 ISO 27001
```
