import { I18N_CATALOGS, SUPPORTED_LOCALES } from "../packages/i18n/src/index.ts";

function extractPlaceholders(text) {
  const matches = String(text).match(/\{[a-zA-Z0-9_]+\}/g) ?? [];
  return [...new Set(matches)].sort();
}

const baseLocale = "pt-BR";
const baseCatalog = I18N_CATALOGS[baseLocale];
const baseKeys = Object.keys(baseCatalog).sort();
let failures = 0;

for (const locale of SUPPORTED_LOCALES) {
  if (locale === baseLocale) continue;
  const catalog = I18N_CATALOGS[locale];
  const keys = Object.keys(catalog).sort();

  const missing = baseKeys.filter((k) => !(k in catalog));
  const extra = keys.filter((k) => !(k in baseCatalog));

  if (missing.length > 0) {
    console.error(`[check:i18n] Chaves ausentes em '${locale}': ${missing.join(", ")}`);
    failures += missing.length;
  }
  if (extra.length > 0) {
    console.error(`[check:i18n] Chaves extras em '${locale}': ${extra.join(", ")}`);
    failures += extra.length;
  }

  for (const key of baseKeys) {
    if (!(key in catalog)) continue;
    const val = String(catalog[key] ?? "").trim();
    if (!val) {
      console.error(`[check:i18n] Tradução vazia em '${locale}' para chave '${key}'.`);
      failures += 1;
      continue;
    }
    const basePh = extractPlaceholders(baseCatalog[key]);
    const locPh = extractPlaceholders(val);
    if (basePh.join("|") !== locPh.join("|")) {
      console.error(
        `[check:i18n] Placeholders divergentes em '${locale}' para '${key}': esperado [${basePh.join(", ")}], obtido [${locPh.join(", ")}]`
      );
      failures += 1;
    }
  }
}

if (failures > 0) {
  console.error(`[check:i18n] FALHOU com ${failures} inconsistência(s).`);
  process.exit(1);
}

console.log(
  `check:i18n — OK (${baseKeys.length} chaves validadas com 100% de paridade em ${SUPPORTED_LOCALES.join(", ")}).`
);
