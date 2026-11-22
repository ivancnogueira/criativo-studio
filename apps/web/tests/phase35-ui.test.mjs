import assert from "node:assert/strict";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

describe("Fase 35 — UI Telemetria Opt-In e Consentimentos Granulares MCP", () => {
  let vite;

  before(async () => {
    vite = await createViteServer({
      root: webRoot,
      server: { middlewareMode: true },
      appType: "custom",
    });
  });

  after(async () => {
    await vite.close();
  });

  it("1. SettingsTelemetryCard exibe toggle opt-in desativado por padrão e explicação de redação", async () => {
    const { SettingsTelemetryCard } = await vite.ssrLoadModule(
      "/src/features/settings/SettingsTelemetryCard.tsx",
    );

    const html = renderToStaticMarkup(
      React.createElement(SettingsTelemetryCard, {
        optIn: false,
        onChangeOptIn: () => {},
      }),
    );
    assert.ok(html.includes("Telemetria técnica diagnóstica (Opt-in)"));
    assert.ok(html.includes('aria-checked="false"'));
    assert.ok(html.includes("Desativada (zero coleta)"));
    assert.equal(/<select[\s>]/i.test(html), false);
  });

  it("2. InspectorMcpConsentCard renderiza regras MCP sem <select> nativo", async () => {
    const { InspectorMcpConsentCard } = await vite.ssrLoadModule(
      "/src/features/inspector/InspectorMcpConsentCard.tsx",
    );

    const html = renderToStaticMarkup(
      React.createElement(InspectorMcpConsentCard, {
        agenteId: "estrategista",
      }),
    );
    assert.ok(html.includes("Consentimentos MCP Granulares"));
    assert.equal(/<select[\s>]/i.test(html), false);
  });
});
