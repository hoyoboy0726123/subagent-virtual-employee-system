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

const RUNTIME_LABELS = {
  standalone: '內建多代理',
  openclaw: 'OpenClaw（外部整合）',
};

export default function App() {
  const [tab, setTab] = useState('employees');
  const [health, setHealth] = useState(null);
  const [settings, setSettings] = useState(null);
  // Bump this to force child pages to refetch after cross-cutting changes.
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    api.get('/health').then(setHealth).catch(() => setHealth({ ok: false }));
    api.get('/settings').then(setSettings).catch(() => setSettings(null));
  }, [refreshKey]);

  const switchRuntime = async (mode) => {
    const next = await api.put('/settings', { runtimeMode: mode });
    setSettings((s) => ({ ...s, ...next }));
    refresh();
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
            <label className="runtime-switch" title="由哪個執行環境驅動你的子代理">
              <span className="runtime-label">執行環境</span>
              <select value={settings.runtimeMode} onChange={(e) => switchRuntime(e.target.value)}>
                {(settings.availableModes || ['simulated']).map((m) => (
                  <option key={m} value={m}>{RUNTIME_LABELS[m] || m}</option>
                ))}
              </select>
            </label>
          )}
          {health && (
            <span
              className={`pill ${health.standalone?.live ? 'pill-live' : 'pill-sim'}`}
              title={health.standalone?.live
                ? `內建多代理以即時模型執行每個代理回合${health.standalone.model ? `（${health.standalone.model}）` : ''}`
                : '未設定 Google API 金鑰；內建多代理以離線推理引擎（persona + RAG）執行'}
            >
              {health.standalone?.live ? `內建多代理：即時（${health.standalone.model || 'Gemma'}）` : '內建多代理：離線推理'}
            </span>
          )}
          {health?.openclaw?.live && (
            <span
              className="pill pill-live"
              title={`可選的 OpenClaw 整合可用：Gateway ${health.openclaw.gateway}${health.openclaw.version ? ` · ${health.openclaw.version}` : ''}`}
            >
              OpenClaw：可用（可選）
            </span>
          )}
        </div>
      </header>

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
        獨立運作 · 內建多代理編排 · SQLite 儲存 · 無需外部服務 · 執行環境：{settings ? (RUNTIME_LABELS[settings.runtimeMode] || settings.runtimeMode) : '—'}
      </footer>
    </div>
  );
}
