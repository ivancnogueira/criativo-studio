import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { ptBRMessages } from "../../../packages/i18n/src/locales/pt-BR.ts";
import { enMessages } from "../../../packages/i18n/src/locales/en.ts";
import { esMessages } from "../../../packages/i18n/src/locales/es.ts";

const WEB_ROOT = resolve(import.meta.dirname, "..");

test("DM47-05: AutomationsHubPage exibe sub-sidebar Fluxos Criativos + Fluxos Instagram [BETA] sem alterar rail principal", () => {
  const hubSrc = readFileSync(resolve(WEB_ROOT, "src/features/automations/AutomationsHubPage.tsx"), "utf8");
  assert.match(hubSrc, /creative_flows/);
  assert.match(hubSrc, /instagram_dm/);
  assert.match(hubSrc, /automations\.betaBadge/);

  const railSrc = readFileSync(resolve(WEB_ROOT, "src/components/workspace-rail-quota-rings.tsx"), "utf8");
  assert.doesNotMatch(railSrc, /automacao_dm/);
});

test("DM47-05: ZERO <select> nativo e todos novos modulos UI <= 500L (Switch <= 750L)", () => {
  const dirs = [
    resolve(WEB_ROOT, "src/features/automations"),
    resolve(WEB_ROOT, "src/features/social-studio/comment-dm"),
  ];

  for (const dir of dirs) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      const full = resolve(dir, file);
      const src = readFileSync(full, "utf8");
      assert.equal(/<select[\s>]/i.test(src), false, `Uso proibido de <select> nativo em ${file}`);
      const lines = src.split(/\r?\n/).length;
      assert.ok(lines <= 500, `Modulo ${file} excedeu 500L (${lines}L)`);
    }
  }

  const switchLines = readFileSync(
    resolve(WEB_ROOT, "src/components/studio/StudioSecondaryPagesSwitch.tsx"),
    "utf8"
  ).split(/\r?\n/).length;
  assert.ok(switchLines <= 750, `StudioSecondaryPagesSwitch excedeu teto de 750L (${switchLines}L)`);
});

test("DM47-05: Paridade 100% de chaves i18n entre pt-BR, en e es", () => {
  const ptKeys = Object.keys(ptBRMessages).sort();
  const enKeys = Object.keys(enMessages).sort();
  const esKeys = Object.keys(esMessages).sort();
  assert.deepEqual(enKeys, ptKeys, "Chaves en.ts diferem de pt-BR.ts");
  assert.deepEqual(esKeys, ptKeys, "Chaves es.ts diferem de pt-BR.ts");
  assert.ok(ptKeys.includes("automations.betaBadge"));
  assert.ok(ptKeys.includes("automations.instagramFlows"));
  assert.ok(ptKeys.includes("automations.creativeFlows"));
});
