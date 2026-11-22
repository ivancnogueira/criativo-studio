import { ptBRMessages, type I18nCatalog, type I18nMessageKey } from "./locales/pt-BR.ts";
import { enMessages } from "./locales/en.ts";
import { esMessages } from "./locales/es.ts";

export type SupportedLocale = "pt-BR" | "en" | "es";

export type { I18nCatalog, I18nMessageKey };

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ["pt-BR", "en", "es"];

export const I18N_CATALOGS: Record<SupportedLocale, I18nCatalog> = {
  "pt-BR": ptBRMessages,
  en: enMessages,
  es: esMessages,
};

export function normalizeLocale(raw: string | null | undefined): SupportedLocale {
  if (raw === "en" || raw === "es" || raw === "pt-BR") return raw;
  const lower = String(raw ?? "").toLowerCase();
  if (lower.startsWith("en")) return "en";
  if (lower.startsWith("es")) return "es";
  return "pt-BR";
}

export function defineMessages<T extends Record<string, string>>(messages: T): T {
  return messages;
}

export function formatMessage(
  template: string,
  params?: Record<string, string | number | boolean | null | undefined>
): string {
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    const val = params[key];
    return val === undefined || val === null ? "" : String(val);
  });
}

export function createTranslator(locale: SupportedLocale) {
  const normalized = normalizeLocale(locale);
  const activeCatalog = I18N_CATALOGS[normalized];

  return function t(
    key: I18nMessageKey,
    params?: Record<string, string | number | boolean | null | undefined>
  ): string {
    const template = activeCatalog[key] ?? ptBRMessages[key] ?? String(key);
    return formatMessage(template, params);
  };
}
