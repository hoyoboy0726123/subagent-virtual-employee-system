import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { Modal } from './components/ui.jsx';
import EmployeesPage from './pages/EmployeesPage.jsx';
import MeetingsPage from './pages/MeetingsPage.jsx';
import GoalsPage from './pages/GoalsPage.jsx';
import { useI18n, LOCALES } from './i18n.jsx';

// Packaged (windowless) exe only: quit the app from the browser, since there's
// no console window to close. After the server exits, show a done screen.
function QuitButton() {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const quit = async () => {
    if (!window.confirm(t('app.quitConfirm'))) return;
    try { await api.post('/shutdown', {}); } catch { /* server exits mid-response */ }
    setDone(true);
  };
  if (done) {
    return (
      <div className="quit-overlay">
        <div className="quit-card">
          <div className="quit-emoji">👋</div>
          <h2>{t('app.quitDoneTitle')}</h2>
          <p className="muted">{t('app.quitDoneLine1')}<br />{t('app.quitDoneLine2')}</p>
        </div>
      </div>
    );
  }
  return (
    <button className="icon-btn" onClick={quit} title={t('app.quitTitle')} aria-label={t('app.quitAria')}>⏻</button>
  );
}

export default function App() {
  const { t, locale, setLocale } = useI18n();
  const TABS = [
    { key: 'employees', label: t('app.tabEmployees') },
    { key: 'meetings', label: t('app.tabMeetings') },
    { key: 'goals', label: t('app.tabGoals') },
  ];
  const LOCALE_KEYS = Object.keys(LOCALES);
  const cycleLocale = () => {
    const idx = LOCALE_KEYS.indexOf(locale);
    setLocale(LOCALE_KEYS[(idx + 1) % LOCALE_KEYS.length]);
  };
  const [tab, setTab] = useState('employees');
  const [gotoMeeting, setGotoMeeting] = useState(null); // close-the-loop: jump into a meeting room
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
            <h1>{t('app.brandTitle')}</h1>
            <p className="subtitle">{t('app.brandSubtitle')}</p>
          </div>
        </div>
        <div className="topbar-status">
          {settings && (
            <label
              className="runtime-switch web-toggle"
              title={settings.webSearch?.keyConfigured
                ? t('app.webSearchOnHint')
                : t('app.webSearchOffHint')}
            >
              <input
                type="checkbox"
                checked={Boolean(settings.webSearch?.enabled)}
                onChange={toggleWebSearch}
              />
              <span className="runtime-label">
                {t('app.webSearchLabel')}{settings.webSearch?.keyConfigured ? '' : t('app.webSearchNoKey')}
              </span>
            </label>
          )}
          <button
            className="icon-btn"
            onClick={() => setShowKeys(true)}
            title={t('app.apiKeysTitle')}
            aria-label={t('app.apiKeysAria')}
          >
            🔑
          </button>
          <button
            className="icon-btn"
            onClick={() => setShowSettings(true)}
            title={t('app.settingsTitle')}
            aria-label={t('app.settingsAria')}
          >
            ⚙️
          </button>
          {settings?.llm && (
            <label
              className="runtime-switch brain-switch"
              title={settings.llm.providers?.find((p) => p.id === settings.llm.provider)?.detail || t('app.brainSwitchDefaultTitle')}
            >
              <span className="runtime-label">{t('app.brainLabel')}</span>
              <select value={settings.llm.provider} onChange={(e) => switchBrain(e.target.value)}>
                {(settings.llm.providers || []).map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.selectable} title={p.detail}>
                    {p.label}{p.available ? '' : `（${p.id === 'google' ? t('app.brainOffline') : (p.detail.includes('未登入') ? t('app.brainNotLoggedIn') : t('app.brainNotInstalled'))}）`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {settings?.llm && (
            <span
              className={`pill ${settings.llm.live ? 'pill-live' : 'pill-sim'}`}
              title={settings.llm.live
                ? t('app.liveTitle', { label: settings.llm.active?.label })
                : t('app.simTitle')}
            >
              {settings.llm.live ? t('app.livePill', { model: settings.llm.active?.model }) : t('app.simPill')}
            </span>
          )}
          <button
            className="icon-btn theme-toggle"
            onClick={() => setTheme((th) => (th === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? t('app.themeToLight') : t('app.themeToDark')}
            aria-label={t('app.themeAria')}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button
            className="icon-btn lang-toggle"
            onClick={cycleLocale}
            title={t('app.langToggleTitle')}
            aria-label={t('app.langToggleTitle')}
          >
            🌐
          </button>
          {health?.packaged && <QuitButton />}
        </div>
      </header>

      {dashboard && <DashboardStrip dashboard={dashboard} />}

      <nav className="tabs">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            className={tab === tb.key ? 'tab tab-active' : 'tab'}
            onClick={() => setTab(tb.key)}
          >
            {tb.label}
            {activity[tb.key] && <span className="tab-dot" title={t('app.tabActivityTitle')}>🟢</span>}
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
          <MeetingsPage
            refreshKey={refreshKey}
            onChange={refresh}
            onActivity={reportActivity('meetings')}
            gotoMeetingId={gotoMeeting}
            onGotoHandled={() => setGotoMeeting(null)}
          />
        </div>
        <div className={tab === 'goals' ? '' : 'tab-hidden'}>
          <GoalsPage
            refreshKey={refreshKey}
            onChange={refresh}
            onActivity={reportActivity('goals')}
            onGotoMeeting={(id) => { setGotoMeeting(id); setTab('meetings'); }}
          />
        </div>
      </main>

      <footer className="footer">
        {t('app.footer')}{settings?.runtimeLabel ? ` · ${settings.runtimeLabel}` : ''}
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
  const { t } = useI18n();
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
      setState({ busy: false, msg: t('app.savedMsg'), err: '' });
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
      setState({ busy: false, msg: t('app.resetMsg'), err: '' });
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
    <Modal title={t('app.settingsModalTitle')} onClose={onClose} wide>
      <section className="settings-section">
        <h4>{t('app.chairSectionTitle')}</h4>
        <p className="settings-desc">
          {t('app.chairSectionDesc')}
        </p>
        <Toggle
          checked={cfg.dynamicOrder}
          onChange={(e) => setCfg({ ...cfg, dynamicOrder: e.target.checked })}
          title={t('app.dynamicOrderTitle')}
          hint={t('app.dynamicOrderHint')}
        />
        <Toggle
          checked={cfg.followUps}
          onChange={(e) => setCfg({ ...cfg, followUps: e.target.checked })}
          disabled={!cfg.dynamicOrder}
          title={t('app.followUpsTitle')}
          hint={t('app.followUpsHint')}
        />
        <div className="setting-grid">
          <Field label={t('app.styleLabel')}>
            <select
              value={cfg.style}
              onChange={(e) => setCfg({ ...cfg, style: e.target.value })}
              disabled={!cfg.dynamicOrder || !cfg.followUps}
            >
              <option value="gentle">{t('app.styleGentle')}</option>
              <option value="standard">{t('app.styleStandard')}</option>
              <option value="strict">{t('app.styleStrict')}</option>
            </select>
          </Field>
          <Field label={t('app.chairModelLabel')} hint={t('app.chairModelHint')}>
            <input
              placeholder={t('app.chairModelPlaceholder')}
              value={cfg.model}
              onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
              disabled={!cfg.dynamicOrder}
            />
          </Field>
        </div>
      </section>

      <section className="settings-section">
        <h4>{t('app.memorySectionTitle')}</h4>
        <Toggle
          checked={Boolean(tun.memoryDistill)}
          onChange={(e) => setTun({ ...tun, memoryDistill: e.target.checked })}
          title={t('app.memoryDistillTitle')}
          hint={t('app.memoryDistillHint')}
        />
        <Toggle
          checked={Boolean(tun.memoryConsolidate)}
          onChange={(e) => setTun({ ...tun, memoryConsolidate: e.target.checked })}
          title={t('app.memoryConsolidateTitle')}
          hint={t('app.memoryConsolidateHint')}
        />
        <div className="setting-grid">
          <Field label={t('app.consolidateThresholdLabel')} hint={t('app.consolidateThresholdHint')}>
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
        <h4>{t('app.outputSectionTitle')}</h4>
        <p className="settings-desc">{t('app.outputSectionDesc')}</p>
        <div className="setting-grid">
          <Field label={t('app.turnTokensLabel')} hint={t('app.turnTokensHint')}>
            <input type="number" min={256} max={32768} value={tun.turnTokens ?? ''} onChange={num('turnTokens')} />
          </Field>
          <Field label={t('app.documentTokensLabel')} hint={t('app.documentTokensHint')}>
            <input type="number" min={1024} max={65536} value={tun.documentTokens ?? ''} onChange={num('documentTokens')} />
          </Field>
          <Field label={t('app.summaryTokensLabel')} hint={t('app.summaryTokensHint')}>
            <input type="number" min={512} max={32768} value={tun.summaryTokens ?? ''} onChange={num('summaryTokens')} />
          </Field>
        </div>
      </section>

      <section className="settings-section">
        <h4>{t('app.toolsSectionTitle')}</h4>
        <div className="setting-grid">
          <Field label={t('app.maxToolCallsLabel')} hint={t('app.maxToolCallsHint')}>
            <input type="number" min={1} max={10} value={tun.maxToolCalls ?? ''} onChange={num('maxToolCalls')} />
          </Field>
          <Field label={t('app.researchMaxCallsLabel')} hint={t('app.researchMaxCallsHint')}>
            <input type="number" min={2} max={20} value={tun.researchMaxCalls ?? ''} onChange={num('researchMaxCalls')} />
          </Field>
          <Field label={t('app.webSearchDepthLabel')} hint={t('app.webSearchDepthHint')}>
            <select value={tun.webSearchDepth || 'advanced'} onChange={(e) => setTun({ ...tun, webSearchDepth: e.target.value })}>
              <option value="advanced">{t('app.webSearchDepthAdvanced')}</option>
              <option value="basic">{t('app.webSearchDepthBasic')}</option>
            </select>
          </Field>
        </div>
      </section>

      <div className="settings-footer">
        {state.err && <span className="banner-err sm">{state.err}</span>}
        {state.msg && <span className="banner-ok sm">{state.msg}</span>}
        <button className="btn-ghost sm" onClick={resetDefaults} disabled={state.busy} title={t('app.resetDefaultsTitle')}>
          {t('app.resetDefaultsBtn')}
        </button>
        <button className="btn sm" onClick={save} disabled={state.busy}>
          {state.busy ? t('app.savingBtn') : t('app.saveBtn')}
        </button>
      </div>
    </Modal>
  );
}

// 🔑 In-app API-key settings (Gemini brain + Tavily web search). Keys are saved
// to the LOCAL SQLite settings store on the server — the GET side only ever
// returns a masked tail, so a saved key never round-trips to the browser.
function KeyRow({ label, hint, provider, status, onSaved }) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [test, setTest] = useState({ busy: false, ok: null, msg: '' });
  const [saving, setSaving] = useState(false);

  const sourceLabel = status?.source === 'ui' ? t('app.keySourceUi') : status?.source === 'env' ? t('app.keySourceEnv') : null;

  const runTest = async () => {
    setTest({ busy: true, ok: null, msg: '' });
    try {
      // Test the typed key; with the field empty this tests the stored one.
      const res = await api.post('/settings/api-keys/test', { provider, key: value || undefined });
      setTest({ busy: false, ok: res.ok, msg: res.ok ? t('app.testSuccess', { model: res.model ? `（${res.model}）` : '' }) : res.error });
    } catch (e) {
      setTest({ busy: false, ok: false, msg: e.message });
    }
  };

  const save = async (clear = false) => {
    setSaving(true);
    try {
      const next = await api.put('/settings/api-keys', { [provider]: clear ? '' : value });
      setValue('');
      setTest({ busy: false, ok: null, msg: clear ? t('app.clearedMsg') : t('app.savedShort') });
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
        {hint} · {t('app.keyRowStatus')}{status?.configured ? t('app.keyConfigured', { tail: status.tail, source: sourceLabel }) : t('app.keyNotConfigured')}
      </p>
      <div className="upload-row">
        <input
          type="password"
          placeholder={status?.configured ? t('app.keyPlaceholderReplace') : t('app.keyPlaceholderPaste')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          style={{ flex: 1 }}
        />
        <button className="btn-ghost sm" onClick={runTest} disabled={test.busy || (!value && !status?.configured)}>
          {test.busy ? t('app.testingBtn') : t('app.testBtn')}
        </button>
        <button className="btn sm" onClick={() => save(false)} disabled={saving || !value.trim()}>
          {t('app.saveBtn')}
        </button>
        {status?.source === 'ui' && (
          <button className="btn-ghost sm" onClick={() => save(true)} disabled={saving} title={t('app.clearBtnTitle')}>
            {t('app.clearBtn')}
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
  const { t } = useI18n();
  return (
    <Modal title={t('app.apiKeysModalTitle')} onClose={onClose}>
      <p className="muted sm">
        {t('app.apiKeysDesc')}
      </p>
      <KeyRow
        label={t('app.geminiLabel')}
        hint={t('app.geminiHint')}
        provider="gemini"
        status={status?.gemini}
        onSaved={onSaved}
      />
      <KeyRow
        label={t('app.tavilyLabel')}
        hint={t('app.tavilyHint')}
        provider="tavily"
        status={status?.tavily}
        onSaved={onSaved}
      />
    </Modal>
  );
}

function DashboardStrip({ dashboard }) {
  const { t } = useI18n();
  const cards = [
    { label: t('app.dashboardEmployees'), value: dashboard.counts.employees },
    { label: t('app.dashboardDocuments'), value: dashboard.counts.documents, sub: t('app.dashboardChunksSub', { n: dashboard.counts.chunks }) },
    { label: t('app.dashboardMeetings'), value: dashboard.counts.meetings, sub: t('app.dashboardLiveRatioSub', { pct: Math.round((dashboard.runs.liveMeetings / Math.max(dashboard.counts.meetings, 1)) * 100) }) },
    { label: t('app.dashboardGoals'), value: dashboard.counts.goals, sub: t('app.dashboardLiveRatioSub', { pct: Math.round((dashboard.runs.liveGoals / Math.max(dashboard.counts.goals, 1)) * 100) }) },
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
        {t('app.dashboardMetaLine', { pct: Math.round((dashboard.runs.liveTurnRatio || 0) * 100), chunks: dashboard.knowledge.avgChunksPerDocument })}
      </div>
    </section>
  );
}
