import React, { useState } from "react";
import type {
  BrowserProfileInfo,
  BrowserProfileProxyPayload,
  BrowserProxyConfig,
  BrowserProxyProtocol,
} from "@criativo/contracts";
import {
  Check,
  ExternalLink,
  Globe,
  MoreHorizontal,
  Pencil,
  Plug,
  Plus,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import { daemonApi } from "../../services/websocket-client";

export const BROWSER_PROFILE_PALETTE = [
  "#42A0FF",
  "#31CF76",
  "#FF9412",
  "#FD2F3B",
  "#A855F7",
  "#EC4899",
  "#14B8A6",
  "#EAB308",
] as const;

export interface BrowserProxyDialogProps {
  open: boolean;
  profileName: string;
  tabCount: number;
  currentProxy?: BrowserProfileProxyPayload;
  proxies: BrowserProxyConfig[];
  onClose: () => void;
  onApplyProxy: (proxyPayload: BrowserProfileProxyPayload | null) => void | Promise<void>;
  onSaveProxyPreset: (input: {
    nome: string;
    servidor: string;
    usuario?: string | null;
    senha?: string | null;
  }) => Promise<BrowserProxyConfig>;
  onDeleteProxyPreset: (proxyId: string) => void | Promise<void>;
}

export function BrowserProxyDialog({
  open,
  profileName,
  tabCount,
  currentProxy,
  proxies,
  onClose,
  onApplyProxy,
  onSaveProxyPreset,
  onDeleteProxyPreset,
}: BrowserProxyDialogProps) {
  const [protocol, setProtocol] = useState<BrowserProxyProtocol>("http");
  const [nome, setNome] = useState("");
  const [hostPort, setHostPort] = useState(
    currentProxy?.server?.replace(/^(https?|socks5):\/\//i, "") ?? ""
  );
  const [usuario, setUsuario] = useState(currentProxy?.username ?? "");
  const [senha, setSenha] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanHost = hostPort.trim().replace(/^(https?|socks5):\/\//i, "");
    if (!cleanHost) {
      setErrorMsg("Informe host:porta do servidor proxy.");
      return;
    }
    setErrorMsg(null);
    setSaving(true);
    try {
      const serverUrl = `${protocol}://${cleanHost}`;
      const saved = await onSaveProxyPreset({
        nome: nome.trim() || `Proxy ${cleanHost}`,
        servidor: serverUrl,
        usuario: usuario.trim() || null,
        senha: senha.trim() || null,
      });
      setSenha("");
      await onApplyProxy({
        proxy_id: saved.proxy_id,
        server: saved.servidor,
        username: saved.usuario ?? null,
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Falha ao aplicar proxy.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-[16px]">
      <div className="flex max-h-[85vh] w-full max-w-[520px] flex-col overflow-hidden rounded-xl border border-white/[0.06] bg-[#212121] shadow-2xl">
        <div className="flex h-[48px] shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#0D0D0D] px-[16px]">
          <div className="flex items-center gap-[8px]">
            <Shield size={16} className="text-[#42A0FF]" />
            <h3 className="text-[14px] font-semibold text-[#F0F0F0]">
              Configurar proxy — {profileName}
            </h3>
          </div>
          <button
            type="button"
            aria-label="Fechar janela"
            onClick={onClose}
            className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-[#979797] hover:bg-[#2A2A2A] hover:text-[#F0F0F0]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 space-y-[16px] overflow-y-auto p-[16px]">
          {tabCount > 0 && (
            <p className="rounded-lg border border-[#FF9412]/30 bg-[#FF9412]/10 px-3 py-2 text-[12px] text-[#FF9412]">
              A alteração de proxy fechará {tabCount} {tabCount === 1 ? "aba ativa" : "abas ativas"}{" "}
              deste perfil para aplicar o túnel com segurança.
            </p>
          )}

          {proxies.length > 0 && (
            <div className="space-y-[8px]">
              <p className="text-[12px] font-semibold text-[#979797]">Proxies salvos no Cofre</p>
              <div className="space-y-1.5">
                {proxies.map((px) => {
                  const isCurrent = currentProxy?.proxy_id === px.proxy_id;
                  return (
                    <div
                      key={px.proxy_id}
                      className="flex items-center justify-between gap-[8px] rounded-lg border border-white/[0.06] bg-[#1A1A1A] px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold text-[#F0F0F0]">
                          {px.nome}
                        </p>
                        <p className="truncate font-mono text-[12px] text-[#979797]">
                          {px.servidor}
                          {px.senha_configurada ? " · Senha cifrada no Cofre" : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={async () => {
                            await onApplyProxy({
                              proxy_id: px.proxy_id,
                              server: px.servidor,
                              username: px.usuario ?? null,
                            });
                            onClose();
                          }}
                          className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold transition ${
                            isCurrent
                              ? "bg-[#007CF7] text-white"
                              : "bg-[#2A2A2A] text-[#F0F0F0] hover:bg-[#333333]"
                          }`}
                        >
                          {isCurrent ? "Vinculado" : "Aplicar proxy"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeleteProxyPreset(px.proxy_id)}
                          aria-label="Remover proxy"
                          title="Remover proxy"
                          className="rounded-lg bg-[#2A2A2A] px-2 py-1 text-[12px] font-semibold text-[#FD2F3B] hover:bg-[#333333]"
                        >
                          Remover proxy
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <form onSubmit={(e) => void handleSubmitNew(e)} className="space-y-[12px]">
            <p className="text-[12px] font-semibold text-[#979797]">Adicionar novo proxy</p>

            <div className="flex items-center gap-1 rounded-lg bg-[#141414] p-1">
              {(["http", "https", "socks5"] as const).map((proto) => (
                <button
                  key={proto}
                  type="button"
                  onClick={() => setProtocol(proto)}
                  className={`flex-1 rounded-md py-1.5 text-[12px] font-semibold uppercase transition ${
                    protocol === proto
                      ? "bg-[#2A2A2A] text-[#F0F0F0]"
                      : "text-[#979797] hover:text-[#F0F0F0]"
                  }`}
                >
                  {proto}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2">
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Nome (ex.: Residencial BR)"
                className="rounded-lg border border-white/[0.06] bg-[#141414] px-3 py-2 text-[14px] text-[#F0F0F0] outline-none focus:border-[#007CF7]"
              />
              <input
                type="text"
                value={hostPort}
                onChange={(e) => setHostPort(e.target.value)}
                placeholder="host:porta (ex.: 198.51.100.10:8080)"
                className="rounded-lg border border-white/[0.06] bg-[#141414] px-3 py-2 font-mono text-[12px] text-[#F0F0F0] outline-none focus:border-[#007CF7]"
              />
            </div>

            <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2">
              <input
                type="text"
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                placeholder="Usuário (opcional)"
                className="rounded-lg border border-white/[0.06] bg-[#141414] px-3 py-2 text-[14px] text-[#F0F0F0] outline-none focus:border-[#007CF7]"
              />
              <input
                type="password"
                autoComplete="new-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="Senha (Armazenada cifrada no Cofre)"
                className="rounded-lg border border-white/[0.06] bg-[#141414] px-3 py-2 text-[14px] text-[#F0F0F0] outline-none focus:border-[#007CF7]"
              />
            </div>

            {errorMsg && <p className="text-[12px] text-[#FD2F3B]">{errorMsg}</p>}

            <div className="flex items-center justify-between gap-[8px] pt-2">
              <button
                type="button"
                disabled={saving || !currentProxy?.server}
                onClick={async () => {
                  await onApplyProxy(null);
                  onClose();
                }}
                className="rounded-lg bg-[#2A2A2A] px-3 py-2 text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#333333] disabled:opacity-40"
              >
                Remover vínculo
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414] hover:bg-white disabled:opacity-50"
              >
                <Check size={14} />
                <span>Aplicar proxy</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export interface ServerBrowserProfilesPanelProps {
  profiles: BrowserProfileInfo[];
  proxies: BrowserProxyConfig[];
  onCreateProfile: (input: { nome: string; cor_hex?: string }) => Promise<void>;
  onUpdateProfile: (
    perfilId: string,
    patch: {
      nome?: string;
      cor_hex?: string;
      cdp_porta?: number | null;
      proxy_json?: BrowserProfileProxyPayload | null;
    }
  ) => Promise<void>;
  onOpenProfileBrowser?: (perfilId: string) => Promise<void>;
  onClearProfile: (perfilId: string) => Promise<void>;
  onDeleteProfile: (perfilId: string) => Promise<void>;
  onSaveProxy: (input: {
    nome: string;
    servidor: string;
    usuario?: string | null;
    senha?: string | null;
  }) => Promise<BrowserProxyConfig>;
  onDeleteProxy: (proxyId: string) => Promise<void>;
}

export function ServerBrowserProfilesPanel({
  profiles,
  proxies,
  onCreateProfile,
  onUpdateProfile,
  onOpenProfileBrowser,
  onClearProfile,
  onDeleteProfile,
  onSaveProxy,
  onDeleteProxy,
}: ServerBrowserProfilesPanelProps) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [colorMenuProfileId, setColorMenuProfileId] = useState<string | null>(null);
  const [actionMenuProfileId, setActionMenuProfileId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [cdpEditingId, setCdpEditingId] = useState<string | null>(null);
  const [cdpPortDraft, setCdpPortDraft] = useState("");
  const [openingProfileId, setOpeningProfileId] = useState<string | null>(null);
  const [proxyDialogProfile, setProxyDialogProfile] = useState<BrowserProfileInfo | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorFeedback, setErrorFeedback] = useState<string | null>(null);

  const handleOpenBrowser = async (profile: BrowserProfileInfo) => {
    setOpeningProfileId(profile.perfil_id);
    setErrorFeedback(null);
    try {
      if (onOpenProfileBrowser) {
        await onOpenProfileBrowser(profile.perfil_id);
      } else {
        await daemonApi.openBrowserProfileWindow(profile.perfil_id);
      }
      setFeedback(
        profile.cdp_porta
          ? `Conectado ao Chrome existente (CDP :${profile.cdp_porta}) no perfil "${profile.nome}".`
          : `Janela do navegador aberta para o perfil "${profile.nome}".`
      );
    } catch (err) {
      setErrorFeedback(
        err instanceof Error ? err.message : "Não foi possível abrir o navegador do perfil."
      );
    } finally {
      setOpeningProfileId(null);
    }
  };

  const handleSaveCdpPort = async (perfilId: string) => {
    const clean = cdpPortDraft.trim();
    setErrorFeedback(null);
    if (!clean) {
      await onUpdateProfile(perfilId, { cdp_porta: null });
      setCdpEditingId(null);
      setFeedback("Porta CDP removida (perfil voltará a abrir janela própria).");
      return;
    }
    const parsed = Number.parseInt(clean, 10);
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
      setErrorFeedback("Informe uma porta CDP loopback válida entre 1024 e 65535 (ex.: 9222).");
      return;
    }
    await onUpdateProfile(perfilId, { cdp_porta: parsed });
    setCdpEditingId(null);
    setFeedback(`Porta CDP 127.0.0.1:${parsed} salva para este perfil.`);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newName.trim();
    if (!clean) return;
    setCreating(true);
    try {
      await onCreateProfile({ nome: clean, cor_hex: "#42A0FF" });
      setNewName("");
    } finally {
      setCreating(false);
    }
  };

  const handleCommitRename = async (perfilId: string) => {
    const clean = renameDraft.trim();
    if (!clean) {
      setRenamingId(null);
      return;
    }
    await onUpdateProfile(perfilId, { nome: clean });
    setRenamingId(null);
  };

  return (
    <div className="space-y-[16px]">
      <div className="space-y-1">
        <div className="flex items-center gap-[8px]">
          <Globe size={16} className="text-[#42A0FF]" />
          <h3 className="text-[14px] font-semibold text-[#F0F0F0]">
            Perfis persistentes e proxies
          </h3>
        </div>
        <p className="text-[12px] text-[#979797]">
          Perfis isolam sessões, cookies e proxies entre Criativos de pesquisa e publicação.
        </p>
      </div>

      {feedback && (
        <div className="rounded-lg border border-[#31CF76]/30 bg-[#31CF76]/10 px-3 py-2 text-[12px] text-[#31CF76]">
          {feedback}
        </div>
      )}

      {errorFeedback && (
        <div className="rounded-lg border border-[#FD2F3B]/30 bg-[#FD2F3B]/10 px-3 py-2 text-[12px] text-[#FF7675]">
          {errorFeedback}
        </div>
      )}

      <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-[#212121]">
        {profiles.map((profile) => {
          const isShared = profile.compartilhado || profile.perfil_id === "shared";
          const isColorOpen = colorMenuProfileId === profile.perfil_id;
          const isActionOpen = actionMenuProfileId === profile.perfil_id;

          return (
            <div
              key={profile.perfil_id}
              className="relative flex items-center justify-between gap-[8px] px-[16px] py-[12px]"
            >
              <div className="flex min-w-0 flex-1 items-center gap-[12px]">
                <div className="relative shrink-0">
                  <button
                    type="button"
                    disabled={isShared}
                    aria-label={`Cor do perfil ${profile.nome}`}
                    onClick={() =>
                      setColorMenuProfileId(isColorOpen ? null : profile.perfil_id)
                    }
                    className="h-4 w-4 rounded-full border border-white/20 transition hover:scale-110 disabled:cursor-default"
                    style={{ backgroundColor: profile.cor_hex || "#979797" }}
                  />
                  {isColorOpen && (
                    <div className="absolute left-0 top-6 z-40 flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#141414] p-2 shadow-xl">
                      {BROWSER_PROFILE_PALETTE.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          aria-label={`Selecionar cor ${hex}`}
                          onClick={() => {
                            setColorMenuProfileId(null);
                            void onUpdateProfile(profile.perfil_id, { cor_hex: hex });
                          }}
                          className="h-4 w-4 rounded-full border border-white/20 transition hover:scale-110"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  {renamingId === profile.perfil_id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleCommitRename(profile.perfil_id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="w-full rounded border border-[#007CF7] bg-[#141414] px-2 py-1 text-[14px] text-[#F0F0F0] outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCommitRename(profile.perfil_id)}
                        className="rounded bg-[#007CF7] px-2 py-1 text-[12px] font-semibold text-white"
                      >
                        Salvar
                      </button>
                    </div>
                  ) : (
                    <p className="truncate text-[14px] font-semibold text-[#F0F0F0]">
                      {profile.nome}
                    </p>
                  )}

                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-[#979797]">
                    <span>
                      {profile.agentes_count ?? 0}{" "}
                      {profile.agentes_count === 1 ? "agente" : "agentes"} ·{" "}
                      {profile.abas_count ?? 0}{" "}
                      {profile.abas_count === 1 ? "aba" : "abas"}
                    </span>
                    {(profile.proxy_url || profile.proxy?.server) && (
                      <span className="rounded-full bg-[#42A0FF]/15 px-2 py-0.5 font-mono text-[11px] text-[#42A0FF]">
                        Proxy ativo
                      </span>
                    )}
                    {profile.cdp_porta && (
                      <span className="rounded-full bg-[#31CF76]/15 px-2 py-0.5 font-mono text-[11px] text-[#31CF76]">
                        Chrome CDP :{profile.cdp_porta}
                      </span>
                    )}
                  </div>

                  {cdpEditingId === profile.perfil_id && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#141414] p-2">
                      <input
                        type="number"
                        min={1024}
                        max={65535}
                        value={cdpPortDraft}
                        onChange={(e) => setCdpPortDraft(e.target.value)}
                        placeholder="9222"
                        aria-label="Porta CDP loopback"
                        className="w-28 rounded border border-white/15 bg-[#1A1A1A] px-2 py-1 font-mono text-[12px] text-[#F0F0F0] outline-none focus:border-[#007CF7]"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSaveCdpPort(profile.perfil_id)}
                        className="rounded bg-[#007CF7] px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-[#198BFF]"
                      >
                        Salvar porta
                      </button>
                      <button
                        type="button"
                        onClick={() => setCdpEditingId(null)}
                        className="rounded bg-[#2A2A2A] px-2 py-1 text-[11.5px] text-[#DCDCDC]"
                      >
                        Cancelar
                      </button>
                      <span className="text-[11px] text-[#8E8E8E]">
                        Inicie seu Chrome com <code className="text-[#DCDCDC]">--remote-debugging-port={cdpPortDraft || "9222"}</code>
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="relative flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  disabled={openingProfileId === profile.perfil_id}
                  onClick={() => void handleOpenBrowser(profile)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#1A1A1A] px-2.5 text-[12px] font-medium text-[#F0F0F0] transition hover:bg-[#2A2A2A] disabled:opacity-50"
                >
                  <ExternalLink size={13} className="text-[#42A0FF]" />
                  <span>{openingProfileId === profile.perfil_id ? "Abrindo..." : "Abrir navegador"}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Ações de ${profile.nome}`}
                  onClick={() =>
                    setActionMenuProfileId(isActionOpen ? null : profile.perfil_id)
                  }
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#979797] transition hover:bg-[#2A2A2A] hover:text-[#F0F0F0]"
                >
                  <MoreHorizontal size={16} />
                </button>

                {isActionOpen && (
                  <div className="absolute right-0 top-9 z-40 w-56 space-y-1 rounded-xl border border-white/[0.08] bg-[#1A1A1A] p-1.5 shadow-2xl">
                    {!isShared && (
                      <button
                        type="button"
                        onClick={() => {
                          setActionMenuProfileId(null);
                          setRenamingId(profile.perfil_id);
                          setRenameDraft(profile.nome);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                      >
                        <Pencil size={13} />
                        <span>Renomear perfil</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setActionMenuProfileId(null);
                        setCdpEditingId(profile.perfil_id);
                        setCdpPortDraft(profile.cdp_porta ? String(profile.cdp_porta) : "9222");
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                    >
                      <Plug size={13} />
                      <span>Conectar Chrome existente (CDP)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActionMenuProfileId(null);
                        setProxyDialogProfile(profile);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                    >
                      <Shield size={13} />
                      <span>Vincular proxy</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActionMenuProfileId(null);
                        void onClearProfile(profile.perfil_id).then(() =>
                          setFeedback(`Cookies e cache de "${profile.nome}" limpos.`)
                        );
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-semibold text-[#FF9412] hover:bg-[#2A2A2A]"
                    >
                      <Trash2 size={13} />
                      <span>Limpar cookies</span>
                    </button>
                    {!isShared && (
                      <button
                        type="button"
                        onClick={() => {
                          setActionMenuProfileId(null);
                          void onDeleteProfile(profile.perfil_id);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-semibold text-[#FD2F3B] hover:bg-[#2A2A2A]"
                      >
                        <X size={13} />
                        <span>Excluir perfil</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={(e) => void handleCreate(e)} className="flex items-center gap-[8px]">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Novo perfil (ex.: Pesquisa Concorrência)"
          className="min-w-0 flex-1 rounded-lg border border-white/[0.06] bg-[#141414] px-3 py-2 text-[14px] text-[#F0F0F0] outline-none focus:border-[#007CF7]"
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#F0F0F0] px-3 py-2 text-[14px] font-semibold text-[#141414] transition hover:bg-white disabled:opacity-40"
        >
          <Plus size={15} />
          <span>Criar perfil</span>
        </button>
      </form>

      <BrowserProxyDialog
        open={Boolean(proxyDialogProfile)}
        profileName={proxyDialogProfile?.nome ?? ""}
        tabCount={proxyDialogProfile?.abas_count ?? 0}
        currentProxy={proxyDialogProfile?.proxy}
        proxies={proxies}
        onClose={() => setProxyDialogProfile(null)}
        onApplyProxy={async (proxyPayload) => {
          if (!proxyDialogProfile) return;
          await onUpdateProfile(proxyDialogProfile.perfil_id, { proxy_json: proxyPayload });
        }}
        onSaveProxyPreset={onSaveProxy}
        onDeleteProxyPreset={onDeleteProxy}
      />
    </div>
  );
}
