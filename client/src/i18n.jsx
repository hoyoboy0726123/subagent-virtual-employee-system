// Lightweight i18n layer (Phase 2-2). No dependency — a dictionary per locale,
// a context provider, and a `t(key, vars)` lookup with {var} interpolation.
// zh-TW is the source of truth (and the fallback for missing keys), so a
// half-translated locale degrades gracefully instead of showing raw keys.
import React, { createContext, useContext, useMemo, useState } from 'react';
import zhTW from './locales/zh-TW.js';
import en from './locales/en.js';

export const LOCALES = {
  'zh-TW': { dict: zhTW, label: '繁體中文' },
  en: { dict: en, label: 'English' },
};

const STORAGE_KEY = 'veemp-locale';
const lookup = (dict, key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict);

const I18nCtx = createContext(null);

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return LOCALES[saved] ? saved : 'zh-TW';
  });
  const value = useMemo(() => {
    const dict = LOCALES[locale]?.dict || zhTW;
    const t = (key, vars) => {
      const raw = lookup(dict, key) ?? lookup(zhTW, key) ?? key;
      return vars ? String(raw).replace(/\{(\w+)\}/g, (_, v) => (vars[v] ?? '')) : raw;
    };
    const setLocale = (l) => {
      if (!LOCALES[l]) return;
      localStorage.setItem(STORAGE_KEY, l);
      setLocaleState(l);
    };
    return { locale, t, setLocale };
  }, [locale]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

/** Hook for components: const { t, locale, setLocale } = useI18n(); */
export function useI18n() {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/**
 * Non-reactive lookup for plain modules (e.g. api.js error strings) that run
 * outside the React tree. Reads the saved locale directly; UI re-render on
 * locale change doesn't apply here (these are one-shot messages).
 */
export function tStatic(key, vars) {
  const saved = localStorage.getItem(STORAGE_KEY);
  const dict = LOCALES[saved]?.dict || zhTW;
  const raw = lookup(dict, key) ?? lookup(zhTW, key) ?? key;
  return vars ? String(raw).replace(/\{(\w+)\}/g, (_, v) => (vars[v] ?? '')) : raw;
}
