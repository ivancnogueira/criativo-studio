import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  buildChangelogUrl,
  getReleaseNotesForVersion,
  RELEASE_NOTES_CATALOG,
} from "../src/server/release-notes-catalog.ts";
import { getWhatsNewInfo } from "../src/server/settings-prefs-service.ts";

describe("Catálogo de Notas de Versão e Link de Changelog", () => {
  it("gera âncoras corretas para criativoos.com.br/changelog", () => {
    assert.equal(buildChangelogUrl("1.0.9"), "https://criativoos.com.br/changelog#v1-0-9");
    assert.equal(buildChangelogUrl("v1.0.8"), "https://criativoos.com.br/changelog#v1-0-8");
    assert.equal(buildChangelogUrl(""), "https://criativoos.com.br/changelog");
  });

  it("prioriza a versão em execução no topo do catálogo e suporta versão futura", () => {
    const notes109 = getReleaseNotesForVersion("1.0.9");
    assert.equal(notes109[0]?.versao, "1.0.9");
    assert.ok((notes109[0]?.added.length ?? 0) > 0);
    assert.equal(notes109.length, RELEASE_NOTES_CATALOG.length);

    const notesFuture = getReleaseNotesForVersion("9.9.9");
    assert.equal(notesFuture[0]?.versao, "9.9.9");
    assert.equal(notesFuture.length, RELEASE_NOTES_CATALOG.length + 1);
  });

  it("getWhatsNewInfo retorna a versão real do produto.json da raiz", () => {
    const rootDir = resolve(process.cwd(), "..", "..");
    const produto = JSON.parse(readFileSync(join(rootDir, "produto.json"), "utf8")) as {
      versao: string;
    };
    const info = getWhatsNewInfo(rootDir, rootDir);
    assert.equal(info.versao_atual, produto.versao);
    assert.equal(info.notas[0]?.versao, produto.versao);
  });

  it("getWhatsNewInfo gera fallback limpo quando produto.json aponta para versão futura", () => {
    const tempDir = join(tmpdir(), `criativo-whatsnew-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    try {
      writeFileSync(join(tempDir, "produto.json"), JSON.stringify({ versao: "1.2.3" }), "utf8");
      const info = getWhatsNewInfo(tempDir, tempDir);
      assert.equal(info.versao_atual, "1.2.3");
      assert.equal(info.notas[0]?.versao, "1.2.3");
      assert.ok(info.notas[0]?.added[0]?.includes("1.2.3"));
    } finally {
      if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
