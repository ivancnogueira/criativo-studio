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
  SidebarLayoutMutation,
  SidebarLayoutSnapshot,
  SidebarSectionNode,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import { parseBackupModelsJson } from "../engine/runner/backup-models-resolver.ts";
import type { WebSocketHub } from "./websocket-hub.ts";

export const SIDEBAR_FOLDER_LEVELS = 3;
export const SIDEBAR_MAX_SECTIONS = 40;

const CONFIG_KEY_REVISION = "sidebar_layout_revision";
const CONFIG_KEY_PINS_ORDER = "sidebar_pins_order";

interface RawSectionRow {
  section_id: string;
  nome: string;
  parent_id: string | null;
  ordem: number;
  colapsada: number;
  criado_em: string;
  atualizado_em: string;
}

interface RawAgentSidebarRow {
  agente_id: string;
  nome: string;
  papel: string;
  modelo_padrao: string;
  status: string;
  skills_paths_json: string;
  memoria_resumo: string | null;
  ordem_exibicao: number;
  config_json: string;
  backup_models_json: string;
  permission_level: string;
  allow_new_chat: number;
  allow_quick_ack: number;
  browser_profile_id: string | null;
  pinned: number;
  hidden: number;
  section_id: string | null;
  notification_level: string;
  atualizado_em: string;
}

function readRevision(db: CriativoDatabase): number {
  const row = db.connection
    .prepare("SELECT valor_json FROM projecao_studio_config WHERE chave = ?")
    .get(CONFIG_KEY_REVISION) as { valor_json: string } | undefined;
  if (!row) return 1;
  try {
    const parsed = JSON.parse(row.valor_json) as { revision?: number } | number;
    if (typeof parsed === "number" && Number.isFinite(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && typeof parsed.revision === "number") {
      return parsed.revision;
    }
  } catch {
    // fallback
  }
  return 1;
}

function bumpRevision(db: CriativoDatabase): number {
  const next = readRevision(db) + 1;
  const now = new Date().toISOString();
  db.connection
    .prepare(`
      INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
      VALUES (?, ?, ?)
      ON CONFLICT(chave) DO UPDATE SET
        valor_json = excluded.valor_json,
        atualizado_em = excluded.atualizado_em
    `)
    .run(CONFIG_KEY_REVISION, JSON.stringify({ revision: next }), now);
  return next;
}

function readPinsOrder(db: CriativoDatabase): string[] {
  const row = db.connection
    .prepare("SELECT valor_json FROM projecao_studio_config WHERE chave = ?")
    .get(CONFIG_KEY_PINS_ORDER) as { valor_json: string } | undefined;
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.valor_json);
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
    }
  } catch {
    // ignore
  }
  return [];
}

function writePinsOrder(db: CriativoDatabase, pins: string[]): void {
  const now = new Date().toISOString();
  const unique = Array.from(new Set(pins.filter((p) => typeof p === "string" && p.trim().length > 0)));
  db.connection
    .prepare(`
      INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
      VALUES (?, ?, ?)
      ON CONFLICT(chave) DO UPDATE SET
        valor_json = excluded.valor_json,
        atualizado_em = excluded.atualizado_em
    `)
    .run(CONFIG_KEY_PINS_ORDER, JSON.stringify(unique), now);
}

function computeSectionLevels(rows: RawSectionRow[]): SidebarSectionNode[] {
  const byId = new Map<string, RawSectionRow>();
  for (const row of rows) {
    byId.set(row.section_id, row);
  }

  const resolveLevelAndParent = (
    row: RawSectionRow,
  ): { nivel: number; normalizedParentId: string | null } => {
    if (!row.parent_id || !byId.has(row.parent_id) || row.parent_id === row.section_id) {
      return { nivel: 1, normalizedParentId: null };
    }
    const visited = new Set<string>([row.section_id]);
    let depth = 1;
    let cursorId: string | null = row.parent_id;
    while (cursorId) {
      if (visited.has(cursorId)) {
        return { nivel: 1, normalizedParentId: null };
      }
      const parent = byId.get(cursorId);
      if (!parent) break;
      visited.add(cursorId);
      depth += 1;
      if (depth > SIDEBAR_FOLDER_LEVELS) {
        return { nivel: SIDEBAR_FOLDER_LEVELS, normalizedParentId: row.parent_id };
      }
      cursorId = parent.parent_id;
    }
    return { nivel: depth, normalizedParentId: row.parent_id };
  };

  return rows.map((row) => {
    const { nivel, normalizedParentId } = resolveLevelAndParent(row);
    return {
      section_id: row.section_id,
      nome: row.nome,
      parent_id: normalizedParentId,
      ordem: Number(row.ordem ?? 0),
      colapsada: Boolean(row.colapsada),
      nivel,
      criado_em: row.criado_em,
      atualizado_em: row.atualizado_em,
    };
  });
}

function getSubtreeHeight(sections: SidebarSectionNode[], rootId: string): number {
  const childrenByParent = new Map<string, SidebarSectionNode[]>();
  for (const sec of sections) {
    if (!sec.parent_id) continue;
    const list = childrenByParent.get(sec.parent_id) ?? [];
    list.push(sec);
    childrenByParent.set(sec.parent_id, list);
  }

  const dfs = (id: string, guard: Set<string>): number => {
    if (guard.has(id)) return 1;
    guard.add(id);
    const children = childrenByParent.get(id) ?? [];
    if (children.length === 0) return 1;
    let maxChild = 0;
    for (const child of children) {
      maxChild = Math.max(maxChild, dfs(child.section_id, new Set(guard)));
    }
    return 1 + maxChild;
  };

  return dfs(rootId, new Set());
}

function isDescendantOrSelf(
  sections: SidebarSectionNode[],
  candidateId: string | null,
  ancestorId: string,
): boolean {
  if (!candidateId) return false;
  if (candidateId === ancestorId) return true;
  const byId = new Map(sections.map((s) => [s.section_id, s]));
  const visited = new Set<string>();
  let cursor: string | null = candidateId;
  while (cursor) {
    if (cursor === ancestorId) return true;
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = byId.get(cursor)?.parent_id ?? null;
  }
  return false;
}

function ensureUniqueSiblingName(
  sections: SidebarSectionNode[],
  nome: string,
  parentId: string | null,
  ignoreSectionId?: string,
): void {
  const normalized = nome.trim().toLocaleLowerCase("pt-BR");
  const duplicate = sections.find(
    (s) =>
      s.section_id !== ignoreSectionId &&
      (s.parent_id ?? null) === (parentId ?? null) &&
      s.nome.trim().toLocaleLowerCase("pt-BR") === normalized,
  );
  if (duplicate) {
    throw new Error(`Já existe uma seção "${duplicate.nome}" neste nível da barra lateral.`);
  }
}

export function getSidebarLayout(db: CriativoDatabase): SidebarLayoutSnapshot {
  const rawSections = db.connection
    .prepare(
      "SELECT section_id, nome, parent_id, ordem, colapsada, criado_em, atualizado_em FROM projecao_sidebar_secoes ORDER BY ordem ASC, criado_em ASC",
    )
    .all() as unknown as RawSectionRow[];

  const sections = computeSectionLevels(rawSections);
  const sectionIds = new Set(sections.map((s) => s.section_id));

  const rawAgents = db.connection
    .prepare(
      "SELECT agente_id, ordem_exibicao, pinned, hidden, section_id FROM projecao_agentes ORDER BY ordem_exibicao ASC, agente_id ASC",
    )
    .all() as Array<{
    agente_id: string;
    ordem_exibicao: number;
    pinned: number;
    hidden: number;
    section_id: string | null;
  }>;

  const agentAssignments: Record<string, string | null> = {};
  const agentOrder: string[] = [];
  const pinnedSet = new Set<string>();
  const hiddenAgentIds: string[] = [];

  for (const agent of rawAgents) {
    const validSection =
      agent.section_id && sectionIds.has(agent.section_id) ? agent.section_id : null;
    agentAssignments[agent.agente_id] = validSection;
    agentOrder.push(agent.agente_id);
    if (agent.pinned === 1) {
      pinnedSet.add(agent.agente_id);
    }
    if (agent.hidden === 1) {
      hiddenAgentIds.push(agent.agente_id);
    }
  }

  const storedPinsOrder = readPinsOrder(db);
  const pins: string[] = [];
  for (const id of storedPinsOrder) {
    if (pinnedSet.has(id) && !pins.includes(id)) {
      pins.push(id);
    }
  }
  for (const id of agentOrder) {
    if (pinnedSet.has(id) && !pins.includes(id)) {
      pins.push(id);
    }
  }

  return {
    revision: readRevision(db),
    sections,
    order: sections.map((s) => s.section_id),
    agentAssignments,
    agentOrder,
    pins,
    hiddenAgentIds,
  };
}

export function mutateSidebarLayout(
  db: CriativoDatabase,
  mutation: SidebarLayoutMutation,
  wsHub?: WebSocketHub,
): SidebarLayoutSnapshot {
  let nextRevision = 1;

  db.runInTransaction(() => {
    const current = getSidebarLayout(db);
    const now = new Date().toISOString();

    switch (mutation.op) {
      case "create_section": {
        const nome = String(mutation.nome ?? "").trim().slice(0, 64);
        if (!nome) {
          throw new Error("Informe um nome válido para a seção.");
        }
        if (current.sections.length >= SIDEBAR_MAX_SECTIONS) {
          throw new Error(`Limite máximo de ${SIDEBAR_MAX_SECTIONS} seções atingido.`);
        }
        const parentId = mutation.parentId ? String(mutation.parentId) : null;
        if (parentId) {
          const parent = current.sections.find((s) => s.section_id === parentId);
          if (!parent) {
            throw new Error("Seção pai não encontrada.");
          }
          if (parent.nivel >= SIDEBAR_FOLDER_LEVELS) {
            throw new Error(
              `Profundidade máxima de ${SIDEBAR_FOLDER_LEVELS} níveis atingida na barra lateral.`,
            );
          }
        }
        ensureUniqueSiblingName(current.sections, nome, parentId);
        const maxOrdem = current.sections.reduce((acc, s) => Math.max(acc, s.ordem), -1);
        const sectionId = `sec-${randomUUID().slice(0, 8)}`;
        db.connection
          .prepare(`
            INSERT INTO projecao_sidebar_secoes (section_id, nome, parent_id, ordem, colapsada, criado_em, atualizado_em)
            VALUES (?, ?, ?, ?, 0, ?, ?)
          `)
          .run(sectionId, nome, parentId, maxOrdem + 1, now, now);
        break;
      }

      case "rename_section": {
        const nome = String(mutation.nome ?? "").trim().slice(0, 64);
        if (!nome) {
          throw new Error("Informe um novo nome válido para a seção.");
        }
        const target = current.sections.find((s) => s.section_id === mutation.sectionId);
        if (!target) {
          throw new Error("Seção não encontrada.");
        }
        ensureUniqueSiblingName(current.sections, nome, target.parent_id, target.section_id);
        db.connection
          .prepare("UPDATE projecao_sidebar_secoes SET nome = ?, atualizado_em = ? WHERE section_id = ?")
          .run(nome, now, target.section_id);
        break;
      }

      case "delete_section": {
        const target = current.sections.find((s) => s.section_id === mutation.sectionId);
        if (!target) {
          throw new Error("Seção não encontrada.");
        }
        const promotedParent = target.parent_id ?? null;
        db.connection
          .prepare("UPDATE projecao_sidebar_secoes SET parent_id = ?, atualizado_em = ? WHERE parent_id = ?")
          .run(promotedParent, now, target.section_id);
        db.connection
          .prepare("UPDATE projecao_agentes SET section_id = ?, atualizado_em = ? WHERE section_id = ?")
          .run(promotedParent, now, target.section_id);
        db.connection
          .prepare("DELETE FROM projecao_sidebar_secoes WHERE section_id = ?")
          .run(target.section_id);
        break;
      }

      case "toggle_collapse": {
        const target = current.sections.find((s) => s.section_id === mutation.sectionId);
        if (!target) {
          throw new Error("Seção não encontrada.");
        }
        db.connection
          .prepare("UPDATE projecao_sidebar_secoes SET colapsada = ?, atualizado_em = ? WHERE section_id = ?")
          .run(mutation.colapsada ? 1 : 0, now, target.section_id);
        break;
      }

      case "nest_section": {
        const target = current.sections.find((s) => s.section_id === mutation.sectionId);
        if (!target) {
          throw new Error("Seção de origem não encontrada.");
        }
        const nextParentId = mutation.parentId ? String(mutation.parentId) : null;
        if (nextParentId) {
          const parent = current.sections.find((s) => s.section_id === nextParentId);
          if (!parent) {
            throw new Error("Seção pai de destino não encontrada.");
          }
          if (isDescendantOrSelf(current.sections, nextParentId, target.section_id)) {
            throw new Error("Não é permitido mover uma seção para dentro de si mesma ou de uma subseção.");
          }
          const subtreeHeight = getSubtreeHeight(current.sections, target.section_id);
          if (parent.nivel + subtreeHeight > SIDEBAR_FOLDER_LEVELS) {
            throw new Error(
              `A hierarquia resultante excede o limite de ${SIDEBAR_FOLDER_LEVELS} níveis.`,
            );
          }
        }
        ensureUniqueSiblingName(current.sections, target.nome, nextParentId, target.section_id);
        db.connection
          .prepare("UPDATE projecao_sidebar_secoes SET parent_id = ?, atualizado_em = ? WHERE section_id = ?")
          .run(nextParentId, now, target.section_id);

        const orderedIds = current.order.filter((id) => id !== target.section_id);
        if (mutation.beforeSectionId && orderedIds.includes(mutation.beforeSectionId)) {
          const idx = orderedIds.indexOf(mutation.beforeSectionId);
          orderedIds.splice(idx, 0, target.section_id);
        } else {
          orderedIds.push(target.section_id);
        }
        const updateOrdemStmt = db.connection.prepare(
          "UPDATE projecao_sidebar_secoes SET ordem = ?, atualizado_em = ? WHERE section_id = ?",
        );
        orderedIds.forEach((secId, index) => {
          updateOrdemStmt.run(index, now, secId);
        });
        break;
      }

      case "move_agent": {
        const agentRow = db.connection
          .prepare("SELECT agente_id FROM projecao_agentes WHERE agente_id = ?")
          .get(mutation.agentId) as { agente_id: string } | undefined;
        if (!agentRow) {
          throw new Error("Agente não encontrado.");
        }
        const nextSectionId = mutation.sectionId ? String(mutation.sectionId) : null;
        if (nextSectionId && !current.sections.some((s) => s.section_id === nextSectionId)) {
          throw new Error("Seção de destino não encontrada.");
        }
        db.connection
          .prepare("UPDATE projecao_agentes SET section_id = ?, atualizado_em = ? WHERE agente_id = ?")
          .run(nextSectionId, now, mutation.agentId);

        const orderedAgents = current.agentOrder.filter((id) => id !== mutation.agentId);
        if (mutation.beforeAgentId && orderedAgents.includes(mutation.beforeAgentId)) {
          const idx = orderedAgents.indexOf(mutation.beforeAgentId);
          orderedAgents.splice(idx, 0, mutation.agentId);
        } else {
          orderedAgents.push(mutation.agentId);
        }
        const updateAgentOrder = db.connection.prepare(
          "UPDATE projecao_agentes SET ordem_exibicao = ?, atualizado_em = ? WHERE agente_id = ?",
        );
        orderedAgents.forEach((id, idx) => {
          updateAgentOrder.run(idx, now, id);
        });
        break;
      }

      case "set_pin": {
        const exists = db.connection
          .prepare("SELECT agente_id FROM projecao_agentes WHERE agente_id = ?")
          .get(mutation.agentId);
        if (!exists) {
          throw new Error("Agente não encontrado.");
        }
        db.connection
          .prepare("UPDATE projecao_agentes SET pinned = ?, atualizado_em = ? WHERE agente_id = ?")
          .run(mutation.pinned ? 1 : 0, now, mutation.agentId);

        const nextPins = current.pins.filter((id) => id !== mutation.agentId);
        if (mutation.pinned) {
          nextPins.push(mutation.agentId);
        }
        writePinsOrder(db, nextPins);
        break;
      }

      case "set_hidden": {
        const exists = db.connection
          .prepare("SELECT agente_id FROM projecao_agentes WHERE agente_id = ?")
          .get(mutation.agentId);
        if (!exists) {
          throw new Error("Agente não encontrado.");
        }
        db.connection
          .prepare("UPDATE projecao_agentes SET hidden = ?, atualizado_em = ? WHERE agente_id = ?")
          .run(mutation.hidden ? 1 : 0, now, mutation.agentId);
        break;
      }

      case "reorder_pins": {
        const validPins = (mutation.pins ?? []).filter((id) => current.agentOrder.includes(id));
        writePinsOrder(db, validPins);
        break;
      }
    }

    nextRevision = bumpRevision(db);
  });

  wsHub?.broadcast("sidebar:updated", { revision: nextRevision });
  return getSidebarLayout(db);
}

function hydrateDuplicatedAgent(row: RawAgentSidebarRow): AgenteRegistro {
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
      const agentId = String(args.agentId ?? args.agent_id ?? "").trim();
      const sectionRaw = args.sectionId ?? args.section_id ?? null;
      const sectionId =
        typeof sectionRaw === "string" && sectionRaw.trim() ? sectionRaw.trim() : null;
      const beforeRaw = args.beforeAgentId ?? args.before_agent_id ?? null;
      const beforeAgentId =
        typeof beforeRaw === "string" && beforeRaw.trim() ? beforeRaw.trim() : null;
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
