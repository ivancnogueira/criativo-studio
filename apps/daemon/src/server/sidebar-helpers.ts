/**
 * Serviço de organização hierárquica da Sidebar, Drag-and-Drop, Pins, Ocultação,
 * Duplicação de Agentes com 1 clique e 5 ferramentas de IA (UX-02 / D-05).
 */
import { randomUUID } from "node:crypto";
import type {
  SidebarSectionNode,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";

export const SIDEBAR_FOLDER_LEVELS = 3;
export const SIDEBAR_MAX_SECTIONS = 40;

export const CONFIG_KEY_REVISION = "sidebar_layout_revision";
export const CONFIG_KEY_PINS_ORDER = "sidebar_pins_order";

export interface RawSectionRow {
  section_id: string;
  nome: string;
  parent_id: string | null;
  ordem: number;
  colapsada: number;
  criado_em: string;
  atualizado_em: string;
}

export interface RawAgentSidebarRow {
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

export function readRevision(db: CriativoDatabase): number {
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

export function bumpRevision(db: CriativoDatabase): number {
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

export function readPinsOrder(db: CriativoDatabase): string[] {
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

export function writePinsOrder(db: CriativoDatabase, pins: string[]): void {
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

export function computeSectionLevels(rows: RawSectionRow[]): SidebarSectionNode[] {
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

export function getSubtreeHeight(sections: SidebarSectionNode[], rootId: string): number {
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

export function isDescendantOrSelf(
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

export function ensureUniqueSiblingName(
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

