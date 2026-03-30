---
name: add-word
description: 當使用者說「新增單字 xxx、xxx」或「新增單字 xxx」時使用此 skill，可一次新增一或多個英文單字到 TOEIC 字彙庫。自動生成中文意思、TOEIC 情境例句、翻譯與分類標籤，並將資料寫入 words.json。
allowed-tools: Read, Write, Bash
---

# 新增單字到 TOEIC 字彙庫

今天日期：!`date +%Y-%m-%d`

## 步驟一：解析輸入

從使用者訊息中取得要新增的單字列表。單字以「、」或「,」或空格分隔，例如：
- 「新增單字 negotiate」→ `[negotiate]`
- 「新增單字 negotiate、explore、procurement」→ `[negotiate, explore, procurement]`

若解析後清單為空，告知使用者：
> 請提供要新增的英文單字，例如：「新增單字 negotiate、explore」

## 步驟二：讀取現有 words.json

讀取專案根目錄的 `words.json`。

- 若檔案不存在或內容為空，視為 `[]`
- 將內容解析為 JSON 陣列

## 步驟三：逐一處理每個單字

對清單中的**每個單字**依序執行以下操作：

### 3a. 檢查重複
在現有陣列中尋找 `word` 欄位相符的項目（不分大小寫、去除空白）。

若重複：跳過此單字，記錄為「已存在」，繼續處理下一個。

### 3b. 生成詞彙資料
根據內建知識生成以下欄位（不得呼叫外部 API）：

- **word**：單字（去除空白、小寫）
- **chinese**：詞性 + 中文意思，格式 `(詞性) 義1、義2`
  - 只取最常見的 TOEIC 相關意思（最多 1–3 個）
  - 詞性縮寫：`(v.)` `(n.)` `(adj.)` `(adv.)` `(prep.)` `(phr.)`
- **sentence**：符合 TOEIC 商業情境的英文例句（合約、會議、郵件、物流、人資、財務），長度 10–20 個單字
- **translation**：例句的自然中文翻譯
- **addedAt**：今日日期（YYYY-MM-DD）
- **categories**：從以下清單選出 1–3 個最相關的分類標籤（陣列）：

  | 標籤 | 適用情境 |
  |------|----------|
  | `travel` | 交通、訂房、出差、機場 |
  | `dining-out` | 餐廳、訂位、菜單、用餐 |
  | `entertainment` | 活動、展覽、休閒、票務 |
  | `housing` | 租屋、房產、搬家、物業管理 |
  | `purchasing` | 採購、訂單、供應商、庫存 |
  | `personnel` | 人資、招聘、績效、員工 |
  | `offices` | 辦公室、設備、行政、會議室 |
  | `health` | 醫療、保險、安全、健康福利 |
  | `general-business` | 通用商業、策略、目標、客戶 |
  | `manufacturing` | 生產、品管、工廠、物流 |
  | `corporate-development` | 企業發展、合併、投資、拓展 |
  | `technical` | 技術、IT、系統、設備維護 |
  | `financing-areas` | 財務、預算、帳款、審計 |
  | `common` | 連接詞、通用片語、可用於任何情境的詞彙 |

  **規則**：
  - 連接詞、轉折語、通用副詞（however, therefore, in comparison to 等）→ 只用 `common`
  - 一般單字選 1–2 個最符合的主題分類，不需加 `common`
  - 如果真的跨多個主題，最多 3 個

### 3c. 附加到陣列
將新資料物件加入陣列尾端。

## 步驟四：寫回 words.json

所有單字處理完畢後，將完整陣列以 2 格縮排寫回 `words.json`（只寫入一次）。

## 步驟五：回報結果

以清楚格式統一回報，例如：

```
已新增 2 個單字到 words.json（目前共 16 個單字）

✅ negotiate
  中文：    (v.) 協商、談判
  例句：    We need to negotiate the contract terms before signing.
  翻譯：    我們在簽約前需要協商合約條款。
  分類：    general-business、personnel

✅ procurement
  中文：    (n.) 採購
  例句：    The procurement department handles all supplier contracts.
  翻譯：    採購部門負責處理所有供應商合約。
  分類：    purchasing

⏭️ explore（已存在，略過）
```
