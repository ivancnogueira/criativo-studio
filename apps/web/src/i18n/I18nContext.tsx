import React, { createContext, useContext, useEffect, useMemo } from "react";
import {
  createTranslator,
  normalizeLocale,
  type I18nMessageKey,
  type SupportedLocale,
} from "@criativo/i18n";

export interface I18nContextValue {
  locale: SupportedLocale;
  t: (key: I18nMessageKey, vars?: Record<string, string | number>) => string;
}

const defaultTranslate = createTranslator("pt-BR");

const I18nContext = createContext<I18nContextValue>({
  locale: "pt-BR",
  t: defaultTranslate,
});

export interface I18nProviderProps {
  locale?: string | null;
  children: React.ReactNode;
}

export const I18nProvider: React.FC<I18nProviderProps> = ({ locale, children }) => {
  const normalized = normalizeLocale(locale);

  useEffect(() => {
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.lang = normalized;
    }
  }, [normalized]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale: normalized,
      t: createTranslator(normalized),
    }),
    [normalized],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
