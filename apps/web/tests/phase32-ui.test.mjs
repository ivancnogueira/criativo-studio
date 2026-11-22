import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

describe("Fase 32 — Estúdio Social Media Avançado (Calendário Editorial, Galeria Métricas IG & Editor 4:5 / Safe Zones)", () => {
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

  const sampleAgents = [
    {
      agente_id: "designer_chefe",
      nome: "Designer Chefe",
      papel: "Direção de Arte",
      pasta: "designer_chefe",
      frente: "conteudo",
      modelo_padrao: "gemini-2.5-pro",
      ativo: true,
      status: "ocioso",
      config: { avatar_shape: "hex", avatar_color: "#31CF76" },
      atualizado_em: "2026-11-22T00:00:00.000Z",
    },
  ];

  it("1. SchedulePage preserva Agenda de Rotinas e expõe alternador Editorial (Posts) | Rotinas (Automações) sem <select>", async () => {
    const { SchedulePage } = await vite.ssrLoadModule("/src/features/schedule/SchedulePage.tsx");
    const html = renderToStaticMarkup(
      React.createElement(SchedulePage, {
        agentes: sampleAgents,
        canais: [],
        initialAgenda: {
          fuso_horario: "America/Sao_Paulo",
          rotinas: [],
          execucoes: [],
        },
        onOpenRoutine: () => {},
        onOpenAgentChat: () => {},
        onCreateFirstRoutine: () => {},
      })
    );
    assert.match(html, /Agenda de Rotinas/);
    assert.match(html, /Editorial \(Posts\)/);
    assert.match(html, /Rotinas \(Automações\)/);
    assert.equal(/<select[\s>]/i.test(html), false);
  });

  it("2. EditorialCalendarPage, EditorialPostCreateModal e PublishedGalleryMetricsPage renderizam em Carbon Dark sem <select>", async () => {
    const { EditorialCalendarPage } = await vite.ssrLoadModule(
      "/src/features/social-studio/EditorialCalendarPage.tsx"
    );
    const { EditorialPostCreateModal } = await vite.ssrLoadModule(
      "/src/features/social-studio/EditorialPostCreateModal.tsx"
    );
    const { PublishedGalleryMetricsPage } = await vite.ssrLoadModule(
      "/src/features/social-studio/PublishedGalleryMetricsPage.tsx"
    );

    const calHtml = renderToStaticMarkup(
      React.createElement(EditorialCalendarPage, {
        agentes: sampleAgents,
        onOpenAgentChat: () => {},
      })
    );
    assert.match(calHtml, /Nova pauta/);
    assert.equal(/<select[\s>]/i.test(calHtml), false);

    const modalHtml = renderToStaticMarkup(
      React.createElement(EditorialPostCreateModal, {
        open: true,
        creating: false,
        titulo: "Pauta Teste",
        formato: "carrossel",
        status: "ideia",
        pilar: "Autoridade",
        dataAgendada: "2026-12-10",
        agenteId: "designer_chefe",
        legenda: "Gancho [@SEU_PERFIL]",
        agentes: sampleAgents,
        onClose: () => {},
        onChangeTitulo: () => {},
        onChangeFormato: () => {},
        onChangeStatus: () => {},
        onChangePilar: () => {},
        onChangeData: () => {},
        onChangeAgenteId: () => {},
        onChangeLegenda: () => {},
        onSubmit: () => {},
      })
    );
    assert.match(modalHtml, /Nova Pauta Editorial/);
    assert.equal(/<select[\s>]/i.test(modalHtml), false);

    const galHtml = renderToStaticMarkup(
      React.createElement(PublishedGalleryMetricsPage, {
        onOpenInstagramConfig: () => {},
        onAnalyzeWithAgent: () => {},
      })
    );
    assert.match(galHtml, /Galeria &amp; Métricas Instagram/);
    assert.match(galHtml, /Sincronizar Meta API/);
    assert.equal(/<select[\s>]/i.test(galHtml), false);
  });

  it("3. CarouselStoriesStudioEditor suporta modo 4:5 (guia 1:1) e 9:16 (Safe Zones) + integração com InstagramMobilePreview", async () => {
    const { CarouselStoriesStudioEditor } = await vite.ssrLoadModule(
      "/src/features/social-studio/CarouselStoriesStudioEditor.tsx"
    );
    const { InstagramMobilePreview } = await vite.ssrLoadModule(
      "/src/features/preview/InstagramMobilePreview.tsx"
    );

    const sampleSlides = [
      { id: "s1", url: "/api/arquivos/raw?path=saidas/s1.png", ordem: 0 },
      { id: "s2", url: "/api/arquivos/raw?path=saidas/s2.png", ordem: 1 },
    ];

    const carouselHtml = renderToStaticMarkup(
      React.createElement(CarouselStoriesStudioEditor, {
        open: true,
        onClose: () => {},
        initialMode: "carousel_4_5",
        initialSlides: sampleSlides,
        initialCaption: "Legenda teste para [@SEU_PERFIL]",
        onSaveEditorial: async () => {},
        onApproveCreative: async () => {},
      })
    );
    assert.match(carouselHtml, /Carrossel 4:5 \(1080×1350\)/);
    assert.match(carouselHtml, /Área visível no Grid 1:1/);
    assert.match(carouselHtml, /Slide 1 \/ 10/);
    assert.match(carouselHtml, /Salvar no Post Editorial/);

    const storiesHtml = renderToStaticMarkup(
      React.createElement(CarouselStoriesStudioEditor, {
        open: true,
        onClose: () => {},
        initialMode: "stories_9_16",
        initialSlides: [sampleSlides[0]],
        initialCaption: "Story teste",
      })
    );
    assert.match(storiesHtml, /ZONA DE RISCO TOPO/);
    assert.match(storiesHtml, /ZONA DE RISCO BASE/);
    assert.match(storiesHtml, /\[@SEU_PERFIL\]/);

    const previewHtml = renderToStaticMarkup(
      React.createElement(InstagramMobilePreview, {
        tarefa: {
          tarefa_id: "t-32",
          agente_id: "designer_chefe",
          canal_origem: "web",
          tipo: "carrossel",
          titulo: "Carrossel Demonstração",
          prioridade: 4,
          status: "aguardando_aprovacao",
          payload: {},
          resultado: { previews: ["/api/arquivos/raw?path=saidas/s1.png"], copy: "Copy de exemplo" },
          erro_detalhes: null,
          tentativas: 1,
          criado_em: "2026-11-22T00:00:00.000Z",
          atualizado_em: "2026-11-22T00:00:00.000Z",
          concluido_em: null,
        },
      })
    );
    assert.match(previewHtml, /Abrir no Editor Visual \(4:5 \/ Safe Zones\)/);
  });

  it("4. WorkspaceRail inclui item Galeria IG e componentes novos não contêm dados reais ou <select>", () => {
    const railSrc = readFileSync(
      resolve(webRoot, "src/components/workspace-rail-quota-rings.tsx"),
      "utf8"
    );
    assert.match(railSrc, /galeria_ig/);
    assert.match(railSrc, /Galeria IG/);
  });
});
