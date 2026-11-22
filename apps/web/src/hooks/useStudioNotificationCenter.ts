import { useCallback, useEffect, useState } from "react";
import type { NativeNotificationLevel, StudioNotificationItem } from "@criativo/contracts";
import {
  loadStoredNotifications,
  saveStoredNotifications,
} from "../components/NotificationCenterPopover";
import { getCriativoDesktopBridge } from "../types/desktop-bridge";

function shouldEmitNative(level: NativeNotificationLevel, kind: StudioNotificationItem["kind"]): boolean {
  if (level === "muted") return false;
  if (level === "approvals_only") return kind === "approval";
  if (level === "errors_only") return kind === "error";
  return true;
}

export function useStudioNotificationCenter(options: {
  nativeLevel?: NativeNotificationLevel;
  onSelectAgent?: (agentId: string) => void;
}) {
  const [items, setItems] = useState<StudioNotificationItem[]>(() => loadStoredNotifications());

  const pushNotification = useCallback(
    (input: Omit<StudioNotificationItem, "id" | "createdAt" | "read">) => {
      const nextItem: StudioNotificationItem = {
        ...input,
        id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: new Date().toISOString(),
        read: false,
      };
      setItems((prev) => {
        const updated = [nextItem, ...prev].slice(0, 100);
        saveStoredNotifications(updated);
        return updated;
      });

      const level = options.nativeLevel ?? "all";
      const isHidden = typeof document !== "undefined" ? document.hidden : false;
      if (isHidden && shouldEmitNative(level, input.kind)) {
        void getCriativoDesktopBridge()?.notifyNative?.({
          id: nextItem.id,
          kind: nextItem.kind,
          title: nextItem.title,
          body: nextItem.body,
          agentId: nextItem.agentId ?? null,
        });
      }
    },
    [options.nativeLevel]
  );

  const markAllRead = useCallback(() => {
    setItems((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      saveStoredNotifications(updated);
      return updated;
    });
  }, []);

  const clearAll = useCallback(() => {
    setItems([]);
    saveStoredNotifications([]);
  }, []);

  useEffect(() => {
    const bridge = getCriativoDesktopBridge();
    if (!bridge?.onNotificationClicked) return;
    return bridge.onNotificationClicked((payload) => {
      if (payload.agentId && options.onSelectAgent) {
        options.onSelectAgent(payload.agentId);
      }
    });
  }, [options.onSelectAgent]);

  return {
    notifications: items,
    pushNotification,
    markAllRead,
    clearAll,
  };
}
