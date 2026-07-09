# 🧑‍💼 虛擬員工系統（Subagent Virtual Employee System）

**打造一支 AI 員工團隊：每個人有自己的人設與知識庫，開會、接目標、交付成品、做研究、跟你 1 on 1。**
單機優先（local-first）、**零 API 金鑰也能跑**、繁體中文介面。

![CI](https://github.com/hoyoboy0726123/subagent-virtual-employee-system/actions/workflows/ci.yml/badge.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

你是**主管**。你的 AI 員工每個人都有人設（個性、專長、溝通風格）和一個**私有、可檢索的知識庫**。你可以召集**多輪會議**（他們會互相回應，你隨時插話引導方向）、指派**協作目標**並讓負責人**真的執行交付**、叫員工**上網研究**寫報告給你審核入庫、或跟任何人**無限輪 1 on 1**。所有產出（逐字稿、決議、報告、交付物）都能下載成 **Word / Markdown**。

---

## ⚡ 快速開始

### Windows：一鍵啟動（推薦）

1. 安裝 [Node.js](https://nodejs.org/)（22.5 以上）
2. 下載本專案（`git clone` 或 GitHub「Download ZIP」解壓）
3. **雙擊 `start.bat`** — 完成！

第一次執行會自動：安裝依賴（1–3 分鐘）→ 建置網頁介面 → 建立**預設團隊（9 位 AI 員工＋每人的專業背景知識）**→ 開啟瀏覽器。之後再雙擊會跳過已完成的步驟、直接啟動，**你的員工與資料都會保留**。

### Windows：單一 .exe（免裝 Node）

```bash
npm run build:exe    # → dist-exe/虛擬員工系統.exe（約 95 MB，內含 Node 執行環境）
```

把這顆 exe 複製到任何 Windows 電腦雙擊即用：首次啟動自動建立預設團隊並開啟瀏覽器，
資料存在 exe 旁的 `veemp-data\` 資料夾（備份＝複製該資料夾）。
限制：PDF/DOCX 上傳解析與本地向量檢索屬原始碼安裝的加值功能，exe 版自動降級
（TXT/MD/HTML 上傳與全文檢索照常）；訂閱大腦（claude/codex CLI）只要該電腦裝了
CLI 一樣可用。

### macOS / Linux

```bash
git clone https://github.com/hoyoboy0726123/subagent-virtual-employee-system.git
cd subagent-virtual-employee-system
npm install
npm run seed     # 建立預設團隊（首次；會重置資料庫）
npm run serve    # 建置 + 啟動 → http://localhost:3001
```

### Docker

```bash
docker build -t veemp .
docker run -p 3001:3001 -v veemp-data:/app/server/data veemp
# 加 --build-arg WITH_MARKITDOWN=1 可支援 PDF/DOCX 上傳解析
```

> **零設定即可用**：沒有任何金鑰時，系統用內建的離線推理引擎（persona + 檢索），
> 所有流程照常運作。設定金鑰或訂閱大腦後，每個回合改由真實模型驅動（見下方教學）。

---

## 👥 預設團隊

安裝完成即擁有一支完整的**硬體產品開發團隊**（以 PC/筆電產業為背景，每人自帶
2025–2026 年、附出處的專業背景知識——開會第一天就言之有物）：

| 員工 | 職稱 | 專業重點 |
|---|---|---|
| 林思妤 | 產品經理 | 路線圖、規格成本取捨、AI PC 策略、競品定位 |
| 陳冠宇 | 工業設計師 | CMF 材質、人因、永續與維修權法規 |
| 王志豪 | 電子工程師 | 運算平台選型、PCB／電源、電性驗證 |
| 張博翔 | 機構工程師 | 散熱結構（均熱板／熱導管）、公差、DFM 量產 |
| 黃思翰 | 韌體／軟體工程師 | BIOS/EC、驅動、系統軟體、AI 功能整合 |
| 蔡怡君 | 供應鏈／採購經理 | BOM 成本、ODM 管理、記憶體與關稅風險 |
| 周庭安 | 產品行銷經理 | 上市策略、分眾定位、評測公關 |
| 郭建成 | 品保／可靠度工程師 | EVT/DVT/PVT 關卡、MIL-STD-810H |
| YuNoTang | 成本管理師 | 單位經濟、財務建模、成本風險門檻 |

這只是起點——你可以編輯任何人、刪掉整隊、或用「✨ 發想角色」讓 AI 幫你草擬
全新的員工檔案，打造你自己產業的團隊。

---

## 📖 使用教學

### 1. 設定大腦（讓員工「活」起來）

頂欄兩顆按鈕：

- **🔑 API 金鑰**：貼上 [Google Gemini 金鑰](https://aistudio.google.com/apikey)（驅動推理）與
  [Tavily 金鑰](https://tavily.com)（讓員工能上網搜尋），各有「測試連線」按鈕，
  存檔立即生效。金鑰只存在你本機的資料庫，不回傳前端、不進版本控制。
- **🧠 大腦**：切換推理引擎——Gemini API、**Claude Pro/Max 訂閱**（裝好並登入官方
  `claude` CLI 即可，吃訂閱額度不另計費）、**ChatGPT Plus/Pro 訂閱**（`codex` CLI）。
  下拉會即時顯示每個大腦「可用／未登入／未安裝」。

### 2. 員工與知識庫

點任何員工卡片：編輯人設、貼筆記、**上傳文件**（PDF/DOCX/PPTX/XLSX/CSV 需先執行
`npm run setup:markitdown`；TXT/MD/HTML 免安裝）。每份文件會被切塊並建立全文索引，
員工在所有場合都以**自己的知識**為依據發言，並附引用標籤（🌐 網路來源可點開新分頁）。

### 3. 會議（主管主持）

「🗓️ 會議」分頁 → 選人、下主題、開始。規則：

- 員工逐輪發言、互相回應；**主管代理**（內建 AI 主持人）依討論安排發言順序並追問
- 你隨時可以**插話**——下一位發言者會把它當最高優先指示
- 會議**不會自己結束**：你決定「▶ 繼續討論」或「✅ 結束會議」產出決議與報告
- 已結束的會議可「🔄 重啟討論」接著談；再作結會以完整討論重寫報告
- 報告的行動項目可一鍵「**🎯 派成目標**」→ 變成可執行的任務

### 4. 目標與「執行交付」

「🎯 目標」分頁：指派給一或多位員工，各自認領不重疊的切片（並行執行），主管代理
整合成協作計畫。重點是每項任務的「**▶ 執行交付**」——負責人**真的動手做**：
上網查證、產出附引用的**成品**（報告、清單、方案），任務自動標記完成、全部交付後
目標自動完成。可帶「修訂指示」重新執行。

### 5. 1 on 1 面談

員工卡片 →「💬 1 on 1 面談」：無限輪私聊，要他查資料就直接說。中途關掉、切分頁、
甚至重開應用都會**自動接回同一場對話**；結束時你決定要不要把紀錄整理入庫。過往
面談隨時可「▶ 繼續」，也能匯出 Word/Markdown。

### 6. 自主研究

員工卡片 →「🔍 AI 自主研究」：出題讓員工自己上網多方查證、寫出附出處的調查報告。
報告先進「待審核」，**你核准才會進入他的知識庫**（駁回就封存）。

### 7. 記憶：越用越聰明

- **會後記憶**：每場會議作結後，自動為每位與會者寫下「他該記住的結論」
- **記憶整併**：記憶累積到門檻會自動合併成精簡版（舊記憶封存可還原），
  也可在員工卡片手動「🧠 整併記憶」

### 8. ⚙️ 系統設定

頂欄 ⚙️：會議主持風格（點名／追問／溫和～嚴厲）、記憶行為、輸出長度上限、
代理工具預算、網搜深度。全部即時生效、「恢復預設」一鍵還原。

---

## 🧠 推理大腦一覽

| Provider | 執行方式 | 備註 |
|---|---|---|
| **（無）** | 內建離線引擎 | persona + 檢索，永遠可用 |
| **`google`** | Google Gen AI API（`GEMINI_API_KEY`） | 預設模型 `gemma-4-31b-it` |
| **`claude-cli`** | 你的 **Claude Pro/Max 訂閱**（官方 `claude` CLI） | `CLAUDE_MODEL=sonnet\|opus\|haiku` |
| **`codex-cli`** | 你的 **ChatGPT Plus/Pro 訂閱**（官方 `codex` CLI） | 預設用帳號預設模型（`CODEX_MODEL` 可覆寫） |

> **訂閱大腦限單一使用者、本機使用。** 把你的訂閱憑證路由給其他使用者違反供應商
> 條款。本系統會從 CLI 子行程剝除計費金鑰環境變數並隔離回合，詳見
> [SECURITY.md](./SECURITY.md)。
>
> 📖 想在你自己的專案用這套「訂閱當大腦」模式？完整教學（headless 呼叫、六大坑、
> 可複製程式碼）在 [docs/SUBSCRIPTION_BRAINS.md](./docs/SUBSCRIPTION_BRAINS.md)。

---

## ❓ FAQ

**Q：完全不設金鑰能用嗎？**
能。所有流程（會議、目標、1on1、記憶）都以內建離線引擎運作；只有「執行交付」與
「自主研究」需要即時大腦（會誠實提示，不會假造成品）。

**Q：金鑰安全嗎？會被上傳嗎？**
金鑰存在你本機的 SQLite（已被 git 忽略），API 回應只顯示尾碼；用訂閱大腦時
系統反而會**剝除**金鑰環境變數，確保只吃訂閱額度、不誤走 API 計費。

**Q：用 Claude/Codex 訂閱會另外收費嗎？**
不會，呼叫計入你訂閱方案的用量額度（CLI 顯示的 cost 是牌價換算的估算值，非帳單）。

**Q：資料存在哪？怎麼重置？**
`server/data/app.db`（SQLite 單一檔案，備份＝複製它）。重置：刪掉它再啟動一次
（或 `npm run seed`）——會重建預設團隊；金鑰與設定會保留。

**Q：回應要等多久？**
即時大腦下，一個發言約 10–60 秒（訂閱 CLI 每次呼叫有約 8 秒固定啟動成本）。
所有等待處都有進度條與階段說明。

---

## 🏛️ 架構速覽（開發者）

- **後端**：Node + Express；SQLite（內建 `node:sqlite`，零原生建置）＋ FTS5 全文檢索
  （CJK 逐字切分＋bigram 召回）；可選混合檢索（本地 transformers.js 向量 + RRF，
  `npm run setup:embeddings` 啟用）
- **編排**（`server/src/orchestration/`）：每位員工是獨立 in-app agent（persona 系統
  提示＋自身檢索知識＋對話上下文）；`MeetingChair` 排發言、`ReportSynthesizer` 寫
  報告、`MemoryDistiller`／`MemoryConsolidator` 管記憶
- **推理**（`server/src/reasoning/`）：單一 `generate()` 原語＋可插拔 provider
  （google / claude-cli / codex-cli）；`generateAgentic` 工具迴圈
  （`search_knowledge` / `web_search` / `remember`，皆附引用）
- **前端**：React + Vite，繁體中文，Claude.ai 風格亮色主題（可切深色）

**誠實降級**：任一回合無法用即時模型時退回離線引擎，runtime 徽章如實顯示
「即時 N/M 回合」。

### API（節錄）

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/health` | 狀態、即時模型、能力、計數 |
| GET/PUT | `/api/settings`（＋`/api-keys`、`/api-keys/test`） | 設定、金鑰、主持、tunables |
| CRUD | `/api/employees…` | 員工＋知識（`/knowledge`、`/knowledge/upload`） |
| POST | `/api/meetings/discuss/stream` · `/:id/continue/stream` · `/interject` · `/:id/conclude/stream` · `/:id/reopen` | 會議生命週期（SSE） |
| POST | `/api/goals/stream` · `/:id/rerun/stream` · `/:id/tasks/:order/execute` · `/api/goals/from-meeting/:id` | 目標＋執行交付 |
| POST | `/api/employees/:id/research` · `/api/research/:id/approve` | 自主研究＋審核 |
| POST | `/api/employees/:id/dialogue` · `/api/dialogues/:id/…` | 1 on 1（含 reopen、export） |
| GET | `/api/{meetings,goals,dialogues}/:id/export?format=docx\|md` | 下載報告 |

### 驗證

```bash
npm test        # 7 個 hermetic 套件（無金鑰、無網路、記憶體資料庫）
npm run lint
npm run build
```

---

## 🗺️ Roadmap 與貢獻

- 未來計畫：[`docs/FUTURE_PLAN.md`](./docs/FUTURE_PLAN.md) · 歷程：[`ROADMAP.md`](./ROADMAP.md) · [`CHANGELOG.md`](./CHANGELOG.md)
- 貢獻指南：[`CONTRIBUTING.md`](./CONTRIBUTING.md) · 安全政策：[`SECURITY.md`](./SECURITY.md)

## 📄 License

[MIT](./LICENSE) © 2026 hoyoboy0726
