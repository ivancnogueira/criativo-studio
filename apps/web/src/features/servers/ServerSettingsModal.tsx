import React, { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Monitor,
  Palette,
  RefreshCw,
  Server,
  Trash2,
  X,
} from "lucide-react";
import type {
  ServerInviteToken,
  StudioServerRecord,
} from "@criativo/contracts";
import { daemonApi } from "../../services/websocket-client";
import { StudioColorPicker } from "../../components/StudioColorPicker";
import { TeamManagementModal } from "./TeamManagementModal";
import { InstanceTransferModal } from "./InstanceTransferModal";
import {
  SERVER_ACCENT_COLORS,
  copyTextToClipboard,
} from "./server-modals-helpers";

export interface ServerSettingsModalProps {
  open: boolean;
  server: StudioServerRecord | null;
  onClose: () => void;
  onUpdated: (servers: StudioServerRecord[], updated: StudioServerRecord) => Promise<void> | void;
  onRemoved: (servers: StudioServerRecord[], nextActiveServerId: string) => Promise<void> | void;
}

export const ServerSettingsModal: React.FC<ServerSettingsModalProps> = ({
  open,
  server,
  onClose,
  onUpdated,
  onRemoved,
}) => {
  const [nome, setNome] = useState(server?.nome ?? "");
  const [corHex, setCorHex] = useState(server?.cor_hex ?? SERVER_ACCENT_COLORS[0].hex);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [invite, setInvite] = useState<ServerInviteToken | null>(null);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (open && server) {
      setNome(server.nome);
      setCorHex(server.cor_hex || SERVER_ACCENT_COLORS[0].hex);
      setColorPickerOpen(false);
      setInvite(null);
      setDeleteFiles(false);
      setErro(null);
    }
  }, [open, server]);

  if (!open || !server) return null;

  const isPrimary = server.server_id === "primary" || server.kind === "primary";

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim() || saving) return;
    setSaving(true);
    setErro(null);
    try {
      const res = await daemonApi.atualizarServidor(server.server_id, {
        nome: nome.trim(),
        cor_hex: corHex,
      });
      await onUpdated(res.servers, res.server);
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao salvar configurações do servidor.");
    } finally {
      setSaving(false);
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    setErro(null);
    try {
      await daemonApi.reiniciarServidor(server.server_id);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao reiniciar servidor.");
    } finally {
      setRestarting(false);
    }
  };

  const handleGenerateInvite = async () => {
    setErro(null);
    try {
      const inv = await daemonApi.gerarConviteServidor(server.server_id);
      setInvite(inv);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao gerar convite.");
    }
  };

  const handleRemove = async () => {
    if (isPrimary || removing) return;
    setRemoving(true);
    setErro(null);
    try {
      const res = await daemonApi.removerServidor(server.server_id, deleteFiles);
      await onRemoved(res.servers, res.active_server_id);
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao remover servidor.");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Configurações do servidor"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-[490px] bg-[#1E1E1E] border border-white/[0.1] rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.85)] p-6 text-[#F0F0F0] max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center text-[14px] font-bold text-[#0D0D0D]"
              style={{ backgroundColor: corHex }}
            >
              {nome.trim().slice(0, 1).toUpperCase() || "S"}
            </span>
            <div>
              <h2 className="text-[17px] font-semibold text-white">Configurações do servidor</h2>
              <p className="text-[12px] text-[#9A9A9A] flex items-center gap-1.5">
                {server.kind === "local_child" || server.kind === "primary" ? (
                  <Monitor className="w-3.5 h-3.5" />
                ) : (
                  <Server className="w-3.5 h-3.5" />
                )}
                <span>
                  {server.kind === "primary"
                    ? "Servidor Principal Local"
                    : server.kind === "local_child"
                      ? `Servidor Local · Porta ${server.port ?? "--"}`
                      : server.remote_ip
                        ? `VPS Remota · ${server.remote_ip}`
                        : "Servidor Remoto"}
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar modal"
            className="text-[#8E8E8E] hover:text-white p-1 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="criativo-settings-server-name"
              className="block text-[12px] font-medium text-[#D4D4D4] mb-1"
            >
              Nome exibido
            </label>
            <input
              id="criativo-settings-server-name"
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="w-full rounded-xl bg-[#121212] border border-white/[0.14] px-3.5 py-2 text-[13.5px] text-white"
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="block text-[12px] font-medium text-[#A8A8A8]">
                Cor do ícone na barra lateral
              </span>
              <button
                type="button"
                aria-expanded={colorPickerOpen}
                onClick={() => setColorPickerOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#141414] hover:border-white/25 px-2 py-1 text-[11.5px] font-mono text-[#E5E5E5] transition-colors"
              >
                <span
                  className="h-3 w-3 rounded-full border border-white/20"
                  style={{ backgroundColor: corHex }}
                />
                <span>{corHex.toUpperCase()}</span>
                <Palette className="h-3 w-3 text-[#9A9A9A]" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {SERVER_ACCENT_COLORS.slice(0, 6).map((item) => {
                const selected = corHex.toUpperCase() === item.hex.toUpperCase();
                return (
                  <button
                    key={item.hex}
                    type="button"
                    onClick={() => setCorHex(item.hex)}
                    aria-label={`Selecionar cor ${item.label}`}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                      selected ? "ring-2 ring-white scale-105" : "opacity-75 hover:opacity-100"
                    }`}
                    style={{ backgroundColor: item.hex }}
                  >
                    {selected && <Check className="w-3.5 h-3.5 text-[#0D0D0D] stroke-[3]" />}
                  </button>
                );
              })}
              <button
                type="button"
                aria-label="Abrir seletor de cor personalizado do servidor"
                onClick={() => setColorPickerOpen((v) => !v)}
                className="px-2.5 h-7 rounded-lg border border-white/[0.12] bg-[#141414] hover:border-white/30 text-[11.5px] font-medium text-[#DCDCDC] flex items-center gap-1.5 transition-colors"
              >
                <Palette className="w-3.5 h-3.5 text-[#31CF76]" />
                <span>{colorPickerOpen ? "Fechar cores" : "Mais cores"}</span>
              </button>
            </div>
            {colorPickerOpen && (
              <div className="mt-2.5">
                <StudioColorPicker
                  value={corHex}
                  onChange={setCorHex}
                  swatches={SERVER_ACCENT_COLORS}
                  ariaLabelPrefix="Cor do servidor"
                />
              </div>
            )}
          </div>

          <div className="rounded-xl bg-[#141414] border border-white/[0.06] p-3 text-[12px] text-[#9A9A9A] space-y-1">
            <div>
              <span className="text-[#6E6E6E]">Endpoint:</span>{" "}
              <span className="text-[#D4D4D4] font-mono">{server.base_url}</span>
            </div>
            {server.workspace_path && (
              <div className="truncate">
                <span className="text-[#6E6E6E]">Workspace:</span>{" "}
                <span className="text-[#D4D4D4] font-mono">{server.workspace_path}</span>
              </div>
            )}
          </div>

          {/* Convite rápido */}
          {server.kind !== "primary" && (
            <div className="rounded-xl bg-[#141414] border border-white/[0.08] p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-medium text-white">Convite de conexão</span>
                <button
                  type="button"
                  onClick={() => void handleGenerateInvite()}
                  className="text-[12px] font-medium px-2.5 py-1 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-white"
                >
                  Gerar convite
                </button>
              </div>
              {invite && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={invite.invite_url}
                    className="flex-1 rounded-lg bg-[#0D0D0D] border border-white/[0.1] px-2.5 py-1.5 text-[11.5px] font-mono text-[#D0D0D0]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void copyTextToClipboard(invite.invite_url).then((ok) => {
                        if (!ok) return;
                        setCopiedInvite(true);
                        window.setTimeout(() => setCopiedInvite(false), 2000);
                      });
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.16] text-[12px] text-white flex items-center gap-1"
                  >
                    {copiedInvite ? <Check className="w-3.5 h-3.5 text-[#31CF76]" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedInvite ? "Copiado" : "Copiar"}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => setTeamModalOpen(true)}
              className="flex-1 rounded-xl border border-white/10 bg-[#141414] hover:bg-white/[0.06] px-3 py-2 text-[12px] font-medium text-white"
            >
              Equipe, RBAC & Auditoria
            </button>
            <button
              type="button"
              onClick={() => setTransferModalOpen(true)}
              className="flex-1 rounded-xl border border-white/10 bg-[#141414] hover:bg-white/[0.06] px-3 py-2 text-[12px] font-medium text-white"
            >
              Migrar / Transferir Instância
            </button>
          </div>

          {erro && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 text-[12.5px] text-red-200">
              {erro}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            {server.kind === "local_child" ? (
              <button
                type="button"
                disabled={restarting}
                onClick={() => void handleRestart()}
                className="px-3 py-2 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] text-[12.5px] font-medium text-white flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${restarting ? "animate-spin" : ""}`} />
                Reiniciar processo
              </button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-xl text-[13px] font-medium text-[#CCCCCC] hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving || nome.trim().length < 2}
                className="px-4 py-2 rounded-xl bg-[#F0F0F0] hover:bg-white text-[#0D0D0D] text-[13px] font-semibold disabled:opacity-40"
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </form>

        {!isPrimary && (
          <div className="mt-5 pt-4 border-t border-white/[0.08] space-y-2.5">
            {server.kind === "local_child" && (
              <label className="flex items-center gap-2 text-[12px] text-[#A8A8A8] cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteFiles}
                  onChange={(e) => setDeleteFiles(e.target.checked)}
                  className="rounded border-white/20 bg-[#121212]"
                />
                <span>Excluir também a pasta local de dados deste servidor</span>
              </label>
            )}
            <button
              type="button"
              disabled={removing}
              onClick={() => void handleRemove()}
              className="w-full py-2 rounded-xl border border-red-500/35 bg-red-500/10 hover:bg-red-500/20 text-red-200 text-[12.5px] font-medium flex items-center justify-center gap-2"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{removing ? "Removendo..." : "Remover conexão deste servidor"}</span>
            </button>
          </div>
        )}
      </div>
      <TeamManagementModal
        open={teamModalOpen}
        serverName={server.nome}
        onClose={() => setTeamModalOpen(false)}
      />
      <InstanceTransferModal
        open={transferModalOpen}
        onClose={() => setTransferModalOpen(false)}
      />
    </div>
  );
};
