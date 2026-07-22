import React, { createContext, useContext, useLayoutEffect, useMemo, useState } from "react";
import {
  AVAILABLE_LANGUAGES,
  persistInterfaceLanguage,
  resolveBrowserLanguage,
  setActiveLanguage,
  translate,
} from "./core.js";

export const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(() => setActiveLanguage(resolveBrowserLanguage()));

  useLayoutEffect(() => {
    setActiveLanguage(language);
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo(() => ({
    language,
    languages: AVAILABLE_LANGUAGES,
    t: (key, params) => translate(language, key, params),
    setLanguage(nextLanguage) {
      if (nextLanguage === language) return;
      setLanguageState(persistInterfaceLanguage(window.localStorage, nextLanguage));
    },
  }), [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}

