import React, { useEffect, useState } from "react";
import {
  Link2,
  Loader2,
  X,
} from "lucide-react";
import type {
  StudioServerRecord,
} from "@criativo/contracts";
import { daemonApi } from "../../services/websocket-client";

export interface JoinServerModalProps {
  open: boolean;
  onClose: () => void;
  onJoined: (server: StudioServerRecord, servers: StudioServerRecord[]) => Promise<void> | void;
}

export const JoinServerModal: React.FC<JoinServerModalProps> = ({
  open,
  onClose,
  onJoined,
}) => {
  const [mode, setMode] = useState<"invite" | "direct">("invite");
  const [inviteUrl, setInviteUrl] = useState("");
  const [nome, setNome] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setErro(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const canSubmit =
    !submitting &&
    (mode === "invite"
      ? inviteUrl.trim().length > 8
      : baseUrl.trim().length > 8 && accessToken.trim().length > 8);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setErro(null);
    try {
      const res = await daemonApi.entrarEmServidor(
        mode === "invite"
          ? { invite_url: inviteUrl.trim(), nome: nome.trim() || undefined }
          : {
              nome: nome.trim() || undefined,
              base_url: baseUrl.trim(),
              access_token: accessToken.trim(),
            }
      );
      await onJoined(res.server, res.servers);
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível conectar ao servidor.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Entrar em um servidor"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[460px] bg-[#1E1E1E] border border-white/[0.1] rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.8)] p-6 text-[#F0F0F0]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/[0.08] flex items-center justify-center">
              <Link2 className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-[17px] font-semibold text-white">Entrar em um servidor</h2>
              <p className="text-[12.5px] text-[#9A9A9A]">
                Conecte uma VPS existente usando link de convite ou URL + token.
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

        {/* Abas customizadas em Carbon Dark */}
        <div className="mt-4 grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#121212] border border-white/[0.07]">
          <button
            type="button"
            onClick={() => setMode("invite")}
            className={`py-1.5 rounded-lg text-[12.5px] font-medium transition-colors ${
              mode === "invite" ? "bg-white/[0.1] text-white" : "text-[#8A8A8A] hover:text-white"
            }`}
          >
            Link de convite
          </button>
          <button
            type="button"
            onClick={() => setMode("direct")}
            className={`py-1.5 rounded-lg text-[12.5px] font-medium transition-colors ${
              mode === "direct" ? "bg-white/[0.1] text-white" : "text-[#8A8A8A] hover:text-white"
            }`}
          >
            URL + Token
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {mode === "invite" ? (
            <div>
              <label
                htmlFor="criativo-join-invite"
                className="block text-[12px] font-medium text-[#D4D4D4] mb-1"
              >
                Link de convite (criativo://join?...)
              </label>
              <input
                id="criativo-join-invite"
                type="text"
                value={inviteUrl}
                onChange={(e) => setInviteUrl(e.target.value)}
                placeholder="criativo://join?url=https%3A%2F%2F...&token=..."
                className="w-full rounded-xl bg-[#121212] border border-white/[0.14] px-3 py-2 text-[13px] text-white font-mono placeholder:text-[#666666]"
              />
            </div>
          ) : (
            <>
              <div>
                <label
                  htmlFor="criativo-join-url"
                  className="block text-[12px] font-medium text-[#D4D4D4] mb-1"
                >
                  URL do daemon remoto
                </label>
                <input
                  id="criativo-join-url"
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://studio.exemplo.com"
                  className="w-full rounded-xl bg-[#121212] border border-white/[0.14] px-3 py-2 text-[13px] text-white placeholder:text-[#666666]"
                />
              </div>
              <div>
                <label
                  htmlFor="criativo-join-token"
                  className="block text-[12px] font-medium text-[#D4D4D4] mb-1"
                >
                  Token de acesso do servidor
                </label>
                <input
                  id="criativo-join-token"
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="Cole o token secreto do servidor remoto"
                  className="w-full rounded-xl bg-[#121212] border border-white/[0.14] px-3 py-2 text-[13px] text-white placeholder:text-[#666666]"
                />
              </div>
            </>
          )}

          <div>
            <label
              htmlFor="criativo-join-alias"
              className="block text-[12px] font-medium text-[#D4D4D4] mb-1"
            >
              Apelido nesta máquina (opcional)
            </label>
            <input
              id="criativo-join-alias"
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: VPS Agência Principal"
              className="w-full rounded-xl bg-[#121212] border border-white/[0.14] px-3 py-2 text-[13px] text-white placeholder:text-[#666666]"
            />
          </div>

          {erro && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 text-[12.5px] text-red-200">
              {erro}
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-[13px] font-medium text-[#CCCCCC] hover:text-white"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-4 py-2 rounded-xl bg-[#F0F0F0] hover:bg-white text-[#0D0D0D] text-[13px] font-semibold disabled:opacity-40 flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Conectar servidor
          </button>
        </div>
      </form>
    </div>
  );
};

/* ============================================================================
 * MODAL 4: Configurações do servidor
 * ============================================================================ */
