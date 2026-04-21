---
name: add-word
description: 新增一或多個英文單字到 TOEIC 字彙庫。觸發時機：使用者說「新增單字」、「add word」、「加單字」、「新增詞彙」、「新增 xxx」（後接英文單字），或提供一串英文單字要加入字庫時使用此 skill。自動生成中文意思、詞性、TOEIC 商業情境例句、中文翻譯與分類標籤，並將資料寫入 words.json。
allowed-tools: Read, Write, Bash
model: claude-sonnet-4-6
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

對清單中的**每個單字**依序執行以下操作（一律新增，不檢查是否重複）：

### 3b. 生成詞彙資料
根據內建知識生成以下欄位（不得呼叫外部 API）：

- **word**：單字（去除空白、小寫）
- **chinese**：詞性 + 中文意思，格式 `(詞性) 義1、義2`
  - 只取最常見的 TOEIC 相關意思（最多 1–3 個）
  - 詞性縮寫：`(v.)` `(n.)` `(adj.)` `(adv.)` `(prep.)` `(phr.)`
- **sentence**：符合 TOEIC 商業情境的英文例句（合約、會議、郵件、物流、人資、財務），長度 10–20 個單字
- **translation**：例句的自然中文翻譯
- **addedAt**：今日日期（YYYY-MM-DD）
- **categories**：請先讀取 `references/categories.md` 取得完整分類清單與選取規則，選出 1–3 個最相關的標籤（陣列）

### 3c. 附加到陣列
將新資料物件加入陣列尾端。

## 步驟四：寫回 words.json

所有單字處理完畢後，將完整陣列以 2 格縮排寫回 `words.json`（只寫入一次）。

## 步驟五：寫入當日進度卡

在 `changelog/YYYY-MM-DD.md`（以今日日期命名）寫入本次新增的所有單字：

- 若檔案已存在，在既有的「## 新增單字」區塊末尾追加；若無此區塊則新增。
- 若檔案不存在，以以下格式建立：

```
# YYYY-MM-DD

## 新增單字
- word1
- word2（已存在）
- word3
```

- **所有單字都要列出**。

## 步驟六：回報結果

以清楚格式統一回報，例如：

```
已新增 3 個單字到 words.json（目前共 19 個單字）

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

✅ seminar
  中文：    (n.) 研討會、講習班
  例句：    ...
  翻譯：    ...
  分類：    personnel、general-business
```
