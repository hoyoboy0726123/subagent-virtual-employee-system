import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { Modal } from './components/ui.jsx';
import EmployeesPage from './pages/EmployeesPage.jsx';
import MeetingsPage from './pages/MeetingsPage.jsx';
import GoalsPage from './pages/GoalsPage.jsx';

const TABS = [
  { key: 'employees', label: '👥 員工' },
  { key: 'meetings', label: '🗓️ 會議' },
  { key: 'goals', label: '🎯 目標' },
];

// Packaged (windowless) exe only: quit the app from the browser, since there's
// no console window to close. After the server exits, show a done screen.
function QuitButton() {
  const [done, setDone] = useState(false);
  const quit = async () => {
    if (!window.confirm('確定要關閉應用嗎？未儲存的進行中討論會停止。')) return;
    try { await api.post('/shutdown', {}); } catch { /* server exits mid-response */ }
    setDone(true);
  };
  if (done) {
    return (
      <div className="quit-overlay">
        <div className="quit-card">
          <div className="quit-emoji">👋</div>
          <h2>應用已關閉</h2>
          <p className="muted">服務已停止，可以直接關閉這個瀏覽器分頁。<br />下次要用時再雙擊「虛擬員工系統」即可。</p>
        </div>
      </div>
    );
  }
  return (
    <button className="icon-btn" onClick={quit} title="關閉應用（停止服務）" aria-label="關閉應用">⏻</button>
  );
}

export default function App() {
  const [tab, setTab] = useState('employees');
  const [health, setHealth] = useState(null);
  const [settings, setSettings] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  // Theme: the Claude-style light palette is the product default; dark is
  // opt-in and remembered.
  const [theme, setTheme] = useState(() => localStorage.getItem('veemp-theme') || 'light');
  const [showKeys, setShowKeys] = useState(false); // 🔑 API-keys modal
  const [showSettings, setShowSettings] = useState(false); // ⚙️ settings modal
  // Bump this to force child pages to refetch after cross-cutting changes.
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);
  // Which tabs have work in flight (an open meeting room / a running goal) —
  // shown as a dot on the tab so the manager knows it's safe to switch away.
  const [activity, setActivity] = useState({});
  const reportActivity = (key) => (active) =>
    setActivity((a) => (Boolean(a[key]) === Boolean(active) ? a : { ...a, [key]: Boolean(active) }));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('veemp-theme', theme);
  }, [theme]);

  useEffect(() => {
    api.get('/health').then(setHealth).catch(() => setHealth({ ok: false }));
    api.get('/settings').then(setSettings).catch(() => setSettings(null));
    api.get('/dashboard').then(setDashboard).catch(() => setDashboard(null));
  }, [refreshKey]);

  const toggleWebSearch = async () => {
    try {
      const next = await api.put('/settings', { webSearchEnabled: !settings?.webSearch?.enabled });
      setSettings((s) => ({ ...s, ...next }));
      refresh();
    } catch (e) {
      alert(e.message); // e.g. 尚未設定 TAVILY_API_KEY
    }
  };

  // Phase 18: switch the reasoning brain (google API / Claude 訂閱 / Codex 訂閱).
  const switchBrain = async (id) => {
    try {
      const next = await api.put('/settings', { llmProvider: id });
      setSettings((s) => ({ ...s, ...next }));
      refresh();
    } catch (e) {
      alert(e.message); // e.g. 已安裝但未登入
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">🧑‍💼</span>
          <div>
            <h1>虛擬員工系統</h1>
            <p className="subtitle">你是主管，打造屬於你的 AI 員工團隊。</p>
          </div>
        </div>
        <div className="topbar-status">
          {settings && (
            <label
              className="runtime-switch web-toggle"
              title={settings.webSearch?.keyConfigured
                ? '開啟後，AI 員工在會議、目標與自主研究中可視需要上網搜尋（Tavily 深度搜索），引用外部資料時會標明出處'
                : '點右側 🔑 輸入 Tavily 金鑰（或在伺服器環境設定 TAVILY_API_KEY）即可開啟網路搜尋'}
            >
              <input
                type="checkbox"
                checked={Boolean(settings.webSearch?.enabled)}
                onChange={toggleWebSearch}
              />
              <span className="runtime-label">
                🌐 網路搜尋{settings.webSearch?.keyConfigured ? '' : '（未設定金鑰）'}
              </span>
            </label>
          )}
          <button
            className="icon-btn"
            onClick={() => setShowKeys(true)}
            title="設定 Gemini / 網路搜尋 API 金鑰（僅儲存在本機）"
            aria-label="API 金鑰設定"
          >
            🔑
          </button>
          <button
            className="icon-btn"
            onClick={() => setShowSettings(true)}
            title="系統設定（會議主持行為等）"
            aria-label="系統設定"
          >
            ⚙️
          </button>
          {settings?.llm && (
            <label
              className="runtime-switch brain-switch"
              title={settings.llm.providers?.find((p) => p.id === settings.llm.provider)?.detail || '選擇驅動 AI 員工的推理大腦'}
            >
              <span className="runtime-label">🧠 大腦</span>
              <select value={settings.llm.provider} onChange={(e) => switchBrain(e.target.value)}>
                {(settings.llm.providers || []).map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.selectable} title={p.detail}>
                    {p.label}{p.available ? '' : `（${p.id === 'google' ? '離線' : (p.detail.includes('未登入') ? '未登入' : '未安裝')}）`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {settings?.llm && (
            <span
              className={`pill ${settings.llm.live ? 'pill-live' : 'pill-sim'}`}
              title={settings.llm.live
                ? `每個代理回合由「${settings.llm.active?.label}」即時執行`
                : '目前的大腦不可用或未設定金鑰；以離線推理引擎（persona + RAG）執行，仍為真實多代理編排'}
            >
              {settings.llm.live ? `即時：${settings.llm.active?.model}` : '離線推理'}
            </span>
          )}
          <button
            className="icon-btn theme-toggle"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? '切換為明亮模式' : '切換為深色模式'}
            aria-label="切換主題"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          {health?.packaged && <QuitButton />}
        </div>
      </header>

      {dashboard && <DashboardStrip dashboard={dashboard} />}

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'tab tab-active' : 'tab'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {activity[t.key] && <span className="tab-dot" title="有進行中的工作——切換分頁不會中斷它">🟢</span>}
          </button>
        ))}
      </nav>

      {/* All three pages stay MOUNTED; inactive ones are only hidden. An
          in-flight meeting round or goal run (SSE) survives tab switches — the
          manager can hop to a 1on1 or the goals page and come back to a
          discussion that kept going. Unmounting would drop the stream and
          trigger the server's abort-on-disconnect. */}
      <main className="content">
        <div className={tab === 'employees' ? '' : 'tab-hidden'}>
          <EmployeesPage refreshKey={refreshKey} onChange={refresh} />
        </div>
        <div className={tab === 'meetings' ? '' : 'tab-hidden'}>
          <MeetingsPage refreshKey={refreshKey} onChange={refresh} onActivity={reportActivity('meetings')} />
        </div>
        <div className={tab === 'goals' ? '' : 'tab-hidden'}>
          <GoalsPage refreshKey={refreshKey} onChange={refresh} onActivity={reportActivity('goals')} />
        </div>
      </main>

      <footer className="footer">
        獨立運作 · 內建多代理編排 · SQLite 儲存 · 無需外部服務{settings?.runtimeLabel ? ` · ${settings.runtimeLabel}` : ''}
      </footer>

      {showKeys && (
        <ApiKeysModal
          status={settings?.apiKeys}
          onClose={() => setShowKeys(false)}
          onSaved={(next) => { setSettings((s) => ({ ...s, ...next })); refresh(); }}
        />
      )}

      {showSettings && (
        <SettingsModal
          chair={settings?.chair}
          tunables={settings?.tunables}
          onClose={() => setShowSettings(false)}
          onSaved={(next) => setSettings((s) => ({ ...s, ...next }))}
        />
      )}
    </div>
  );
}

// ⚙️ System settings — the meeting chair (主管代理), memory behaviour, output
// budgets, and agent-tool limits. Everything is stored server-side (SQLite
// settings), applies immediately (no restart), and「恢復預設」reverts to what
// the server booted with (env vars keep their meaning). A tunable saved at its
// default value clears its override instead of pinning it.
function SettingsModal({ chair, tunables, onClose, onSaved }) {
  const [cfg, setCfg] = useState({
    dynamicOrder: chair?.dynamicOrder !== false,
    followUps: chair?.followUps !== false,
    style: chair?.style || 'standard',
    model: chair?.model || '',
  });
  const defaults = tunables?.defaults || {};
  const [tun, setTun] = useState({ ...(tunables?.values || {}) });
  const [state, setState] = useState({ busy: false, msg: '', err: '' });

  const num = (id) => (e) => setTun({ ...tun, [id]: e.target.value });

  const save = async () => {
    setState({ busy: true, msg: '', err: '' });
    try {
      // Send a value only where it differs from the boot default; equal values
      // are sent as null so the override is CLEARED, not pinned forever.
      const patch = {};
      for (const [id, v] of Object.entries(tun)) {
        const parsed = typeof defaults[id] === 'number' ? Math.round(Number(v)) : v;
        patch[id] = parsed === defaults[id] ? null : parsed;
      }
      const next = await api.put('/settings', { chairConfig: cfg, tunables: patch });
      onSaved(next);
      setTun({ ...(next.tunables?.values || {}) });
      setState({ busy: false, msg: '已儲存——立即生效，無需重啟', err: '' });
    } catch (e) {
      setState({ busy: false, msg: '', err: e.message });
    }
  };

  const resetDefaults = async () => {
    setState({ busy: true, msg: '', err: '' });
    try {
      const patch = Object.fromEntries(Object.keys(defaults).map((id) => [id, null]));
      const next = await api.put('/settings', { tunables: patch });
      onSaved(next);
      setTun({ ...(next.tunables?.values || {}) });
      setState({ busy: false, msg: '已恢復啟動預設（環境變數或內建值）', err: '' });
    } catch (e) {
      setState({ busy: false, msg: '', err: e.message });
    }
  };

  // One consistent form language: a section card (title + optional description),
  // toggle rows (checkbox · bold title · muted hint, all left-aligned), and a
  // responsive field grid (label above control, hint below).
  const Toggle = ({ checked, onChange, disabled, title, hint }) => (
    <label className={`setting-toggle${disabled ? ' is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <span>
        <span className="t-title">{title}</span>
        <span className="t-hint">{hint}</span>
      </span>
    </label>
  );
  const Field = ({ label, hint, children }) => (
    <div className="setting-field">
      <span className="f-label">{label}</span>
      {children}
      {hint && <span className="f-hint">{hint}</span>}
    </div>
  );

  return (
    <Modal title="⚙️ 系統設定" onClose={onClose} wide>
      <section className="settings-section">
        <h4>👔 會議主持（主管代理）</h4>
        <p className="settings-desc">
          主管代理是內建的 AI 主持人：每輪安排發言順序、對發言者追問、會後統整報告。
          戰略永遠在你手上（插話／續會／作結），這裡調的是它的議事風格。
        </p>
        <Toggle
          checked={cfg.dynamicOrder}
          onChange={(e) => setCfg({ ...cfg, dynamicOrder: e.target.checked })}
          title="動態點名"
          hint="依討論內容安排每輪發言順序；關閉＝固定輪流，且完全不呼叫主持人模型"
        />
        <Toggle
          checked={cfg.followUps}
          onChange={(e) => setCfg({ ...cfg, followUps: e.target.checked })}
          disabled={!cfg.dynamicOrder}
          title="追問"
          hint="允許主持人對發言者附上尖銳但建設性的追問"
        />
        <div className="setting-grid">
          <Field label="主持風格">
            <select
              value={cfg.style}
              onChange={(e) => setCfg({ ...cfg, style: e.target.value })}
              disabled={!cfg.dynamicOrder || !cfg.followUps}
            >
              <option value="gentle">溫和——開放式引導，不施壓</option>
              <option value="standard">標準——尖銳但建設性</option>
              <option value="strict">嚴厲——逼出數字、期限與承諾</option>
            </select>
          </Field>
          <Field label="主持人模型" hint="僅影響點名與追問的呼叫；留空＝跟隨目前大腦">
            <input
              placeholder="例如 gemma-4-31b-it"
              value={cfg.model}
              onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
              disabled={!cfg.dynamicOrder}
            />
          </Field>
        </div>
      </section>

      <section className="settings-section">
        <h4>🧠 記憶</h4>
        <Toggle
          checked={Boolean(tun.memoryDistill)}
          onChange={(e) => setTun({ ...tun, memoryDistill: e.target.checked })}
          title="會後記憶沉澱"
          hint="每場會議作結後，為每位與會者寫下他該記住的結論"
        />
        <Toggle
          checked={Boolean(tun.memoryConsolidate)}
          onChange={(e) => setTun({ ...tun, memoryConsolidate: e.target.checked })}
          title="記憶自動整併"
          hint="累積達門檻時，把舊記憶合併成一則精簡版（原始記憶封存、可還原）"
        />
        <div className="setting-grid">
          <Field label="整併門檻" hint="累積幾則記憶後自動整併（2–200）">
            <input
              type="number" min={2} max={200}
              value={tun.consolidateThreshold ?? ''}
              onChange={num('consolidateThreshold')}
              disabled={!tun.memoryConsolidate}
            />
          </Field>
        </div>
      </section>

      <section className="settings-section">
        <h4>✍️ 輸出長度上限（tokens）</h4>
        <p className="settings-desc">這是防護欄不是目標——模型寫完就停，調高只在真的寫更多時才多花 token。</p>
        <div className="setting-grid">
          <Field label="會議／目標回合" hint="256–32768">
            <input type="number" min={256} max={32768} value={tun.turnTokens ?? ''} onChange={num('turnTokens')} />
          </Field>
          <Field label="文件級產出" hint="報告、研究、1on1（1024–65536）">
            <input type="number" min={1024} max={65536} value={tun.documentTokens ?? ''} onChange={num('documentTokens')} />
          </Field>
          <Field label="整理／蒸餾" hint="記憶、1on1 紀錄（512–32768）">
            <input type="number" min={512} max={32768} value={tun.summaryTokens ?? ''} onChange={num('summaryTokens')} />
          </Field>
        </div>
      </section>

      <section className="settings-section">
        <h4>🛠 代理工具</h4>
        <div className="setting-grid">
          <Field label="每回合工具上限" hint="會議／1on1 每回合可查詢次數（1–10）">
            <input type="number" min={1} max={10} value={tun.maxToolCalls ?? ''} onChange={num('maxToolCalls')} />
          </Field>
          <Field label="自主研究工具上限" hint="每次研究任務的查詢預算（2–20）">
            <input type="number" min={2} max={20} value={tun.researchMaxCalls ?? ''} onChange={num('researchMaxCalls')} />
          </Field>
          <Field label="網路搜尋深度" hint="深度＝每來源多段摘錄，2 credits／次">
            <select value={tun.webSearchDepth || 'advanced'} onChange={(e) => setTun({ ...tun, webSearchDepth: e.target.value })}>
              <option value="advanced">深度（2 credits／次）</option>
              <option value="basic">基本（1 credit／次）</option>
            </select>
          </Field>
        </div>
      </section>

      <div className="settings-footer">
        {state.err && <span className="banner-err sm">{state.err}</span>}
        {state.msg && <span className="banner-ok sm">{state.msg}</span>}
        <button className="btn-ghost sm" onClick={resetDefaults} disabled={state.busy} title="清除所有覆寫，回到啟動時的環境變數／內建值">
          恢復預設
        </button>
        <button className="btn sm" onClick={save} disabled={state.busy}>
          {state.busy ? '儲存中…' : '儲存'}
        </button>
      </div>
    </Modal>
  );
}

// 🔑 In-app API-key settings (Gemini brain + Tavily web search). Keys are saved
// to the LOCAL SQLite settings store on the server — the GET side only ever
// returns a masked tail, so a saved key never round-trips to the browser.
function KeyRow({ label, hint, provider, status, onSaved }) {
  const [value, setValue] = useState('');
  const [test, setTest] = useState({ busy: false, ok: null, msg: '' });
  const [saving, setSaving] = useState(false);

  const sourceLabel = status?.source === 'ui' ? 'UI 設定' : status?.source === 'env' ? '環境變數' : null;

  const runTest = async () => {
    setTest({ busy: true, ok: null, msg: '' });
    try {
      // Test the typed key; with the field empty this tests the stored one.
      const res = await api.post('/settings/api-keys/test', { provider, key: value || undefined });
      setTest({ busy: false, ok: res.ok, msg: res.ok ? `連線成功${res.model ? `（${res.model}）` : ''}` : res.error });
    } catch (e) {
      setTest({ busy: false, ok: false, msg: e.message });
    }
  };

  const save = async (clear = false) => {
    setSaving(true);
    try {
      const next = await api.put('/settings/api-keys', { [provider]: clear ? '' : value });
      setValue('');
      setTest({ busy: false, ok: null, msg: clear ? '已清除（改用環境變數,若有）' : '已儲存' });
      onSaved(next);
    } catch (e) {
      setTest({ busy: false, ok: false, msg: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="upload-box">
      <strong>{label}</strong>
      <p className="muted sm">
        {hint} · 目前:{status?.configured ? `已設定 ${status.tail}（${sourceLabel}）` : '未設定'}
      </p>
      <div className="upload-row">
        <input
          type="password"
          placeholder={status?.configured ? '輸入新金鑰以更換…' : '貼上 API 金鑰…'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          style={{ flex: 1 }}
        />
        <button className="btn-ghost sm" onClick={runTest} disabled={test.busy || (!value && !status?.configured)}>
          {test.busy ? '測試中…' : '測試連線'}
        </button>
        <button className="btn sm" onClick={() => save(false)} disabled={saving || !value.trim()}>
          儲存
        </button>
        {status?.source === 'ui' && (
          <button className="btn-ghost sm" onClick={() => save(true)} disabled={saving} title="清除 UI 儲存的金鑰">
            清除
          </button>
        )}
      </div>
      {test.msg && (
        <div className={test.ok === false ? 'banner-err sm' : 'banner-ok sm'}>{test.msg}</div>
      )}
    </div>
  );
}

function ApiKeysModal({ status, onClose, onSaved }) {
  return (
    <Modal title="🔑 API 金鑰設定" onClose={onClose}>
      <p className="muted sm">
        金鑰只儲存在你本機的資料庫（不進版本控制、不回傳前端）；清除後會改用伺服器環境變數（若有設定）。
      </p>
      <KeyRow
        label="🧠 Google Gemini API 金鑰"
        hint="驅動 AI 員工的即時推理（gemma-4）。可於 aistudio.google.com/apikey 免費取得"
        provider="gemini"
        status={status?.gemini}
        onSaved={onSaved}
      />
      <KeyRow
        label="🌐 網路搜尋金鑰（Tavily）"
        hint="讓員工能上網查證與自主研究。可於 tavily.com 免費取得"
        provider="tavily"
        status={status?.tavily}
        onSaved={onSaved}
      />
    </Modal>
  );
}

function DashboardStrip({ dashboard }) {
  const cards = [
    { label: '員工', value: dashboard.counts.employees },
    { label: '知識文件', value: dashboard.counts.documents, sub: `${dashboard.counts.chunks} 個片段` },
    { label: '會議', value: dashboard.counts.meetings, sub: `即時占比 ${Math.round((dashboard.runs.liveMeetings / Math.max(dashboard.counts.meetings, 1)) * 100)}%` },
    { label: '目標', value: dashboard.counts.goals, sub: `即時占比 ${Math.round((dashboard.runs.liveGoals / Math.max(dashboard.counts.goals, 1)) * 100)}%` },
  ];

  return (
    <section className="dashboard-strip">
      <div className="dashboard-grid">
        {cards.map((card) => (
          <div key={card.label} className="dashboard-card">
            <span className="dashboard-label">{card.label}</span>
            <strong>{card.value}</strong>
            {card.sub && <span className="dashboard-sub">{card.sub}</span>}
          </div>
        ))}
      </div>
      <div className="dashboard-meta muted">
        整體即時回合比率 {Math.round((dashboard.runs.liveTurnRatio || 0) * 100)}% · 平均每份文件 {dashboard.knowledge.avgChunksPerDocument} 個片段
      </div>
    </section>
  );
}
