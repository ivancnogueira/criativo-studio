/**
 * Serviço unificado de Configurações de Usuário (`StudioUserSettings`),
 * Uso Real de Armazenamento (`StorageUsageSnapshot`) e Novidades (`WhatsNewReleaseInfo`) (UX-03 / D-06).
 */
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import {
  join,
  resolve,
} from "node:path";
import type {
  AgentNotificationLevel,
  StudioDockSettings,
  StudioUserSettings,
  WhatsNewReleaseInfo,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import type {
  WebSocketHub,
} from "./websocket-hub.ts";

export const CONFIG_KEY_USER_SETTINGS = "preferencias_usuario_v1";

export const DEFAULT_STUDIO_DOCK_SETTINGS: StudioDockSettings = {
  mostrar_dock: true,
  posicao: "sobre_outros_apps",
  tela: "principal",
  borda: "right",
  tamanho_percentual: 100,
  ocultar_quando_inativo: false,
  mostrar_faixa_borda: true,
  mostrar_trabalho_concluido: true,
  mostrar_agentes_com_novidades: false,
  agentes_ids: null,
};

export const DEFAULT_STUDIO_USER_SETTINGS: StudioUserSettings = {
  geral: {
    atalho_envio: "enter",
    ordenacao_sidebar: "secoes",
    exibir_passos_agente: true,
    acoes_compactas: false,
  },
  aparencia: {
    tema: "carbon_dark",
    cor_acento: "#007CF7",
    cor_balao_usuario: "#2A2A2A",
    baloes_solidos: true,
    escala: 100,
    fonte_interface: "Inter",
    fonte_codigo: "JetBrains Mono",
    idioma: "pt-BR",
  },
  comportamento: {
    restaurar_ultima_aba: true,
    exibir_dynamic_island: true,
    detalhe_dynamic_island: "detalhado",
    habilitar_drawer_rapido: true,
  },
  dock: structuredClone(DEFAULT_STUDIO_DOCK_SETTINGS),
  notificacoes: {
    web_habilitadas: false,
    mostrar_preview: true,
    som_tarefa: "cristal",
    som_feedback: "suave",
    matriz: {},
  },
  voz: {
    provedor_ditado: "web_speech",
    modelo_tts: "edge_tts",
    velocidade: 1.0,
    leitura_automatica: false,
    live_voice_habilitada: false,
  },
  atualizado_em: "2026-01-01T00:00:00.000Z",
};

export const VALID_SCALES = new Set([80, 90, 100, 110, 120]);
export const VALID_SOUNDS = new Set(["cristal", "suave", "pulso", "silencio"]);
export const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
export const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".mkv"]);

export function sanitizeNotificationMatrix(
  raw: unknown,
): Record<string, AgentNotificationLevel> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, AgentNotificationLevel> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!key.trim()) continue;
    if (val === "all" || val === "mentions" || val === "muted") {
      out[key] = val;
    }
  }
  return out;
}

export function mergeUserSettings(
  base: StudioUserSettings,
  patch: Partial<StudioUserSettings> | Record<string, unknown>,
): StudioUserSettings {
  const geralRaw = (patch.geral ?? {}) as Partial<StudioUserSettings["geral"]>;
  const aparenciaRaw = (patch.aparencia ?? {}) as Partial<StudioUserSettings["aparencia"]>;
  const compRaw = (patch.comportamento ?? {}) as Partial<StudioUserSettings["comportamento"]>;
  const dockRaw = (patch.dock ?? {}) as Partial<StudioDockSettings>;
  const notifRaw = (patch.notificacoes ?? {}) as Partial<StudioUserSettings["notificacoes"]>;
  const vozRaw = (patch.voz ?? {}) as Partial<StudioUserSettings["voz"]>;
  const baseDock = base.dock ?? DEFAULT_STUDIO_DOCK_SETTINGS;

  const rawDockSize = Number(dockRaw.tamanho_percentual ?? baseDock.tamanho_percentual);
  const dockSize = Number.isFinite(rawDockSize)
    ? Math.min(150, Math.max(80, Math.round(rawDockSize)))
    : baseDock.tamanho_percentual;

  const dockAgentsIds: string[] | null =
    dockRaw.agentes_ids === null
      ? null
      : Array.isArray(dockRaw.agentes_ids)
        ? Array.from(
            new Set(
              dockRaw.agentes_ids
                .filter((id): id is string => typeof id === "string")
                .map((id) => id.trim())
                .filter(Boolean),
            ),
          )
        : baseDock.agentes_ids;

  const escalaNum = Number(aparenciaRaw.escala ?? base.aparencia.escala);
  const escala = (VALID_SCALES.has(escalaNum) ? escalaNum : base.aparencia.escala) as
    | 80
    | 90
    | 100
    | 110
    | 120;

  const corAcento =
    typeof aparenciaRaw.cor_acento === "string" && HEX_COLOR_RE.test(aparenciaRaw.cor_acento.trim())
      ? aparenciaRaw.cor_acento.trim().toUpperCase()
      : base.aparencia.cor_acento;

  const corBalaoUsuario =
    typeof aparenciaRaw.cor_balao_usuario === "string" &&
    HEX_COLOR_RE.test(aparenciaRaw.cor_balao_usuario.trim())
      ? aparenciaRaw.cor_balao_usuario.trim().toUpperCase()
      : (base.aparencia.cor_balao_usuario ?? "#2A2A2A");

  const baloesSolidos =
    typeof aparenciaRaw.baloes_solidos === "boolean"
      ? aparenciaRaw.baloes_solidos
      : (base.aparencia.baloes_solidos ?? true);

  const velocidadeRaw = Number(vozRaw.velocidade ?? base.voz.velocidade);
  const velocidade = Number.isFinite(velocidadeRaw)
    ? Math.min(2.0, Math.max(0.5, Math.round(velocidadeRaw * 100) / 100))
    : base.voz.velocidade;

  return {
    geral: {
      atalho_envio:
        geralRaw.atalho_envio === "mod_enter" || geralRaw.atalho_envio === "enter"
          ? geralRaw.atalho_envio
          : base.geral.atalho_envio,
      ordenacao_sidebar:
        geralRaw.ordenacao_sidebar === "recente" ||
        geralRaw.ordenacao_sidebar === "alfabetica" ||
        geralRaw.ordenacao_sidebar === "secoes"
          ? geralRaw.ordenacao_sidebar
          : base.geral.ordenacao_sidebar,
      exibir_passos_agente:
        typeof geralRaw.exibir_passos_agente === "boolean"
          ? geralRaw.exibir_passos_agente
          : base.geral.exibir_passos_agente,
      acoes_compactas:
        typeof geralRaw.acoes_compactas === "boolean"
          ? geralRaw.acoes_compactas
          : base.geral.acoes_compactas,
    },
    aparencia: {
      tema:
        aparenciaRaw.tema === "midnight_contrast" ||
        aparenciaRaw.tema === "light" ||
        aparenciaRaw.tema === "carbon_dark"
          ? aparenciaRaw.tema
          : base.aparencia.tema,
      cor_acento: corAcento,
      cor_balao_usuario: corBalaoUsuario,
      baloes_solidos: baloesSolidos,
      escala,
      fonte_interface:
        typeof aparenciaRaw.fonte_interface === "string" && aparenciaRaw.fonte_interface.trim()
          ? aparenciaRaw.fonte_interface.trim().slice(0, 60)
          : base.aparencia.fonte_interface,
      fonte_codigo:
        typeof aparenciaRaw.fonte_codigo === "string" && aparenciaRaw.fonte_codigo.trim()
          ? aparenciaRaw.fonte_codigo.trim().slice(0, 60)
          : base.aparencia.fonte_codigo,
      idioma:
        aparenciaRaw.idioma === "en" || aparenciaRaw.idioma === "es" || aparenciaRaw.idioma === "pt-BR"
          ? aparenciaRaw.idioma
          : base.aparencia.idioma,
    },
    comportamento: {
      restaurar_ultima_aba:
        typeof compRaw.restaurar_ultima_aba === "boolean"
          ? compRaw.restaurar_ultima_aba
          : base.comportamento.restaurar_ultima_aba,
      exibir_dynamic_island:
        typeof compRaw.exibir_dynamic_island === "boolean"
          ? compRaw.exibir_dynamic_island
          : base.comportamento.exibir_dynamic_island,
      detalhe_dynamic_island:
        compRaw.detalhe_dynamic_island === "compacto" ||
        compRaw.detalhe_dynamic_island === "detalhado"
          ? compRaw.detalhe_dynamic_island
          : base.comportamento.detalhe_dynamic_island,
      habilitar_drawer_rapido:
        typeof compRaw.habilitar_drawer_rapido === "boolean"
          ? compRaw.habilitar_drawer_rapido
          : base.comportamento.habilitar_drawer_rapido,
    },
    dock: {
      mostrar_dock:
        typeof dockRaw.mostrar_dock === "boolean"
          ? dockRaw.mostrar_dock
          : typeof compRaw.habilitar_drawer_rapido === "boolean"
            ? compRaw.habilitar_drawer_rapido
            : baseDock.mostrar_dock,
      posicao:
        dockRaw.posicao === "apenas_janela" || dockRaw.posicao === "sobre_outros_apps"
          ? dockRaw.posicao
          : baseDock.posicao,
      tela:
        typeof dockRaw.tela === "string" && dockRaw.tela.trim().length > 0
          ? dockRaw.tela.trim().slice(0, 64)
          : baseDock.tela,
      borda:
        dockRaw.borda === "left" || dockRaw.borda === "right"
          ? dockRaw.borda
          : baseDock.borda,
      tamanho_percentual: dockSize,
      ocultar_quando_inativo:
        typeof dockRaw.ocultar_quando_inativo === "boolean"
          ? dockRaw.ocultar_quando_inativo
          : baseDock.ocultar_quando_inativo,
      mostrar_faixa_borda:
        typeof dockRaw.mostrar_faixa_borda === "boolean"
          ? dockRaw.mostrar_faixa_borda
          : baseDock.mostrar_faixa_borda,
      mostrar_trabalho_concluido:
        typeof dockRaw.mostrar_trabalho_concluido === "boolean"
          ? dockRaw.mostrar_trabalho_concluido
          : baseDock.mostrar_trabalho_concluido,
      mostrar_agentes_com_novidades:
        typeof dockRaw.mostrar_agentes_com_novidades === "boolean"
          ? dockRaw.mostrar_agentes_com_novidades
          : baseDock.mostrar_agentes_com_novidades,
      agentes_ids: dockAgentsIds,
    },
    notificacoes: {
      web_habilitadas:
        typeof notifRaw.web_habilitadas === "boolean"
          ? notifRaw.web_habilitadas
          : base.notificacoes.web_habilitadas,
      mostrar_preview:
        typeof notifRaw.mostrar_preview === "boolean"
          ? notifRaw.mostrar_preview
          : base.notificacoes.mostrar_preview,
      som_tarefa: VALID_SOUNDS.has(String(notifRaw.som_tarefa))
        ? (notifRaw.som_tarefa as StudioUserSettings["notificacoes"]["som_tarefa"])
        : base.notificacoes.som_tarefa,
      som_feedback: VALID_SOUNDS.has(String(notifRaw.som_feedback))
        ? (notifRaw.som_feedback as StudioUserSettings["notificacoes"]["som_feedback"])
        : base.notificacoes.som_feedback,
      matriz: notifRaw.matriz
        ? { ...base.notificacoes.matriz, ...sanitizeNotificationMatrix(notifRaw.matriz) }
        : { ...base.notificacoes.matriz },
    },
    voz: {
      provedor_ditado:
        vozRaw.provedor_ditado === "whisper" ||
        vozRaw.provedor_ditado === "gemini" ||
        vozRaw.provedor_ditado === "web_speech"
          ? vozRaw.provedor_ditado
          : base.voz.provedor_ditado,
      modelo_tts:
        vozRaw.modelo_tts === "elevenlabs" ||
        vozRaw.modelo_tts === "fish_audio" ||
        vozRaw.modelo_tts === "edge_tts"
          ? vozRaw.modelo_tts
          : base.voz.modelo_tts,
      velocidade,
      leitura_automatica:
        typeof vozRaw.leitura_automatica === "boolean"
          ? vozRaw.leitura_automatica
          : base.voz.leitura_automatica,
      live_voice_habilitada:
        typeof vozRaw.live_voice_habilitada === "boolean"
          ? vozRaw.live_voice_habilitada
          : base.voz.live_voice_habilitada,
    },
    atualizado_em: new Date().toISOString(),
  };
}

export function getUserSettings(db: CriativoDatabase): StudioUserSettings {
  const row = db.connection
    .prepare("SELECT valor_json, atualizado_em FROM projecao_studio_config WHERE chave = ?")
    .get(CONFIG_KEY_USER_SETTINGS) as { valor_json: string; atualizado_em: string } | undefined;

  if (!row) {
    return structuredClone(DEFAULT_STUDIO_USER_SETTINGS);
  }

  try {
    const parsed = JSON.parse(row.valor_json) as Partial<StudioUserSettings>;
    const merged = mergeUserSettings(DEFAULT_STUDIO_USER_SETTINGS, parsed);
    merged.atualizado_em = row.atualizado_em || merged.atualizado_em;
    return merged;
  } catch {
    return structuredClone(DEFAULT_STUDIO_USER_SETTINGS);
  }
}

export function updateUserSettings(
  db: CriativoDatabase,
  patch: Partial<StudioUserSettings>,
  wsHub?: WebSocketHub,
): StudioUserSettings {
  const current = getUserSettings(db);
  const next = mergeUserSettings(current, patch);
  const now = new Date().toISOString();
  next.atualizado_em = now;

  db.connection
    .prepare(`
      INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
      VALUES (?, ?, ?)
      ON CONFLICT(chave) DO UPDATE SET
        valor_json = excluded.valor_json,
        atualizado_em = excluded.atualizado_em
    `)
    .run(CONFIG_KEY_USER_SETTINGS, JSON.stringify(next), now);

  wsHub?.broadcast("settings:updated", { atualizado_em: now });
  return next;
}

export function getWhatsNewInfo(
  workspaceRoot: string,
  productRoot?: string,
): WhatsNewReleaseInfo {
  const resolvedProductRoot =
    productRoot?.trim() ||
    process.env.CRIATIVO_PRODUCT_ROOT?.trim() ||
    resolve(workspaceRoot, "..", "..");

  let versaoAtual = "1.0.0";
  const envVersion = process.env.CRIATIVO_APP_VERSION?.trim();
  if (envVersion) {
    versaoAtual = envVersion;
  } else {
    const versionCandidates: Array<{ path: string; field: "versao" | "version" }> = [
      { path: join(resolvedProductRoot, "produto.json"), field: "versao" },
      { path: join(workspaceRoot, "produto.json"), field: "versao" },
      { path: join(resolvedProductRoot, "package.json"), field: "version" },
      { path: join(workspaceRoot, "package.json"), field: "version" },
    ];
    for (const candidate of versionCandidates) {
      if (!existsSync(candidate.path)) continue;
      try {
        const parsed = JSON.parse(readFileSync(candidate.path, "utf8")) as Record<string, unknown>;
        const rawVer = parsed[candidate.field];
        if (typeof rawVer === "string" && rawVer.trim().length > 0) {
          versaoAtual = rawVer.trim();
          break;
        }
      } catch {
        // ignora arquivo inválido e tenta o próximo candidato
      }
    }
  }

  const notas: WhatsNewReleaseInfo["notas"] = [
    {
      versao: versaoAtual,
      data: "2026-11-19",
      added: [
        "Criativo AI Studio v1.0.0: equipe multiagente com Copilot no Chat (`/` comandos e `@` menções), Cofre AES-256-GCM e Memórias FTS5.",
        "Motor de automação Chromium CDP nativo com perfis isolados, Takeover remoto e modo Ensinar ao Agente.",
        "Pareamento WhatsApp Baileys multi-número com suporte explícito ao modo Conversa Interna (meu número).",
        "Workflows visuais com Undo/Redo, Auto-layout e gatilhos por Cron, Webhook HMAC e WhatsApp.",
      ],
      changed: [
        "Modelos reais filtrados apenas por provedores conectados e sanitização estrita de schemas para Gemini.",
        "Configurações em página In-Focus e Rotinas promovidas como seção dedicada na barra lateral.",
      ],
      fixed: [
        "Estabilidade do daemon local com logs persistentes e watchdog automático, gravação real de voz via Microfone e badges da Loja.",
      ],
    },
  ];

  const changelogPath = join(workspaceRoot, "docs", "CHANGELOG.md");
  if (existsSync(changelogPath)) {
    try {
      const content = readFileSync(changelogPath, "utf8");
      const firstBullets = content
        .split(/\r?\n/)
        .filter((line) => line.trim().startsWith("- "))
        .slice(0, 5)
        .map((line) => line.replace(/^\s*-\s*/, "").trim())
        .filter(Boolean);
      if (firstBullets.length > 0) {
        notas.push({
          versao: "Histórico Local",
          data: "2026-11-01",
          added: firstBullets,
          changed: [],
          fixed: [],
        });
      }
    } catch {
      // ignore
    }
  }

  return {
    versao_atual: versaoAtual,
    verificado_em: new Date().toISOString(),
    atualizacao_disponivel: false,
    notas,
  };
}

