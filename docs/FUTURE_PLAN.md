# 🚀 未來開發計畫（邁向開源熱門應用）

> 本計畫整合了一次 5 代理程式碼審查（後端並發、推理/工具層、前端、資安、效能/品質）
> 的結論,加上針對「知識庫隨內容增長」的規模化技術評估。所有**已確認的 bug 已修復**;
> 本文件收錄的是**尚未執行的優化與升級**,依「解鎖發布 → 規模化體感 → 差異化能力」排序。

目標定位:**單機優先(standalone-first)、零外部服務也能跑、繁體中文、可累積組織
知識的多代理虛擬員工系統**。所有升級都必須守住這條——不強迫使用者接雲端服務。

---

## 里程碑 A — 開源發布就緒 ✅（已完成)

LICENSE (MIT)、`.env.example`、GitHub Actions CI、Dockerfile、ESLint、
CONTRIBUTING/SECURITY、跨平台 `setup:markitdown`、user-first README + CHANGELOG。

## 里程碑 B — 公網部署硬化（若要支援自架分享)

- [ ] **預設綁 loopback**:`app.listen(port, process.env.BIND_HOST || '127.0.0.1')`。
- [ ] **可選 `AUTH_TOKEN`**:存在時加一層 `Authorization` 檢查中介層。
- [ ] **收斂 CORS**:`cors({ origin: process.env.CORS_ORIGIN || false })`。
- [ ] **速率限制 + 並發上限**:針對燒額度端點(research / meetings / goals /
      dialogues stream),擋未授權刷爆 Tavily / 訂閱額度。
- [ ] **`helmet`** 安全標頭 + SPA 的 CSP;在 `components/ui.jsx` 標註「Markdown 元件
      刻意不解析 raw HTML,替換時務必保持消毒」。

---

## 里程碑 C — 效能與規模化（內容增長後的體感關鍵）

> 依代理實測推估:**約 500–1,000 場會議 / 破萬知識 chunk 後日常操作開始卡**。

### C1 ✅【最高】會議/目標列表:SQL 下推（已完成)
列表查詢已下推 WHERE/ORDER/LIMIT,列表只取輕量欄位(count 用 json_array_length),
不再解析 transcript/grounding blob;dashboard/health 改 SQL COUNT/SUM;client 點擊
才 fetch 完整記錄。commit `aaf859c`。

### C2 ✅【高】SSE heartbeat + 斷線中止（已完成)
新增共用 `util/sse.js`:20s heartbeat、`x-accel-buffering: no`、writableEnded 護欄;
`res.on('close')` 的 AbortSignal 穿透到 orchestrator,回合/發言邊界檢查後提前收束並
持久化已完成回合。commit `3e0f253`。

### C3【高】會議 R×P 序列 LLM 呼叫的牆鐘時間
- 3 輪×4 人 ≈ 24+ 次模型呼叫、Gemini 1.5–4 分鐘、CLI provider 5–15 分鐘;
  `research` 是非串流 JSON 卻可能跑數分鐘(瀏覽器必超時)。
- **修法**:主持人一次呼叫排出整輪順序(P 次挑人併成 1 次);下一位發言者的
  grounding/挑人與當前發言並行預取;`research` 改 SSE。

### C4【中】大檔上傳/刪除阻塞 event loop
- 15MiB 上傳 → ~3.6 萬 chunk × 2 INSERT 同步跑,凍結 event loop 數秒。限制單文件
  chunk 數、分批交易 + `setImmediate` 讓出。`deleteDocument` 逐 chunk DELETE →
  改一句 IN 子查詢。`listDocuments` 加 `WHERE employee_id=?`、列表不含 content。

### C5【中】前端大 transcript 渲染
- `React.memo(TurnRow)` + 穩定 key;超長對話再虛擬化。1on1 無上限輪數下尤其重要。

---

## 里程碑 D — 知識庫升級:從關鍵字檢索走向混合語義檢索

> **核心評估**:目前是 SQLite FTS5 + CJK 逐字切分(BM25 關鍵字)。這對「精確詞、專有
> 名詞」很好,但抓不到「換句話說、近義」。隨知識庫增長,召回率與索引膨脹會浮現。
> **不建議直接跳傳統向量 RAG**,而是分階段、守住 standalone-first。

### D1【先做,低成本高回報】檢索品質的「便宜升級」
- [ ] **CJK 滑動 bigram 召回**:現在「退貨政策」→ 單一精確 phrase,文件寫「退貨的
      政策」就零命中。對 ≥4 字的 CJK 詞補 OR 上 bigram 子片語,召回立刻改善。
- [ ] **FTS5 trigram tokenizer**(取代逐字 + phrase):posting 分佈更均勻,配
      `content=''`(external content)可砍掉約 240MB 重複儲存。
- [ ] **Anthropic Contextual Retrieval**:入庫時用一次便宜 LLM 呼叫,給每個 chunk 補
      一句脈絡再索引——實測可把 top-20 檢索失敗率降低最多 67%。

### D2【主升級】混合檢索:BM25 + 向量,Reciprocal Rank Fusion
- [ ] **`sqlite-vec`**:純 SQLite 向量擴充,向量與 FTS 共存於同一個 `.db` 檔,符合
      standalone-first。嵌入可用本地模型或使用者已設定的 provider。
- [ ] **RRF 融合**:BM25(精確)與向量(近義)各出排名,用 Reciprocal Rank Fusion
      合併。`retrieval.js` 的 `search()` 介面不變,只換內部實作。
- [ ] **保留 BM25 為保底**:無嵌入模型/離線時退回純 FTS。

### D3【記憶專屬】組織記憶的「整併」而非「無限堆積」
> 這是本系統獨有、比通用 RAG 更重要的一塊。會議記憶/研究報告/1on1 紀錄會無限累積。
- [ ] **週期性記憶蒸餾合併**(Mem0 式):背景工作把同員工的舊記憶合併、去重、更新
      「事實的演變」,而非平行堆疊。
- [ ] **分層記憶**(Letta / MemGPT 式):核心記憶常駐 system prompt;檔案記憶走檢索。
- [ ] **善用長上下文**:短會議直接把完整逐字稿塞進上下文,不必事事檢索。

> **明確不做**:GraphRAG 目前是過度設計。等真的需要「跨數百份文件的多跳推理」再評估
> LazyGraphRAG(索引成本降到全量 GraphRAG 的 0.1%)。

---

## 里程碑 E — 剩餘的次要 bug 與品質重構

### 待修的次要 bug（審查發現、非阻斷)
- [ ] **CLI timeout 後 process tree 不死** → semaphore 槽位永久流失。acquire 後掛自備
      逾時強制 resolve(null) + `taskkill /T`(Win)/ process group kill(POSIX)清樹。
- [ ] **native 工具迴圈預算單位是「回合」非「呼叫數」**:Gemini 並行 function calling
      下一個 step 可燒 2N credits。改用 `toolbox.trace.length` 對 maxSteps 計數。
- [ ] **maxSteps 用盡直接丟棄整個 turn**:research 場景燒完 6 次 Tavily 後整單作廢。
      最後一步改強制收斂。
- [ ] **runOrFallback 重試 × remember = 重複記憶文件**:以 title 去重或跨 attempt 重用。
- [ ] **雙欄 PDF 假表格**:text-strategy 誤判散文。要求 ≥3 欄或與該頁純文字量比對。
- [ ] **記憶蒸餾重複防護**:同 meetingId 重跑用 `metadata.meetingId` 查重。

### 品質重構（為開源可維護性)
- [ ] **抽 `util/semaphore.js`**:claudeCli 與 codexCli 各一份完全相同的實作。
- [ ] **抽 `util/sse.js`**:meetings.routes 與 goals.routes 的 sse()/streamRun() 重複;
      也是加 heartbeat/close(C2)的唯一落點。
- [ ] **抽 `util/json.js`**:「從模型輸出挖 JSON」寫了 4 遍(MeetingChair /
      MemoryDistiller / tools / claudeCli)。
- [ ] **刪死碼**:`orchestration/deterministic.js` 整檔無人引用;`config.defaultRuntime`
      無讀取者;MeetingsPage 殘留的 OpenClaw 🦞 badge 特判。
- [ ] **命名統一**:前端 `chat` vs 後端 `dialogues` vs UI「面談」→ 統一 dialogue。
- [ ] **測試盲區補齊**:`llm.js` 重試階梯(429/500/503 退避、MAX_TOKENS 饑餓 ×3 預算);
      SSE 傳輸層;migration 升級路徑(帶既有資料)。

---

## 建議動手順序

1. **里程碑 A** ✅ 已完成——已解鎖發布。
2. **C1(SQL 下推)+ C2(SSE heartbeat)** → 對日常體感與部署穩定性影響最大。
3. **D1(檢索便宜升級)** → 破萬 chunk 前完成,召回率立即改善。
4. **E 的次要 bug** → 隨手清。
5. **D2(sqlite-vec 混合檢索)+ D3(記憶整併)** → 這是**差異化護城河**:一個會累積、
   會整併組織知識的多代理系統,在開源界比「又一個 RAG chatbot」稀缺得多。
6. **里程碑 B(公網硬化)** → 視社群自架需求推進。
