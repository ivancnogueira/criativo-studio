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
import { extname, join, relative, resolve, sep } from "node:path";
import type {
  AgentNotificationLevel,
  StorageUsageItem,
  StorageUsageSnapshot,
  StudioUserSettings,
  WhatsNewReleaseInfo,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { WebSocketHub } from "./websocket-hub.ts";

export const CONFIG_KEY_USER_SETTINGS = "preferencias_usuario_v1";

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

const VALID_SCALES = new Set([80, 90, 100, 110, 120]);
const VALID_SOUNDS = new Set(["cristal", "suave", "pulso", "silencio"]);
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".mkv"]);

function sanitizeNotificationMatrix(
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

function mergeUserSettings(
  base: StudioUserSettings,
  patch: Partial<StudioUserSettings> | Record<string, unknown>,
): StudioUserSettings {
  const geralRaw = (patch.geral ?? {}) as Partial<StudioUserSettings["geral"]>;
  const aparenciaRaw = (patch.aparencia ?? {}) as Partial<StudioUserSettings["aparencia"]>;
  const compRaw = (patch.comportamento ?? {}) as Partial<StudioUserSettings["comportamento"]>;
  const notifRaw = (patch.notificacoes ?? {}) as Partial<StudioUserSettings["notificacoes"]>;
  const vozRaw = (patch.voz ?? {}) as Partial<StudioUserSettings["voz"]>;

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

interface ScannedFileEntry {
  absPath: string;
  relPath: string;
  nome: string;
  bytes: number;
  mtimeIso: string;
}

function walkDirectorySafe(rootDir: string, currentDir: string, out: ScannedFileEntry[]): void {
  if (!existsSync(currentDir)) return;
  let entries: string[] = [];
  try {
    entries = readdirSync(currentDir);
  } catch {
    return;
  }

  for (const name of entries) {
    if (name === ".gitkeep" || name === ".DS_Store") continue;
    const full = join(currentDir, name);
    let stat;
    try {
      stat = lstatSync(full);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      walkDirectorySafe(rootDir, full, out);
    } else if (stat.isFile()) {
      const rel = relative(rootDir, full).split(sep).join("/");
      if (rel.startsWith("..")) continue;
      out.push({
        absPath: full,
        relPath: rel,
        nome: name,
        bytes: stat.size,
        mtimeIso: stat.mtime.toISOString(),
      });
    }
  }
}

export function computeStorageUsage(
  db: CriativoDatabase,
  workspaceRoot: string,
): StorageUsageSnapshot {
  const safeRoot = resolve(workspaceRoot);

  const uploadsEntries: ScannedFileEntry[] = [];
  walkDirectorySafe(safeRoot, join(safeRoot, "recursos"), uploadsEntries);

  const saidasEntries: ScannedFileEntry[] = [];
  walkDirectorySafe(safeRoot, join(safeRoot, "saidas"), saidasEntries);
  walkDirectorySafe(safeRoot, join(safeRoot, "previas"), saidasEntries);

  const artesEntries: ScannedFileEntry[] = [];
  const videosEntries: ScannedFileEntry[] = [];
  for (const entry of saidasEntries) {
    const ext = extname(entry.nome).toLowerCase();
    if (entry.relPath.startsWith("saidas/videos/") || VIDEO_EXTS.has(ext)) {
      videosEntries.push(entry);
    } else {
      artesEntries.push(entry);
    }
  }

  const browserEntries: ScannedFileEntry[] = [];
  walkDirectorySafe(safeRoot, join(safeRoot, "dados", "browser-profiles"), browserEntries);

  let dbBytes = 0;
  let dbFilesCount = 0;
  if (db.dbPath && db.dbPath !== ":memory:") {
    for (const suffix of ["", "-wal", "-shm"]) {
      const candidate = `${db.dbPath}${suffix}`;
      if (existsSync(candidate)) {
        try {
          const st = statSync(candidate);
          if (st.isFile()) {
            dbBytes += st.size;
            dbFilesCount += 1;
          }
        } catch {
          // ignore
        }
      }
    }
  } else {
    // Em banco :memory:, estima páginas SQLite via PRAGMA
    try {
      const pc = db.connection.prepare("PRAGMA page_count").get() as { page_count?: number } | undefined;
      const ps = db.connection.prepare("PRAGMA page_size").get() as { page_size?: number } | undefined;
      dbBytes = Number(pc?.page_count ?? 0) * Number(ps?.page_size ?? 4096);
      dbFilesCount = 1;
    } catch {
      dbBytes = 0;
    }
  }

  const sumBytes = (list: ScannedFileEntry[]) => list.reduce((acc, item) => acc + item.bytes, 0);

  const categorias: StorageUsageItem[] = [
    {
      categoria: "uploads",
      rotulo: "Uploads & Referências",
      cor_hex: "#42A0FF",
      bytes: sumBytes(uploadsEntries),
      arquivos_count: uploadsEntries.length,
    },
    {
      categoria: "artes_geradas",
      rotulo: "Artes & Prévias",
      cor_hex: "#10B981",
      bytes: sumBytes(artesEntries),
      arquivos_count: artesEntries.length,
    },
    {
      categoria: "videos",
      rotulo: "Vídeos & Reels",
      cor_hex: "#A855F7",
      bytes: sumBytes(videosEntries),
      arquivos_count: videosEntries.length,
    },
    {
      categoria: "perfis_navegador",
      rotulo: "Perfis de Navegador",
      cor_hex: "#F59E0B",
      bytes: sumBytes(browserEntries),
      arquivos_count: browserEntries.length,
    },
    {
      categoria: "banco_dados",
      rotulo: "Banco de Dados SQLite",
      cor_hex: "#64748B",
      bytes: dbBytes,
      arquivos_count: dbFilesCount,
    },
  ];

  // Mapeia arquivos registrados no SQLite para vincular arquivo_id e agente_id
  const dbFiles = db.connection
    .prepare(
      "SELECT arquivo_id, nome_original, caminho_relativo, tamanho_bytes, agente_id, criado_em FROM projecao_arquivos",
    )
    .all() as Array<{
    arquivo_id: string;
    nome_original: string;
    caminho_relativo: string;
    tamanho_bytes: number;
    agente_id: string | null;
    criado_em: string;
  }>;

  const byRelPath = new Map<
    string,
    { arquivo_id: string; nome_original: string; agente_id: string | null; criado_em: string }
  >();
  const porAgente: Record<string, number> = {};

  for (const row of dbFiles) {
    const normalizedRel = row.caminho_relativo.replace(/\\/g, "/").replace(/^\/+/, "");
    byRelPath.set(normalizedRel, {
      arquivo_id: row.arquivo_id,
      nome_original: row.nome_original,
      agente_id: row.agente_id,
      criado_em: row.criado_em,
    });
    if (row.agente_id) {
      porAgente[row.agente_id] = (porAgente[row.agente_id] ?? 0) + Number(row.tamanho_bytes ?? 0);
    }
  }

  const userDeletableCandidates = [...uploadsEntries, ...artesEntries, ...videosEntries];
  userDeletableCandidates.sort((a, b) => b.bytes - a.bytes);

  const topFiles = userDeletableCandidates.slice(0, 25).map((entry) => {
    const meta = byRelPath.get(entry.relPath);
    return {
      arquivo_id: meta?.arquivo_id ?? `path:${entry.relPath}`,
      nome: meta?.nome_original ?? entry.nome,
      caminho_relativo: entry.relPath,
      bytes: entry.bytes,
      agente_id: meta?.agente_id ?? null,
      criado_em: meta?.criado_em ?? entry.mtimeIso,
    };
  });

  const totalBytes = categorias.reduce((acc, item) => acc + item.bytes, 0);

  return {
    totalBytes,
    categorias,
    topFiles,
    porAgente,
    atualizado_em: new Date().toISOString(),
  };
}

export function clearStorageCategory(
  _db: CriativoDatabase,
  workspaceRoot: string,
  category: "browser_cache" | "temp_previews",
): { ok: boolean; category: string; freedBytes: number; removedCount: number } {
  const safeRoot = resolve(workspaceRoot);
  let freedBytes = 0;
  let removedCount = 0;

  if (category === "temp_previews") {
    const previasDir = join(safeRoot, "previas");
    const entries: ScannedFileEntry[] = [];
    walkDirectorySafe(safeRoot, previasDir, entries);
    for (const entry of entries) {
      const rel = relative(previasDir, entry.absPath);
      if (rel.startsWith("..")) continue;
      try {
        unlinkSync(entry.absPath);
        freedBytes += entry.bytes;
        removedCount += 1;
      } catch {
        // ignore locked files
      }
    }
    return { ok: true, category, freedBytes, removedCount };
  }

  if (category === "browser_cache") {
    const profilesRoot = join(safeRoot, "dados", "browser-profiles");
    if (!existsSync(profilesRoot)) {
      return { ok: true, category, freedBytes: 0, removedCount: 0 };
    }
    const cacheDirNames = ["Cache", "Code Cache", "GPUCache", "GrShaderCache", "ShaderCache"];
    for (const profileDirName of readdirSync(profilesRoot)) {
      const profileDir = join(profilesRoot, profileDirName);
      let st;
      try {
        st = lstatSync(profileDir);
      } catch {
        continue;
      }
      if (!st.isDirectory() || st.isSymbolicLink()) continue;

      const candidates = [
        ...cacheDirNames.map((c) => join(profileDir, c)),
        ...cacheDirNames.map((c) => join(profileDir, "Default", c)),
      ];
      for (const cacheDir of candidates) {
        if (!existsSync(cacheDir)) continue;
        const rel = relative(profilesRoot, cacheDir);
        if (rel.startsWith("..")) continue;
        const files: ScannedFileEntry[] = [];
        walkDirectorySafe(safeRoot, cacheDir, files);
        for (const f of files) {
          freedBytes += f.bytes;
          removedCount += 1;
        }
        try {
          rmSync(cacheDir, { recursive: true, force: true });
        } catch {
          // ignore em uso
        }
      }
    }
    return { ok: true, category, freedBytes, removedCount };
  }

  throw new Error(`Categoria de limpeza inválida: ${String(category)}`);
}

export function deleteStorageFile(
  db: CriativoDatabase,
  workspaceRoot: string,
  arquivoId: string,
): { ok: boolean; arquivoId: string; freedBytes: number } {
  const safeRoot = resolve(workspaceRoot);
  const allowedRoots = [
    resolve(safeRoot, "recursos"),
    resolve(safeRoot, "saidas"),
    resolve(safeRoot, "previas"),
  ];

  let relPath: string | null = null;
  let dbRecordId: string | null = null;

  const row = db.connection
    .prepare("SELECT arquivo_id, caminho_relativo FROM projecao_arquivos WHERE arquivo_id = ?")
    .get(arquivoId) as { arquivo_id: string; caminho_relativo: string } | undefined;

  if (row) {
    dbRecordId = row.arquivo_id;
    relPath = row.caminho_relativo;
  } else if (arquivoId.startsWith("path:")) {
    relPath = arquivoId.slice("path:".length);
  }

  if (!relPath) {
    throw new Error("Arquivo não encontrado para exclusão.");
  }

  const targetAbs = resolve(safeRoot, relPath);
  const insideAllowed = allowedRoots.some((allowed) => {
    const rel = relative(allowed, targetAbs);
    return rel !== "" && !rel.startsWith("..") && !rel.includes(`..${sep}`);
  });

  if (!insideAllowed) {
    throw new Error("Caminho fora dos diretórios permitidos para exclusão de armazenamento.");
  }

  let freedBytes = 0;
  if (existsSync(targetAbs)) {
    const lst = lstatSync(targetAbs);
    if (lst.isSymbolicLink() || !lst.isFile()) {
      throw new Error("Apenas arquivos regulares podem ser excluídos.");
    }
    freedBytes = lst.size;
    unlinkSync(targetAbs);
  }

  if (dbRecordId) {
    db.connection.prepare("DELETE FROM projecao_arquivos WHERE arquivo_id = ?").run(dbRecordId);
  } else {
    const normalizedRel = relative(safeRoot, targetAbs).split(sep).join("/");
    db.connection
      .prepare("DELETE FROM projecao_arquivos WHERE caminho_relativo = ?")
      .run(normalizedRel);
  }

  return { ok: true, arquivoId, freedBytes };
}
