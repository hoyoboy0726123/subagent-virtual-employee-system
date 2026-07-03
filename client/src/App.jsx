import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import EmployeesPage from './pages/EmployeesPage.jsx';
import MeetingsPage from './pages/MeetingsPage.jsx';
import GoalsPage from './pages/GoalsPage.jsx';

const TABS = [
  { key: 'employees', label: '👥 Employees' },
  { key: 'meetings', label: '🗓️ Meetings' },
  { key: 'goals', label: '🎯 Goals' },
];

export default function App() {
  const [tab, setTab] = useState('employees');
  const [health, setHealth] = useState(null);
  // Bump this to force child pages to refetch after cross-cutting changes.
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    api.get('/health').then(setHealth).catch(() => setHealth({ ok: false }));
  }, [refreshKey]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">🧑‍💼</span>
          <div>
            <h1>Virtual Employee System</h1>
            <p className="subtitle">You are the manager. Build your team of AI employees.</p>
          </div>
        </div>
        <div className="status">
          {health && (
            <span className={`pill ${health.llm ? 'pill-live' : 'pill-sim'}`}>
              {health.llm ? 'LLM: live' : 'LLM: simulated'}
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
        Local MVP · data persists to <code>server/data/db.json</code> · runs fully offline
      </footer>
    </div>
  );
}
