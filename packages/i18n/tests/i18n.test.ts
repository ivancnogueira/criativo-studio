import assert from "node:assert/strict";
import test from "node:test";
import {
  createTranslator,
  defineMessages,
  formatMessage,
  I18N_CATALOGS,
  normalizeLocale,
  SUPPORTED_LOCALES,
} from "../src/index.ts";

test("@criativo/i18n: interpolação, fallback seguro para pt-BR e paridade entre pt-BR, en e es", () => {
  assert.deepEqual(SUPPORTED_LOCALES, ["pt-BR", "en", "es"]);
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("es-AR"), "es");
  assert.equal(normalizeLocale("desconhecido"), "pt-BR");

  const tPt = createTranslator("pt-BR");
  const tEn = createTranslator("en");
  const tEs = createTranslator("es");

  assert.equal(tPt("nav.studio"), "Estúdio");
  assert.equal(tEn("nav.studio"), "Studio");
  assert.equal(tEs("nav.studio"), "Estudio");

  assert.equal(tEn("updates.available", { version: "2.4.0" }), "New version v2.4.0");
  assert.equal(formatMessage("Olá {nome}", { nome: "Equipe" }), "Olá Equipe");

  const custom = defineMessages({ greet: "Olá {x}" });
  assert.equal(custom.greet, "Olá {x}");

  const baseKeys = Object.keys(I18N_CATALOGS["pt-BR"]).sort();
  for (const loc of ["en", "es"] as const) {
    assert.deepEqual(Object.keys(I18N_CATALOGS[loc]).sort(), baseKeys);
  }
});
