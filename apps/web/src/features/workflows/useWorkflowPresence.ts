import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowPresenceMember } from "@criativo/contracts";
import { workflowsRoutinesApi } from "../../services/api/workflows-routines-api";
import { subscribeWsEvent } from "../../services/ws-transport";
import { resolveCollaboratorColor } from "./WorkflowCollaborativeCursors";

export const WORKFLOW_PRESENCE_HEARTBEAT_MS = 15_000;
export const WORKFLOW_CURSOR_THROTTLE_MS = 120;
const SESSION_MEMBER_ID_KEY = "criativo.workflow.presence_member_id";

function resolveSessionMemberId(): string {
  if (typeof window === "undefined") {
    return "owner";
  }
  try {
    const existing = window.sessionStorage.getItem(SESSION_MEMBER_ID_KEY);
    if (existing && existing.trim()) {
      return existing;
    }
    const generated = `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    window.sessionStorage.setItem(SESSION_MEMBER_ID_KEY, generated);
    return generated;
  } catch {
    return "owner";
  }
}

export interface CollaboratorNodeSelection {
  memberId: string;
  displayName: string;
  color: string;
}

/**
 * Gerencia presença colaborativa em tempo real no canvas de workflows:
 * escuta `workflow:presence`, envia heartbeat a cada 15s e publica cursor/nó selecionado
 * com throttle de 120ms.
 */
export function useWorkflowPresence({
  workflowId,
  selectedNodeId,
  enabled = true,
}: {
  workflowId: string | null;
  selectedNodeId: string | null;
  enabled?: boolean;
}) {
  const [localMemberId] = useState<string>(() => resolveSessionMemberId());
  const [members, setMembers] = useState<WorkflowPresenceMember[]>([]);

  const selectedNodeRef = useRef<string | null>(selectedNodeId);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const lastEmitAtRef = useRef<number>(0);
  const throttleTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    selectedNodeRef.current = selectedNodeId;
  }, [selectedNodeId]);

  const pushPresence = useCallback(
    (action: "join" | "heartbeat", overrideNodeId?: string | null) => {
      if (!workflowId || !enabled) return;
      const nodeId = overrideNodeId !== undefined ? overrideNodeId : selectedNodeRef.current;
      const cursor = cursorRef.current;
      lastEmitAtRef.current = Date.now();
      void workflowsRoutinesApi
        .updateWorkflowPresence(workflowId, action, {
          memberId: localMemberId,
          selectedNodeId: nodeId,
          cursorX: cursor ? cursor.x : null,
          cursorY: cursor ? cursor.y : null,
        })
        .then((nextMembers) => {
          if (mountedRef.current) {
            setMembers(nextMembers);
          }
        })
        .catch(() => {});
    },
    [enabled, localMemberId, workflowId]
  );

  useEffect(() => {
    if (!workflowId || !enabled) {
      setMembers([]);
      return;
    }

    let active = true;
    const unsub = subscribeWsEvent("workflow:presence", (evt) => {
      if (active && evt.workflowId === workflowId) {
        setMembers(evt.members);
      }
    });

    pushPresence("join");

    const heartbeatId = window.setInterval(() => {
      if (active) {
        pushPresence("heartbeat");
      }
    }, WORKFLOW_PRESENCE_HEARTBEAT_MS);

    return () => {
      active = false;
      unsub();
      window.clearInterval(heartbeatId);
      if (throttleTimerRef.current !== null) {
        window.clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      void workflowsRoutinesApi
        .updateWorkflowPresence(workflowId, "leave", { memberId: localMemberId })
        .catch(() => {});
    };
  }, [enabled, localMemberId, pushPresence, workflowId]);

  const reportSelectedNode = useCallback(
    (nodeId: string | null) => {
      selectedNodeRef.current = nodeId;
      if (!workflowId || !enabled) return;
      if (throttleTimerRef.current !== null) {
        window.clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      pushPresence("heartbeat", nodeId);
    },
    [enabled, pushPresence, workflowId]
  );

  useEffect(() => {
    if (!workflowId || !enabled) return;
    reportSelectedNode(selectedNodeId);
  }, [enabled, reportSelectedNode, selectedNodeId, workflowId]);

  const reportCursor = useCallback(
    (worldX: number, worldY: number) => {
      if (!workflowId || !enabled) return;
      if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return;
      cursorRef.current = { x: Math.round(worldX), y: Math.round(worldY) };

      const elapsed = Date.now() - lastEmitAtRef.current;
      if (elapsed >= WORKFLOW_CURSOR_THROTTLE_MS) {
        if (throttleTimerRef.current !== null) {
          window.clearTimeout(throttleTimerRef.current);
          throttleTimerRef.current = null;
        }
        pushPresence("heartbeat");
        return;
      }

      if (throttleTimerRef.current === null) {
        const remaining = Math.max(0, WORKFLOW_CURSOR_THROTTLE_MS - elapsed);
        throttleTimerRef.current = window.setTimeout(() => {
          throttleTimerRef.current = null;
          pushPresence("heartbeat");
        }, remaining);
      }
    },
    [enabled, pushPresence, workflowId]
  );

  const remoteMembers = useMemo(
    () => members.filter((member) => member.memberId !== localMemberId),
    [localMemberId, members]
  );

  const collaboratorByNodeId = useMemo(() => {
    const map = new Map<string, CollaboratorNodeSelection>();
    for (const member of remoteMembers) {
      if (!member.selectedNodeId) continue;
      if (!map.has(member.selectedNodeId)) {
        map.set(member.selectedNodeId, {
          memberId: member.memberId,
          displayName: member.displayName,
          color: resolveCollaboratorColor(member.memberId),
        });
      }
    }
    return map;
  }, [remoteMembers]);

  return {
    localMemberId,
    members,
    remoteMembers,
    collaboratorByNodeId,
    reportCursor,
    reportSelectedNode,
  };
}
