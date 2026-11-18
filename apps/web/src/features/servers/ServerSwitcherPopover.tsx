import React, { useState } from "react";
import {
  AppWindow,
  Check,
  ChevronRight,
  Link2,
  Monitor,
  Plus,
  Server,
} from "lucide-react";
import type { ServerQuotaSummary, StudioServerRecord } from "@criativo/contracts";

export interface ServerSwitcherPopoverProps {
  open: boolean;
  servers: StudioServerRecord[];
  activeServerId: string;
  quota: ServerQuotaSummary | null;
  onClose: () => void;
  onSelectServer: (serverId: string) => void;
  onOpenNewLocalModal: () => void;
  onOpenNewRemoteModal: () => void;
  onOpenJoinModal: () => void;
  onOpenServerSettings: (server: StudioServerRecord) => void;
  onOpenDisplaySettings?: () => void;
  initialAddSubmenuOpen?: boolean;
}

function getStatusDotClass(status: StudioServerRecord["status"]): string {
  switch (status) {
    case "online":
      return "bg-[#31CF76]";
    case "starting":
      return "bg-[#FF9412]";
    case "error":
      return "bg-[#FF5A5F]";
    default:
      return "bg-[#6A6A6A]";
  }
}

export function formatServerQuotaBadge(quota: ServerQuotaSummary | null): string {
  if (!quota) return "";
  if (quota.max_servers < 0) {
    return `${quota.servers_used} · Ilimitado`;
  }
  return `${quota.servers_used} de ${quota.max_servers}`;
}

export const ServerSwitcherPopover: React.FC<ServerSwitcherPopoverProps> = ({
  open,
  servers,
  activeServerId,
  quota,
  onClose,
  onSelectServer,
  onOpenNewLocalModal,
  onOpenNewRemoteModal,
  onOpenJoinModal,
  onOpenServerSettings,
  onOpenDisplaySettings,
  initialAddSubmenuOpen = false,
}) => {
  const [addMenuOpen, setAddMenuOpen] = useState(initialAddSubmenuOpen);

  if (!open) return null;

  const activeServer =
    servers.find((s) => s.server_id === activeServerId) ?? servers[0] ?? null;
  const quotaLabel = formatServerQuotaBadge(quota);

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        aria-hidden="true"
        onClick={() => {
          setAddMenuOpen(false);
          onClose();
        }}
      />

      <div
        role="dialog"
        aria-label="Seletor de servidores"
        className="fixed bottom-3 left-[60px] z-50 w-[290px] bg-[#181818] border border-white/[0.1] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.75)] text-[#F0F0F0] select-none"
      >
        <div className="px-3.5 pt-3 pb-1.5 flex items-center justify-between gap-2">
          <span className="text-[12px] font-medium text-[#8E8E8E]">Servidores</span>
          {quotaLabel && (
            <span className="text-[10.5px] font-medium px-1.5 py-0.5 rounded-md bg-white/[0.06] text-[#A8A8A8]">
              {quotaLabel}
            </span>
          )}
        </div>

        <div className="px-1.5 pb-1.5 space-y-0.5 max-h-[240px] overflow-y-auto">
          {servers.map((srv) => {
            const isActive = srv.server_id === activeServerId;
            return (
              <button
                key={srv.server_id}
                type="button"
                onClick={() => {
                  setAddMenuOpen(false);
                  onSelectServer(srv.server_id);
                  onClose();
                }}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-colors ${
                  isActive
                    ? "bg-white/[0.07] text-white"
                    : "text-[#D4D4D4] hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                <span className="w-4 h-4 shrink-0 flex items-center justify-center">
                  {isActive ? (
                    <span className="w-4 h-4 rounded-full bg-white text-[#0D0D0D] flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                    </span>
                  ) : (
                    <span className={`w-1.5 h-1.5 rounded-full ${getStatusDotClass(srv.status)}`} />
                  )}
                </span>

                <span
                  className="w-5 h-5 rounded-[6px] shrink-0 shadow-inner flex items-center justify-center text-[10px] font-bold text-[#0D0D0D]"
                  style={{ backgroundColor: srv.cor_hex || "#E88B2D" }}
                >
                  {srv.nome.trim().slice(0, 1).toUpperCase() || "S"}
                </span>

                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="text-[13px] font-medium truncate leading-tight">
                    {srv.nome}
                  </span>
                  {srv.kind !== "primary" && (
                    <span className="text-[10px] text-[#7D7D7D] truncate leading-tight">
                      {srv.kind === "local_child"
                        ? "Local"
                        : srv.kind === "remote_vps"
                          ? srv.remote_ip
                            ? `VPS · ${srv.remote_ip}`
                            : "VPS Remota"
                          : "Conectado"}
                    </span>
                  )}
                </span>

                {isActive && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${getStatusDotClass(srv.status)}`}
                    title={`Status: ${srv.status}`}
                  />
                )}

                <ChevronRight className="w-3.5 h-3.5 text-[#7A7A7A] shrink-0" />
              </button>
            );
          })}

          <div className="relative">
            <button
              type="button"
              onClick={() => setAddMenuOpen((prev) => !prev)}
              aria-expanded={addMenuOpen}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-[13px] font-medium transition-colors ${
                addMenuOpen
                  ? "bg-white/[0.08] text-white"
                  : "text-[#EAEAEA] hover:bg-white/[0.05] hover:text-white"
              }`}
            >
              <span className="w-4 h-4 rounded-full border border-dashed border-white/45 flex items-center justify-center shrink-0">
                <Plus className="w-2.5 h-2.5 text-white/85" />
              </span>
              <span className="flex-1 truncate">Adicionar servidor</span>
              <ChevronRight className="w-3.5 h-3.5 text-[#7A7A7A] shrink-0" />
            </button>

            {addMenuOpen && (
              <div
                role="menu"
                aria-label="Opções de adição de servidor"
                className="sm:absolute sm:left-[calc(100%+8px)] sm:top-[-6px] mt-1.5 sm:mt-0 w-full sm:w-[272px] bg-[#1A1A1A] border border-white/[0.1] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.85)] p-1.5 space-y-0.5 z-50"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAddMenuOpen(false);
                    onClose();
                    onOpenNewLocalModal();
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-[13px] text-[#EDEDED] hover:bg-white/[0.07] hover:text-white transition-colors"
                >
                  <Monitor className="w-4 h-4 text-[#A5A5A5] shrink-0" />
                  <span className="truncate">Novo servidor neste computador</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAddMenuOpen(false);
                    onClose();
                    onOpenNewRemoteModal();
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-[13px] text-[#EDEDED] hover:bg-white/[0.07] hover:text-white transition-colors"
                >
                  <Server className="w-4 h-4 text-[#A5A5A5] shrink-0" />
                  <span className="truncate">Novo servidor em outro computador</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAddMenuOpen(false);
                    onClose();
                    onOpenJoinModal();
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-[13px] text-[#EDEDED] hover:bg-white/[0.07] hover:text-white transition-colors"
                >
                  <Link2 className="w-4 h-4 text-[#A5A5A5] shrink-0" />
                  <span className="truncate">Entrar em um servidor</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-white/[0.08] p-1.5">
          <button
            type="button"
            disabled={!activeServer}
            onClick={() => {
              if (!activeServer) return;
              setAddMenuOpen(false);
              onClose();
              onOpenServerSettings(activeServer);
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-[13px] font-medium text-[#EAEAEA] hover:bg-white/[0.05] hover:text-white disabled:opacity-40 transition-colors"
          >
            <Server className="w-4 h-4 text-[#A5A5A5] shrink-0" />
            <span className="flex-1 truncate">Configurações do servidor</span>
          </button>
        </div>

        <div className="border-t border-white/[0.08] p-1.5">
          <button
            type="button"
            onClick={() => {
              setAddMenuOpen(false);
              onClose();
              onOpenDisplaySettings?.();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-[13px] font-medium text-[#EAEAEA] hover:bg-white/[0.05] hover:text-white transition-colors"
          >
            <AppWindow className="w-4 h-4 text-[#A5A5A5] shrink-0" />
            <span className="flex-1 truncate">Exibição</span>
            <span className="text-[12px] text-[#7D7D7D]">Menu</span>
            <ChevronRight className="w-3.5 h-3.5 text-[#7A7A7A] shrink-0" />
          </button>
        </div>
      </div>
    </>
  );
};
