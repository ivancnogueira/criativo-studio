/**
 * Serviço de organização hierárquica da Sidebar, Drag-and-Drop, Pins, Ocultação,
 * Duplicação de Agentes com 1 clique e 5 ferramentas de IA (UX-02 / D-05).
 */
import { randomUUID } from "node:crypto";
import type {
  SidebarLayoutMutation,
  SidebarLayoutSnapshot,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import type {
  WebSocketHub,
} from "./websocket-hub.ts";
import { SIDEBAR_FOLDER_LEVELS, SIDEBAR_MAX_SECTIONS, readRevision, bumpRevision, readPinsOrder, writePinsOrder, computeSectionLevels, getSubtreeHeight, isDescendantOrSelf, ensureUniqueSiblingName, type RawSectionRow } from "./sidebar-helpers.ts";

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

