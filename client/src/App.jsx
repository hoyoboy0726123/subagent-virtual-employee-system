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
          onClose={() => setShowSettings(false)}
          onSaved={(next) => setSettings((s) => ({ ...s, ...next }))}
        />
      )}
    </div>
  );
}

// ⚙️ System settings. First section: the meeting chair (主管代理) — the AI
// stand-in that orders each round, presses speakers with follow-ups, and
// synthesizes reports. Everything here is stored server-side (SQLite settings)
// and takes effect from the NEXT round — no restart needed.
function SettingsModal({ chair, onClose, onSaved }) {
  const [cfg, setCfg] = useState({
    dynamicOrder: chair?.dynamicOrder !== false,
    followUps: chair?.followUps !== false,
    style: chair?.style || 'standard',
    model: chair?.model || '',
  });
  const [state, setState] = useState({ busy: false, msg: '', err: '' });

  const save = async () => {
    setState({ busy: true, msg: '', err: '' });
    try {
      const next = await api.put('/settings', { chairConfig: cfg });
      onSaved(next);
      setState({ busy: false, msg: '已儲存——下一輪討論即刻生效', err: '' });
    } catch (e) {
      setState({ busy: false, msg: '', err: e.message });
    }
  };

  return (
    <Modal title="⚙️ 系統設定" onClose={onClose}>
      <div className="upload-box">
        <strong>👔 會議主持（主管代理）</strong>
        <p className="muted sm">
          主管代理是內建的 AI 主持人：每輪安排發言順序、對發言者追問、會後統整報告。
          戰略永遠在你手上（插話／續會／作結），這裡調的是它的議事風格。
        </p>

        <label className="runtime-switch" style={{ margin: '6px 0' }}>
          <input
            type="checkbox"
            checked={cfg.dynamicOrder}
            onChange={(e) => setCfg({ ...cfg, dynamicOrder: e.target.checked })}
          />
          <span>動態點名——依討論內容安排每輪發言順序（關閉＝固定輪流，不呼叫主持人模型）</span>
        </label>

        <label className="runtime-switch" style={{ margin: '6px 0' }}>
          <input
            type="checkbox"
            checked={cfg.followUps}
            onChange={(e) => setCfg({ ...cfg, followUps: e.target.checked })}
            disabled={!cfg.dynamicOrder}
          />
          <span>追問——允許主持人對發言者附上尖銳但建設性的追問</span>
        </label>

        <label className="block" style={{ margin: '8px 0' }}>
          主持風格
          <select
            value={cfg.style}
            onChange={(e) => setCfg({ ...cfg, style: e.target.value })}
            disabled={!cfg.dynamicOrder || !cfg.followUps}
          >
            <option value="gentle">溫和——開放式引導，不施壓</option>
            <option value="standard">標準——尖銳但建設性</option>
            <option value="strict">嚴厲——逼出數字、期限與承諾</option>
          </select>
        </label>

        <label className="block" style={{ margin: '8px 0' }}>
          主持人模型（僅影響點名與追問的呼叫；留空＝跟隨目前大腦）
          <input
            placeholder="例如 gemma-4-31b-it；留空使用預設"
            value={cfg.model}
            onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
            disabled={!cfg.dynamicOrder}
          />
        </label>

        <div className="row end">
          <button className="btn sm" onClick={save} disabled={state.busy}>
            {state.busy ? '儲存中…' : '儲存'}
          </button>
        </div>
        {state.err && <div className="banner-err sm">{state.err}</div>}
        {state.msg && <div className="banner-ok sm">{state.msg}</div>}
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
