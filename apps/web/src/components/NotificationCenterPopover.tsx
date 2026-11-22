import React, { useMemo, useState } from "react";
import type { StudioNotificationItem } from "@criativo/contracts";
import { Bell, CheckCheck, Trash2 } from "lucide-react";

export const STUDIO_NOTIFICATIONS_STORAGE_KEY = "criativo.notifications.history.v1";
const MAX_STORED_NOTIFICATIONS = 100;

export function loadStoredNotifications(): StudioNotificationItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STUDIO_NOTIFICATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_STORED_NOTIFICATIONS) : [];
  } catch {
    return [];
  }
}

export function saveStoredNotifications(items: StudioNotificationItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STUDIO_NOTIFICATIONS_STORAGE_KEY,
      JSON.stringify(items.slice(0, MAX_STORED_NOTIFICATIONS))
    );
  } catch {
    // ignora erro de quota do storage
  }
}

export interface NotificationCenterPopoverProps {
  items: StudioNotificationItem[];
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onSelectNotification?: (item: StudioNotificationItem) => void;
}

export const NotificationCenterPopover: React.FC<NotificationCenterPopoverProps> = ({
  items,
  onMarkAllRead,
  onClearAll,
  onSelectNotification,
}) => {
  const [open, setOpen] = useState(false);
  const unreadCount = useMemo(() => items.filter((i) => !i.read).length, [items]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Central de notificações"
        title="Central de notificações"
        className="relative flex h-[28px] w-[28px] items-center justify-center rounded-full border border-white/10 bg-[#212121] text-[#DCDCDC] hover:bg-[#2A2A2A] hover:text-white transition-colors"
      >
        <Bell className="h-3.5 w-3.5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#31CF76] px-1 text-[9.5px] font-bold text-[#0D0D0D]">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Histórico de notificações"
          className="absolute right-0 top-9 z-50 w-80 overflow-hidden rounded-2xl border border-white/10 bg-[#141414] text-[#F0F0F0] shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#0D0D0D] px-3.5 py-2.5">
            <span className="text-xs font-semibold text-white">
              Notificações ({unreadCount} não lida{unreadCount === 1 ? "" : "s"})
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="Marcar todas como lidas"
                onClick={onMarkAllRead}
                className="rounded-lg p-1 text-[#979797] hover:bg-[#212121] hover:text-[#31CF76]"
              >
                <CheckCheck className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Limpar histórico"
                onClick={onClearAll}
                className="rounded-lg p-1 text-[#979797] hover:bg-[#212121] hover:text-[#FD2F3B]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-white/[0.05]">
            {items.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-[#6A6A6A]">
                Nenhuma notificação recente registrada.
              </div>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectNotification?.(item);
                    setOpen(false);
                  }}
                  className={`w-full px-3.5 py-2.5 text-left transition-colors hover:bg-[#1B1B1B] ${
                    item.read ? "opacity-75" : "bg-[#19241E]/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-white">
                      {item.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-[#6A6A6A]">
                      {new Date(item.createdAt).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-[#979797]">{item.body}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
