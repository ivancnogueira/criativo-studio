import assert from "node:assert/strict";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

const SYNTHETIC_REPORT = {
  ok: true,
  periodo: "30d",
  timezone: "America/Sao_Paulo",
  total_posts_analisados: 12,
  amostra_insuficiente: false,
  resumo_retencao: {
    total_reels_com_skip_rate: 5,
    avg_skip_rate_3s_pct: 31.4,
    avg_hook_retention_3s_pct: 68.6,
    total_reposts: 47,
  },
  melhores_horarios: [
    {
      dia_semana: 2,
      dia_label: "Ter",
      hora: 19,
      faixa_label: "Ter 19:00",
      quantidade_posts: 4,
      reach_medio: 3400,
      views_medio: 5200,
      taxa_salvamento_media_pct: 6.4,
      skip_rate_3s_medio_pct: 29.8,
      reposts_total: 22,
      score_medio: 88.5,
      confianca: "alta",
    },
    {
      dia_semana: 4,
      dia_label: "Qui",
      hora: 12,
      faixa_label: "Qui 12:00",
      quantidade_posts: 3,
      reach_medio: 2900,
      views_medio: 4100,
      taxa_salvamento_media_pct: 5.1,
      skip_rate_3s_medio_pct: 34.2,
      reposts_total: 15,
      score_medio: 76.0,
      confianca: "media",
    },
  ],
  heatmap_horarios: [
    {
      dia_semana: 2,
      dia_label: "Ter",
      hora: 19,
      faixa_label: "Ter 19:00",
      quantidade_posts: 4,
      reach_medio: 3400,
      views_medio: 5200,
      taxa_salvamento_media_pct: 6.4,
      skip_rate_3s_medio_pct: 29.8,
      reposts_total: 22,
      score_medio: 88.5,
      confianca: "alta",
    },
  ],
  formatos_campeoes: [
    {
      formato: "carrossel",
      editorial_formato: "carrossel",
      quantidade: 7,
      reach_medio: 3600,
      views_medio: 4800,
      taxa_salvamento_media_pct: 7.2,
      avg_skip_rate_3s_pct: null,
      total_reposts: 29,
      score_medio: 91.2,
      campeao: true,
      motivo_destaque: "Maior taxa média de salvamento e reposts para [@SEU_PERFIL].",
    },
    {
      formato: "reels",
      editorial_formato: "reels",
      quantidade: 5,
      reach_medio: 3100,
      views_medio: 5400,
      taxa_salvamento_media_pct: 4.5,
      avg_skip_rate_3s_pct: 31.4,
      total_reposts: 18,
      score_medio: 80.1,
      campeao: false,
      motivo_destaque: "Boa retenção nos 3 segundos iniciais para [NOME_DA_MARCA].",
    },
  ],
  proximo_slot_sugerido: {
    data_agendada: "2026-12-01",
    dia_label: "Ter",
    hora_sugerida: "19:00",
    formato_recomendado: "carrossel",
    motivo: "Janela com melhor score histórico livre no calendário.",
  },
  recomendacoes: [
    {
      id: "rec-1",
      tipo: "melhor_horario",
      titulo: "Priorize Ter 19:00",
      justificativa: "Maior taxa combinada de salvamento e reposts para [@SEU_PERFIL].",
    },
  ],
  ultima_sincronizacao: "2026-11-27T17:00:00.000Z",
};

describe("Fase 45 — Painel Visual de Retenção 3s, Reposts & Melhores Horários (META42-03)", () => {
  let vite;

  before(async () => {
    vite = await createViteServer({
      root: webRoot,
      server: { middlewareMode: true, hmr: false },
      appType: "custom",
    });
  });

  after(async () => {
    await vite.close();
  });

  it("1. MetaRetentionInsightsPanel renderiza Retenção 3s, Skip Rate 3s, Reposts, Formatos Campeões e Melhores Horários sem <select>", async () => {
    const { MetaRetentionInsightsPanel } = await vite.ssrLoadModule(
      "/src/features/social-studio/MetaRetentionInsightsPanel.tsx"
    );

    const html = renderToStaticMarkup(
      React.createElement(MetaRetentionInsightsPanel, {
        periodo: "30d",
        formatFilter: "todos",
        initialReport: SYNTHETIC_REPORT,
        onAnalyzeWithAgent: () => {},
      })
    );

    assert.match(html, /Retenção 3s/);
    assert.match(html, /Skip Rate 3s/);
    assert.match(html, /Reposts/);
    assert.match(html, /Formatos Campeões/);
    assert.match(html, /Melhores Horários/);
    assert.match(html, /Analisar retenção com Criativo/);
    assert.equal(/<select[\s>]/i.test(html), false);
  });

  it("2. EditorialBestTimesBar renderiza recomendação e botão Agendar no melhor horário sem <select>", async () => {
    const { EditorialBestTimesBar } = await vite.ssrLoadModule(
      "/src/features/social-studio/EditorialBestTimesBar.tsx"
    );

    const html = renderToStaticMarkup(
      React.createElement(EditorialBestTimesBar, {
        initialReport: SYNTHETIC_REPORT,
        onApplyRecommendation: () => {},
      })
    );

    assert.match(html, /Melhores Horários/);
    assert.match(html, /Agendar no melhor horário/);
    assert.match(html, /Ter 19:00/);
    assert.equal(/<select[\s>]/i.test(html), false);
  });

  it("3. PublishedGalleryMetricsPage e EditorialCalendarPage renderizam sem <select> nativo", async () => {
    const { PublishedGalleryMetricsPage } = await vite.ssrLoadModule(
      "/src/features/social-studio/PublishedGalleryMetricsPage.tsx"
    );
    const { EditorialCalendarPage } = await vite.ssrLoadModule(
      "/src/features/social-studio/EditorialCalendarPage.tsx"
    );

    const galleryHtml = renderToStaticMarkup(
      React.createElement(PublishedGalleryMetricsPage, {
        onOpenInstagramConfig: () => {},
        onAnalyzeWithAgent: () => {},
      })
    );
    assert.match(galleryHtml, /Galeria &amp; Métricas Instagram/);
    assert.match(galleryHtml, /Auditoria Meta/);
    assert.equal(/<select[\s>]/i.test(galleryHtml), false);

    const calendarHtml = renderToStaticMarkup(
      React.createElement(EditorialCalendarPage, {
        agentes: [
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
            atualizado_em: "2026-11-27T00:00:00.000Z",
          },
        ],
        onOpenAgentChat: () => {},
      })
    );
    assert.match(calendarHtml, /Nova pauta/);
    assert.equal(/<select[\s>]/i.test(calendarHtml), false);
  });
});
