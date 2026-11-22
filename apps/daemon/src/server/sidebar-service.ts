/**
 * Serviço de organização hierárquica da Sidebar, Drag-and-Drop, Pins, Ocultação,
 * Duplicação de Agentes com 1 clique e 5 ferramentas de IA (UX-02 / D-05).
 */
import { randomUUID } from "node:crypto";
import type {
  AgentNotificationLevel,
  AgenteConfigVisual,
  AgenteRegistro,
  PermissionLevel,
  SidebarLayoutSnapshot,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import {
  parseBackupModelsJson,
} from "../engine/runner/backup-models-resolver.ts";
import {
  resolveAgentIdFromDb,
} from "./agent-resolver.ts";
import type {
  WebSocketHub,
} from "./websocket-hub.ts";
import { bumpRevision, type RawAgentSidebarRow } from "./sidebar-helpers.ts";
import { getSidebarLayout, mutateSidebarLayout } from "./sidebar-layout-ops.ts";

export * from "./sidebar-helpers.ts";
export * from "./sidebar-layout-ops.ts";

export function hydrateDuplicatedAgent(row: RawAgentSidebarRow): AgenteRegistro {
  let skillsPaths: string[] = [];
  try {
    const parsed = JSON.parse(row.skills_paths_json);
    if (Array.isArray(parsed)) skillsPaths = parsed.map(String);
  } catch {
    skillsPaths = [];
  }

  let configVisual: AgenteConfigVisual = {};
  try {
    const parsed = JSON.parse(row.config_json);
    if (parsed && typeof parsed === "object") {
      configVisual = parsed as AgenteConfigVisual;
    }
  } catch {
    configVisual = {};
  }

  const backupModels = parseBackupModelsJson(row.backup_models_json);
  const permissionLevel = (
    row.permission_level === "ask" || row.permission_level === "full"
      ? row.permission_level
      : "workspace"
  ) as PermissionLevel;
  const notificationLevel = (
    row.notification_level === "mentions" || row.notification_level === "muted"
      ? row.notification_level
      : "all"
  ) as AgentNotificationLevel;

  configVisual = {
    ...configVisual,
    backup_models: backupModels,
    permission_level: permissionLevel,
    allow_new_chat: row.allow_new_chat === 1,
    allow_quick_ack: row.allow_quick_ack === 1,
    allow_quick_acknowledgement: row.allow_quick_ack === 1,
    browser_profile_id: row.browser_profile_id ?? null,
    notification_level: notificationLevel,
    pinned: row.pinned === 1,
    hidden: row.hidden === 1,
    section_id: row.section_id ?? null,
  };

  return {
    agente_id: row.agente_id,
    nome: row.nome,
    papel: row.papel,
    frente:
      typeof configVisual.frente === "string"
        ? (configVisual.frente as AgenteRegistro["frente"])
        : undefined,
    modelo_padrao: row.modelo_padrao,
    status: row.status as AgenteRegistro["status"],
    skills_paths: skillsPaths,
    memoria_resumo: row.memoria_resumo,
    ordem_exibicao: row.ordem_exibicao,
    config: configVisual,
    backup_models: backupModels,
    permission_level: permissionLevel,
    allow_new_chat: row.allow_new_chat === 1,
    allow_quick_ack: row.allow_quick_ack === 1,
    browser_profile_id: row.browser_profile_id ?? null,
    notification_level: notificationLevel,
    pinned: row.pinned === 1,
    hidden: row.hidden === 1,
    section_id: row.section_id ?? null,
    atualizado_em: row.atualizado_em,
  };
}

export function duplicateAgent(
  db: CriativoDatabase,
  agenteId: string,
  wsHub?: WebSocketHub,
): { agente: AgenteRegistro; layout: SidebarLayoutSnapshot } {
  let createdRow: RawAgentSidebarRow | undefined;
  let nextRevision = 1;

  db.runInTransaction(() => {
    const source = db.connection
      .prepare(`
        SELECT
          agente_id, nome, papel, modelo_padrao, status, skills_paths_json,
          memoria_resumo, ordem_exibicao, config_json, backup_models_json,
          permission_level, allow_new_chat, allow_quick_ack, browser_profile_id,
          pinned, hidden, section_id, notification_level, atualizado_em
        FROM projecao_agentes
        WHERE agente_id = ?
      `)
      .get(agenteId) as unknown as RawAgentSidebarRow | undefined;

    if (!source) {
      throw new Error(`Agente "${agenteId}" não encontrado para duplicação.`);
    }

    const now = new Date().toISOString();
    const baseSlug = source.agente_id
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28);
    const newAgentId = `${baseSlug || "agente"}-copia-${randomUUID().slice(0, 6)}`;
    const newName = `${source.nome} (cópia)`.slice(0, 80);

    let parsedConfig: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(source.config_json);
      if (parsed && typeof parsed === "object") parsedConfig = parsed as Record<string, unknown>;
    } catch {
      parsedConfig = {};
    }
    parsedConfig.customizado = true;

    const targetOrdem = Number(source.ordem_exibicao ?? 0) + 1;
    db.connection
      .prepare(
        "UPDATE projecao_agentes SET ordem_exibicao = ordem_exibicao + 1 WHERE ordem_exibicao >= ?",
      )
      .run(targetOrdem);

    db.connection
      .prepare(`
        INSERT INTO projecao_agentes (
          agente_id, nome, papel, modelo_padrao, status, skills_paths_json,
          memoria_resumo, ordem_exibicao, config_json, backup_models_json,
          permission_level, allow_new_chat, allow_quick_ack, browser_profile_id,
          pinned, hidden, section_id, notification_level, atualizado_em
        ) VALUES (?, ?, ?, ?, 'ocioso', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
      `)
      .run(
        newAgentId,
        newName,
        source.papel,
        source.modelo_padrao,
        source.skills_paths_json,
        source.memoria_resumo,
        targetOrdem,
        JSON.stringify(parsedConfig),
        source.backup_models_json || '{"automatic":false,"order":[]}',
        source.permission_level || "workspace",
        source.allow_new_chat ?? 1,
        source.allow_quick_ack ?? 1,
        source.browser_profile_id ?? null,
        source.section_id ?? null,
        source.notification_level || "all",
        now,
      );

    // Clona vínculos de habilidades instaladas do agente original
    const skillLinks = db.connection
      .prepare("SELECT skill_id, habilitada FROM projecao_agente_habilidades WHERE agente_id = ?")
      .all(source.agente_id) as Array<{ skill_id: string; habilitada: number }>;

    if (skillLinks.length > 0) {
      const insertLink = db.connection.prepare(`
        INSERT OR IGNORE INTO projecao_agente_habilidades (agente_id, skill_id, habilitada, instalada_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const link of skillLinks) {
        insertLink.run(newAgentId, link.skill_id, link.habilitada, now, now);
      }
    }

    createdRow = db.connection
      .prepare(`
        SELECT
          agente_id, nome, papel, modelo_padrao, status, skills_paths_json,
          memoria_resumo, ordem_exibicao, config_json, backup_models_json,
          permission_level, allow_new_chat, allow_quick_ack, browser_profile_id,
          pinned, hidden, section_id, notification_level, atualizado_em
        FROM projecao_agentes
        WHERE agente_id = ?
      `)
      .get(newAgentId) as unknown as RawAgentSidebarRow;

    nextRevision = bumpRevision(db);
  });

  if (!createdRow) {
    throw new Error("Falha ao duplicar agente.");
  }

  wsHub?.broadcast("sidebar:updated", { revision: nextRevision });
  return {
    agente: hydrateDuplicatedAgent(createdRow),
    layout: getSidebarLayout(db),
  };
}

export const SIDEBAR_AGENT_TOOL_NAMES = [
  "list_sections",
  "create_section",
  "rename_section",
  "delete_section",
  "assign_agent_section",
] as const;

export type SidebarAgentToolName = (typeof SIDEBAR_AGENT_TOOL_NAMES)[number];

export function executeSidebarTool(
  db: CriativoDatabase,
  toolName: SidebarAgentToolName | string,
  args: Record<string, unknown>,
  wsHub?: WebSocketHub,
): Record<string, unknown> {
  switch (toolName) {
    case "list_sections": {
      const snapshot = getSidebarLayout(db);
      return {
        ok: true,
        revision: snapshot.revision,
        sections: snapshot.sections,
        agentAssignments: snapshot.agentAssignments,
      };
    }

    case "create_section": {
      const nome = String(args.nome ?? args.name ?? "").trim();
      const parentRaw = args.parentId ?? args.parent_id ?? null;
      const parentId = typeof parentRaw === "string" && parentRaw.trim() ? parentRaw.trim() : null;
      const snapshot = mutateSidebarLayout(
        db,
        { op: "create_section", nome, parentId },
        wsHub,
      );
      const created = snapshot.sections.find(
        (s) =>
          s.nome.toLocaleLowerCase("pt-BR") === nome.toLocaleLowerCase("pt-BR") &&
          (s.parent_id ?? null) === parentId,
      );
      return {
        ok: true,
        section: created ?? null,
        revision: snapshot.revision,
      };
    }

    case "rename_section": {
      const sectionId = String(args.sectionId ?? args.section_id ?? "").trim();
      const nome = String(args.nome ?? args.name ?? "").trim();
      const snapshot = mutateSidebarLayout(
        db,
        { op: "rename_section", sectionId, nome },
        wsHub,
      );
      return {
        ok: true,
        section: snapshot.sections.find((s) => s.section_id === sectionId) ?? null,
        revision: snapshot.revision,
      };
    }

    case "delete_section": {
      const sectionId = String(args.sectionId ?? args.section_id ?? "").trim();
      const snapshot = mutateSidebarLayout(
        db,
        { op: "delete_section", sectionId },
        wsHub,
      );
      return {
        ok: true,
        deletedSectionId: sectionId,
        revision: snapshot.revision,
      };
    }

    case "assign_agent_section": {
      const rawAgentId = String(args.agentId ?? args.agent_id ?? "").trim();
      const agentId = resolveAgentIdFromDb(db, rawAgentId) ?? rawAgentId;
      const sectionRaw = args.sectionId ?? args.section_id ?? null;
      const sectionId =
        typeof sectionRaw === "string" && sectionRaw.trim() ? sectionRaw.trim() : null;
      const beforeRaw = args.beforeAgentId ?? args.before_agent_id ?? null;
      const beforeTrimmed =
        typeof beforeRaw === "string" && beforeRaw.trim() ? beforeRaw.trim() : null;
      const beforeAgentId = beforeTrimmed
        ? resolveAgentIdFromDb(db, beforeTrimmed) ?? beforeTrimmed
        : null;
      const snapshot = mutateSidebarLayout(
        db,
        { op: "move_agent", agentId, sectionId, beforeAgentId },
        wsHub,
      );
      return {
        ok: true,
        agentId,
        sectionId: snapshot.agentAssignments[agentId] ?? null,
        revision: snapshot.revision,
      };
    }

    default:
      throw new Error(`Ferramenta de sidebar desconhecida: ${toolName}`);
  }
}

