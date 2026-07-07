import React, { useEffect, useState } from 'react';
import { api } from './api.js';
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
  // Bump this to force child pages to refetch after cross-cutting changes.
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

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
                : '需要在伺服器環境設定 TAVILY_API_KEY 才能開啟網路搜尋'}
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
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === 'employees' && <EmployeesPage refreshKey={refreshKey} onChange={refresh} />}
        {tab === 'meetings' && <MeetingsPage refreshKey={refreshKey} onChange={refresh} />}
        {tab === 'goals' && <GoalsPage refreshKey={refreshKey} onChange={refresh} />}
      </main>

      <footer className="footer">
        獨立運作 · 內建多代理編排 · SQLite 儲存 · 無需外部服務{settings?.runtimeLabel ? ` · ${settings.runtimeLabel}` : ''}
      </footer>
    </div>
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
