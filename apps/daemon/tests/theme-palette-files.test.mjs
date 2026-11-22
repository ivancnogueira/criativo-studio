import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ThemePaletteFilesService,
  ThemeValidationError,
  parseAndValidateExternalTheme,
} from "../src/themes/theme-palette-files.ts";

test("ThemePaletteFilesService valida schema JSON, rejeita CSS malicioso e recarrega ao vivo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "criativo-themes-"));
  const broadcastEvents = [];
  const fakeWsHub = {
    broadcast(event, data) {
      broadcastEvents.push({ event, data });
    },
  };

  const service = new ThemePaletteFilesService({
    themesDir: dir,
    wsHub: fakeWsHub,
    autoWatch: false,
  });

  try {
    // 1. Rejeita tokens fora da whitelist ou CSS injection
    assert.throws(
      () =>
        parseAndValidateExternalTheme({
          id: "evil-theme",
          name: "Evil",
          base: "dark",
          tokens: { "--studio-accent": "url(https://evil.example/a.png)" },
        }),
      ThemeValidationError,
    );
    assert.throws(
      () =>
        parseAndValidateExternalTheme({
          id: "bad-key",
          name: "Bad",
          base: "dark",
          tokens: { "--malicious-var": "#FFFFFF" },
        }),
      ThemeValidationError,
    );

    // 2. Importa tema JSON válido e grava no diretório de temas
    const imported = service.importThemeJson({
      id: "obsidian-neon",
      name: "Obsidian Neon",
      base: "dark",
      backdrop: "nebula",
      tokens: {
        "--studio-bg-canvas": "#101218",
        "--studio-bg-surface": "#181C24",
        "--studio-accent": "#38BDF8",
      },
    });
    assert.equal(imported.id, "obsidian-neon");
    assert.equal(imported.backdrop, "nebula");
    assert.equal(service.listThemes().length, 1);
    assert.equal(broadcastEvents[0]?.event, "theme:reloaded");

    // 3. Hot-reload detecta atualização em disco no diretório
    writeFileSync(
      join(dir, "amber-studio.json"),
      JSON.stringify({
        id: "amber-studio",
        name: "Amber Studio",
        base: "dark",
        backdrop: "warm_amber",
        tokens: { "--studio-accent": "#F59E0B" },
      }),
      "utf8",
    );
    const reloaded = service.reloadFromDisk("amber-studio", true);
    assert.equal(reloaded.length, 2);
    assert.ok(reloaded.some((t) => t.id === "amber-studio" && t.tokens["--studio-accent"] === "#F59E0B"));
  } finally {
    service.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
