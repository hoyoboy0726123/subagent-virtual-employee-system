# 用 Claude／Codex「訂閱帳號」當你的 App 大腦 — 完整實作教學

> 本文整理自本專案(subagent-virtual-employee-system)的實戰經驗,
> 目的是讓**其他專案**能直接參考、複製這套做法。
> 對應原始碼:`server/src/reasoning/providers/`(claudeCli.js、codexCli.js、resolveCli.js、cliRunner.js、index.js)。

---

## 1. 核心概念:為什麼走 CLI,而不是 API?

| | API 金鑰 | 訂閱 CLI(本文做法) |
|---|---|---|
| 計費 | 按 token 計費(metered) | 計入 Pro/Max/Plus **訂閱額度**,不另外收費 |
| 認證 | 你的程式持有金鑰 | **官方 CLI 自己管登入**,你的程式不碰憑證 |
| 取得方式 | 申請 API key | 使用者本來就付的訂閱 + `npm i -g` 官方 CLI |

原理:Anthropic 的 `claude` CLI 和 OpenAI 的 `codex` CLI 都支援**非互動(headless)模式**——
一次性餵進 prompt、拿回結果、行程結束。在訂閱帳號登入下,這些呼叫**吃訂閱額度**
(官方說明:*draws from your subscription's usage limits*),對已付訂閱的使用者等於「免費的大腦」。

你的 App 只要把「呼叫模型」抽象成一個函式,背後 spawn 官方 CLI 即可:

```
你的 App ──(spawn + stdin prompt)──► claude -p / codex exec ──► 訂閱額度
```

### ⚠️ 合規紅線(必讀)

1. **單一使用者、本機使用**。把「你的訂閱」路由給其他使用者用(例如做成多人服務)
   **違反供應商服務條款**。這套做法只適合 local-first、單人使用的應用。
2. **永遠不要自己讀取/重放 OAuth token**。登入是 CLI 的事;你的程式只 spawn CLI。
3. 在 README 裡明確告知使用者以上兩點。

---

## 2. 兩個 CLI 的 headless 呼叫方式

### 2.1 Claude CLI(`claude`)

```bash
# 安裝與登入(使用者自己做,一次即可)
npm install -g @anthropic-ai/claude-code
claude          # 互動式登入 Pro/Max 帳號;或 claude setup-token 產生長效 token

# 你的程式實際 spawn 的指令
claude -p \
  --output-format json \
  --model sonnet \
  --disallowedTools "Bash,Edit,Write,Read,Glob,Grep,WebSearch,WebFetch,NotebookEdit,Agent" \
  --strict-mcp-config \
  --append-system-prompt "你是產品經理…(persona)"
# ← user prompt 從 stdin 餵入(見 §4.1,不要放在 argv)
```

逐項解釋:

| 參數 | 為什麼 |
|---|---|
| `-p`(print mode) | 非互動:讀 prompt → 輸出 → 結束 |
| `--output-format json` | 拿到結構化結果:`{ result, is_error, total_cost_usd, … }` |
| `--model sonnet` | `sonnet`/`opus`/`haiku` 或完整 model id |
| `--disallowedTools …` | **關掉 Claude Code 內建工具**。你要的是純文字生成,不是讓它動你的檔案系統(避免「雙重代理」) |
| `--strict-mcp-config` | 忽略使用者機器上的 MCP servers 與 CLAUDE.md,呼叫變成乾淨、隔離的 persona 補全 |
| `--append-system-prompt` | 你的 persona/system prompt 由此進入 |
| 環境變數 `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | 控制輸出上限(沒有對應 CLI 參數) |

**回傳解析**:stdout 是一個 JSON 物件,取 `parsed.result` 當文字;`parsed.is_error` 為 true 就當失敗。
注意 stdout 可能夾雜前置雜訊,要用「掃描最外層平衡大括號」的方式容錯解析(見原始碼 `parseClaudeJson`)。

### 2.2 Codex CLI(`codex`)

```bash
# 安裝與登入
npm install -g @openai/codex
codex login     # 登入 ChatGPT Plus/Pro 帳號

# 你的程式實際 spawn 的指令
codex exec \
  --json \
  -m gpt-5.5-codex \
  --sandbox read-only \
  --skip-git-repo-check \
  --cd <一個空的暫存資料夾> \
  -               # ← "-" 表示 prompt 從 stdin 讀
```

| 參數 | 為什麼 |
|---|---|
| `exec --json` | 非互動 + 輸出 JSONL 事件流 |
| `--sandbox read-only` | 純文字生成,禁止檔案/指令代理行為 |
| `--cd <空暫存資料夾>` | codex 需要工作目錄;給它一個 `mkdtemp` 的空資料夾,**它就看不到你的專案** |
| `--skip-git-repo-check` | 暫存資料夾不是 git repo,跳過檢查 |
| 沒有 system prompt 參數 | **把 persona 摺進 prompt 開頭**:`${system}\n\n${body}` |

**回傳解析**:stdout 是 JSONL(一行一個 JSON 事件),最終答案是**最後一個**
`{"type":"item.completed","item":{"type":"agent_message","text":"…"}}` 事件的 `text`。逐行 parse、壞行跳過。

---

## 3. Provider 介面設計(讓大腦可插拔)

把每個大腦包成同一個形狀,你的 App 其餘部分完全不用知道背後是 API 還是 CLI:

```js
{
  name: 'claude-cli',
  label: () => 'Claude 訂閱（claude CLI · sonnet）',   // UI 顯示
  modelId: () => 'sonnet',
  availableSync: () => boolean,                        // 現在能用嗎?(探測+快取)
  generate: async ({ system, user, maxTokens, model }) // → { text, functionCalls: [], raw } | null
}
```

兩個關鍵約定:

1. **失敗一律回 `null`,不丟例外**——呼叫端統一 fallback(本專案退到離線確定性引擎)。
   一次失敗的模型回合應該「降級」,不該讓整個服務掛掉。
2. **CLI 大腦沒有原生 function calling**。如果你的 App 有 agent 工具迴圈,
   對 CLI provider 改用「prompt 協議」:在指令裡教模型輸出一行 JSON
   (`{"tool":"web_search","args":{…}}`),你解析、執行、把結果貼回 prompt 再呼叫一次。

---

## 4. 六個必踩的坑與解法(本專案全踩過)

### 4.1 Prompt 走 stdin,不要放 argv

Persona + 對話上下文很容易超過命令列長度限制,而且引號跳脫是災難。
兩個 CLI 都支援 stdin:

```js
const child = execFile(cmd, args, opts, (err, out) => resolve(err && !out ? null : out));
child.stdin.on('error', () => {});   // ← 必加!見下一條
child.stdin.end(prompt);
```

**`stdin.on('error')` 是必須的**:如果 CLI 在讀完 stdin 前就結束(>~64KB 時常見),
EPIPE 會以非同步 stream error 冒出來、**繞過 try/catch 直接炸掉整個 Node 行程**。

### 4.2 Windows:npm 的 `.cmd` shim 無法被 `execFile` 執行

`npm i -g` 在 Windows 裝的是 `claude.cmd`/`codex.cmd` shim——`execFile` 不用 shell 就跑不動它,
用 shell 又會毀掉帶整段 persona 的參數引號。解法:**找到 shim 旁邊套件內的真 .exe,直接 spawn 它**:

```
where claude → C:\...\npm\claude.cmd
真正的執行檔 → C:\...\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe
codex 的則在 → node_modules\@openai\codex\bin\codex*.exe 或 vendor\...\codex.exe
```

(完整探測順序見 `resolveCli.js`:先試裸名 → `.exe` → `where` 找 shim → 套件內已知路徑逐一 probe。)

### 4.3 計費防呆:清掉子行程環境裡的 API 金鑰

**真實踩坑**:機器上如果剛好設了 `ANTHROPIC_API_KEY`,CLI 會**優先用它走 API 計費**,
訂閱額度反而沒用到——使用者以為免費,實際在燒錢。spawn 前把這些從子行程環境剝掉:

```js
const {
  ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL,
  CLAUDE_CODE_USE_BEDROCK, CLAUDE_CODE_USE_VERTEX,   // 企業機器常設,同樣會改道
  ...env
} = process.env;
```

另外:Claude CLI 回傳的 `total_cost_usd` 是**牌價換算的用量估算**,訂閱登入下它非零
**不代表被收費**。提示一次即可,別每回合嚇使用者。

### 4.4 併發要上鎖(semaphore)

訂閱有共享的 rate window。一場 5 人會議同時開 5 個 CLI 就是自己 DDoS 自己的額度。
用一個小 FIFO semaphore(本專案預設 `maxConcurrent: 2`)排隊。

### 4.5 逾時後行程樹可能不死 → 永久卡死

`execFile` 的 `timeout` 只會 SIGTERM **直接子行程**;但這兩個 CLI 會再生孫行程
(MCP/sandbox helper),孫行程握著 stdout pipe 不放 → `close` callback 永遠不觸發 →
**semaphore 名額永久流失**,漏兩次之後整個 provider 死鎖。解法(見 `cliRunner.js`):

```js
// 1) 自備一個比 execFile timeout 再寬限 10s 的守門 timer,強制 resolve(null)
// 2) 殺整棵行程樹:
//    POSIX  → spawn 時 { detached: true },殺的時候 process.kill(-child.pid, 'SIGKILL')
//    Windows→ execFile('taskkill', ['/T', '/F', '/PID', String(child.pid)])
// 3) done() 要冪等(settled flag),遲到的 callback 不能二次 resolve
```

### 4.6 可用性探測與「未登入」偵測

UI 要能誠實顯示「未安裝／未登入／可用」三態:

- **安裝了沒**:`cli --version` probe(成功即安裝)。負向結果要有 TTL(本專案 60 秒)——
  使用者剛裝好/剛登入,不必重啟你的 App 就能被偵測到。
- **登入了沒**(只檢查憑證檔**存在**,絕不讀內容):
  - Claude:`~/.claude/.credentials.json` 存在(或設定了 `CLAUDE_CODE_OAUTH_TOKEN`)
  - Codex:`~/.codex/auth.json` 存在

---

## 5. 最小可用實作(可直接抄)

```js
import { execFile } from 'node:child_process';

// —— 通用:spawn CLI、stdin 餵 prompt、防掛死(§4.1 + §4.5)——
function runCli(cmd, args, { env, timeoutMs = 300_000 } = {}, prompt = '') {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; clearTimeout(guard); resolve(v); } };
    const posix = process.platform !== 'win32';
    const child = execFile(
      cmd, args,
      { env, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
        ...(posix ? { detached: true } : {}) },
      (err, out) => done(err && !out ? null : String(out || '')),
    );
    const killTree = () => {
      if (!child?.pid) return;
      if (posix) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
      else execFile('taskkill', ['/T', '/F', '/PID', String(child.pid)], () => {});
    };
    const guard = setTimeout(() => { killTree(); done(null); }, timeoutMs + 10_000);
    guard.unref?.();
    child?.stdin?.on('error', () => {});
    child?.stdin?.end(prompt);
  });
}

// —— Claude 訂閱回合 ——
async function claudeTurn({ system, user, model = 'sonnet', maxTokens }) {
  const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL,
          CLAUDE_CODE_USE_BEDROCK, CLAUDE_CODE_USE_VERTEX, ...env } = process.env; // §4.3
  if (maxTokens) env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(maxTokens);
  const args = ['-p', '--output-format', 'json', '--model', model,
    '--disallowedTools', 'Bash,Edit,Write,Read,Glob,Grep,WebSearch,WebFetch,NotebookEdit,Agent',
    '--strict-mcp-config'];
  if (system) args.push('--append-system-prompt', system);
  const out = await runCli('claude', args, { env }, user);   // Windows 請先過 resolveCli(§4.2)
  if (!out) return null;
  try { const j = JSON.parse(out); return j.is_error ? null : (j.result?.trim() || null); }
  catch { return null; }
}

// —— Codex 訂閱回合 ——
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
async function codexTurn({ system, user, model = 'gpt-5.5-codex' }) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-'));  // 空目錄,隔離專案
  const out = await runCli('codex',
    ['exec', '--json', '-m', model, '--sandbox', 'read-only', '--skip-git-repo-check', '--cd', scratch, '-'],
    {}, system ? `${system}\n\n${user}` : user);
  if (!out) return null;
  let last = '';
  for (const line of out.split('\n')) {
    try {
      const evt = JSON.parse(line.trim());
      if (evt.type === 'item.completed' && evt.item?.type === 'agent_message' && evt.item.text) {
        last = evt.item.text.trim();
      }
    } catch { /* skip */ }
  }
  return last || null;
}
```

搭配一個 semaphore(§4.4)包住呼叫,就是完整的訂閱大腦。

---

## 6. 測試建議(hermetic,不碰真 CLI、不花額度)

- `execFile` **依賴注入**:provider 建構時收 `execFileImpl`,測試餵假的子行程
  (stdin 有 `on`/`end`,`end()` 時呼叫 callback 回傳罐頭 stdout)。
- 假 CLI 名稱(如 `veemp-no-such-binary`)驗證「未安裝 → 乾淨 null → fallback」。
- 驗證 argv:headless 參數、工具被停用、`--append-system-prompt` 帶到 persona。
- 驗證子行程環境:`env.ANTHROPIC_API_KEY === undefined`(計費防呆真的有生效)。
- 掛死情境:餵一個**永不回呼**的假子行程,斷言守門 timer 在 timeout+寬限內強制 resolve null
  (semaphore 不流失)。
- **重要**:測試自身要 `DB_FILE=:memory:`、固定 `LLM_PROVIDER`、清掉環境金鑰——
  否則測試會讀到使用者的真實設定、真的打到訂閱額度(本專案踩過,見 `server/test/_hermetic.mjs`)。

---

## 7. 檢查清單(移植到新專案時逐項打勾)

- [ ] Provider 介面統一(`generate → {text}|null`),失敗回 null 不丟例外
- [ ] Prompt 走 stdin + `stdin.on('error')`
- [ ] Windows `.cmd` shim → 真 .exe 解析(`resolveCli`)
- [ ] 子行程環境剝除 API 金鑰(Anthropic 全家桶 + Bedrock/Vertex)
- [ ] Semaphore 限流(建議 2)
- [ ] 自備逾時 + 行程樹清理(taskkill /T ‖ process group kill)+ 冪等 done()
- [ ] 安裝/登入三態偵測,負向探測帶 TTL
- [ ] `total_cost_usd` 當估算展示,不當帳單
- [ ] CLI 大腦走 prompt 工具協議(無原生 function calling)
- [ ] README 標注:單一使用者、本機使用、CLI 管憑證
- [ ] Hermetic 測試(依賴注入,永不打真額度)

---

## 8. 本專案的完整整合(進一步參考)

| 檔案 | 內容 |
|---|---|
| `server/src/reasoning/providers/claudeCli.js` | Claude 訂閱 provider(本文 §2.1/§4 的完整版) |
| `server/src/reasoning/providers/codexCli.js` | Codex 訂閱 provider(§2.2) |
| `server/src/reasoning/providers/resolveCli.js` | Windows shim → 真 exe 解析(§4.2) |
| `server/src/reasoning/providers/cliRunner.js` | stdin + 行程樹守門(§4.1/§4.5) |
| `server/src/reasoning/providers/index.js` | provider 註冊表 + 安裝/登入偵測(§4.6)+ UI 用狀態 |
| `server/src/reasoning/llm.js` | `generate()` 統一入口:CLI provider 接管整個呼叫 |
| `server/test/smoke.providers.mjs` | hermetic 測試範本(§6) |
| `server/test/smoke.cliRunner.mjs` | 掛死/行程樹測試範本(§6) |

UI 端(可選):做一個大腦下拉選單,顯示每個 provider 的三態
(`可用（版本 · 模型）` / `已安裝但未登入——請在終端機執行 claude` / `未安裝 claude CLI`),
搭配負向 TTL,使用者裝好登入完回來重選即可,不用重啟。
