import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgenteRegistro,
  GithubImportPreview,
  MarketplaceAgentPackage,
  MarketplaceAppItem,
  MarketplaceAuthFlow,
  MarketplaceSkillItem,
  MarketplaceSourceFilter,
  MarketplaceTab,
  McpAcessoAgentes,
  McpOAuthStatus,
  McpProbeResultado,
  McpServidorConfig,
  McpTransporte,
  NativeAppAccountSummary,
} from "@criativo/contracts";
import {
  AlertTriangle,
  ArrowLeft,
  Blocks,
  Bot,
  Check,
  Copy,
  Download,
  ExternalLink,
  Github,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  AppBrandIcon,
  CarbonSelect,
  SlidingTabs,
  type CarbonSelectOption,
} from "../../components/ui/CarbonControls";
import { daemonApi } from "../../services/websocket-client";
import { slugifyLocal, type KeyValuePair, type MarketplaceYourAppEntry } from "./marketplace-helpers";

export interface CustomMcpModalProps {
  open: boolean;
  editingServer?: MarketplaceYourAppEntry | null;
  agentes: AgenteRegistro[];
  onClose: () => void;
  onSaved?: (server: McpServidorConfig) => void;
  onDeleted?: (mcpId: string) => void;
}

export function CustomMcpModal({
  open,
  editingServer,
  agentes,
  onClose,
  onSaved,
  onDeleted,
}: CustomMcpModalProps) {
  const [transporte, setTransporte] = useState<McpTransporte>(
    editingServer?.transporte ?? "stdio"
  );
  const [nome, setNome] = useState(editingServer?.nome ?? "");
  const [contaRotulo, setContaRotulo] = useState(editingServer?.contaRotulo ?? "");
  const [comando, setComando] = useState(editingServer?.comando ?? "");
  const [argsLine, setArgsLine] = useState((editingServer?.args ?? []).join(" "));
  const [workingDirectory, setWorkingDirectory] = useState(
    editingServer?.workingDirectory ?? ""
  );
  const [envPairs, setEnvPairs] = useState<KeyValuePair[]>(() =>
    Object.entries(editingServer?.env ?? {}).map(([k, v], idx) => ({
      id: `env-${idx}-${k}`,
      key: k,
      value: v,
    }))
  );
  const [envPassthroughText, setEnvPassthroughText] = useState(
    (editingServer?.envPassthrough ?? []).join(", ")
  );
  const [url, setUrl] = useState(editingServer?.url ?? "");
  const [headerPairs, setHeaderPairs] = useState<KeyValuePair[]>(() =>
    Object.entries(editingServer?.headers ?? {}).map(([k, v], idx) => ({
      id: `hdr-${idx}-${k}`,
      key: k,
      value: v,
    }))
  );
  const [accessMode, setAccessMode] = useState<"everyone" | "agents">(
    editingServer?.acesso.mode ?? "everyone"
  );
  const [selectedAgents, setSelectedAgents] = useState<string[]>(
    editingServer?.acesso.agentIds ?? []
  );

  const [autoSwitchedHint, setAutoSwitchedHint] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<McpProbeResultado | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTransporte(editingServer?.transporte ?? "stdio");
    setNome(editingServer?.nome ?? "");
    setContaRotulo(editingServer?.contaRotulo ?? "");
    setComando(editingServer?.comando ?? "");
    setArgsLine((editingServer?.args ?? []).join(" "));
    setWorkingDirectory(editingServer?.workingDirectory ?? "");
    setEnvPairs(
      Object.entries(editingServer?.env ?? {}).map(([k, v], idx) => ({
        id: `env-${idx}-${k}`,
        key: k,
        value: v,
      }))
    );
    setEnvPassthroughText((editingServer?.envPassthrough ?? []).join(", "));
    setUrl(editingServer?.url ?? "");
    setHeaderPairs(
      Object.entries(editingServer?.headers ?? {}).map(([k, v], idx) => ({
        id: `hdr-${idx}-${k}`,
        key: k,
        value: v,
      }))
    );
    setAccessMode(editingServer?.acesso.mode ?? "everyone");
    setSelectedAgents(editingServer?.acesso.agentIds ?? []);
    setAutoSwitchedHint(false);
    setProbeResult(null);
    setErrorMsg(null);
    setConfirmRemoveOpen(false);
  }, [open, editingServer]);

  if (!open) return null;

  const buildPayload = () => {
    const env: Record<string, string> = {};
    for (const pair of envPairs) {
      if (pair.key.trim()) env[pair.key.trim()] = pair.value;
    }
    const headers: Record<string, string> = {};
    for (const pair of headerPairs) {
      if (pair.key.trim()) headers[pair.key.trim()] = pair.value;
    }
    const args = argsLine
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const envPassthrough = envPassthroughText
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    return {
      mcp_id: editingServer?.mcp_id,
      nome: nome.trim(),
      transporte,
      comando: transporte === "stdio" ? comando.trim() : "",
      args: transporte === "stdio" ? args : [],
      env: transporte === "stdio" ? env : {},
      envPassthrough: transporte === "stdio" ? envPassthrough : [],
      workingDirectory:
        transporte === "stdio" && workingDirectory.trim() ? workingDirectory.trim() : null,
      url: transporte === "http" ? url.trim() : null,
      headers: transporte === "http" ? headers : {},
      acesso: {
        mode: accessMode,
        agentIds: accessMode === "agents" ? selectedAgents : [],
      } as McpAcessoAgentes,
      contaRotulo: contaRotulo.trim() || null,
      ativo: editingServer?.ativo ?? true,
    };
  };

  const handleCommandChange = (nextVal: string) => {
    const trimmed = nextVal.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      setUrl(trimmed);
      setComando("");
      setTransporte("http");
      setAutoSwitchedHint(true);
      return;
    }
    setComando(nextVal);
  };

  const handleTestConnection = async () => {
    setErrorMsg(null);
    setProbing(true);
    try {
      const payload = buildPayload();
      const res = await daemonApi.testMcpDraft(payload);
      setProbeResult(res);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "O servidor não respondeu dentro do limite esperado. Revise os campos e tente novamente."
      );
    } finally {
      setProbing(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const payload = buildPayload();
    if (!payload.nome) {
      setErrorMsg("Informe o nome do servidor MCP.");
      return;
    }
    if (payload.transporte === "stdio" && !payload.comando) {
      setErrorMsg("Informe o comando executável para o transporte STDIO.");
      return;
    }
    if (payload.transporte === "http" && !payload.url) {
      setErrorMsg("Informe a URL do endpoint MCP para Streamable HTTP.");
      return;
    }

    setSaving(true);
    try {
      const saved = editingServer
        ? await daemonApi.updateMcpServer(editingServer.mcp_id, payload)
        : (await daemonApi.saveMcpServer(payload)).servidor;
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Falha ao registrar servidor MCP.");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!editingServer) return;
    setSaving(true);
    try {
      await daemonApi.deleteMcpServer(editingServer.mcp_id);
      onDeleted?.(editingServer.mcp_id);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Falha ao remover servidor MCP.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Registrar servidor MCP personalizado"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D0D0D]/80 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[16px] border border-[#2A2A2A] bg-[#212121] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#2A2A2A] px-6 py-4">
          <div className="flex items-center gap-2">
            <Plug size={20} className="text-[#007CF7]" />
            <h2 className="text-[20px] font-semibold leading-[1.3] text-[#F0F0F0]">
              {editingServer ? "Editar servidor MCP" : "Registrar servidor MCP personalizado"}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Fechar janela"
            onClick={onClose}
            className="rounded-[8px] p-1 text-[#979797] hover:bg-[#2A2A2A] hover:text-[#F0F0F0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave} className="flex-1 space-y-4 overflow-y-auto p-6">
          <div className="space-y-2">
            <span className="block text-[14px] font-semibold text-[#F0F0F0]">
              Tipo de transporte
            </span>
            <SlidingTabs<McpTransporte>
              ariaLabel="Tipo de transporte MCP"
              value={transporte}
              onChange={(next) => {
                setTransporte(next);
                setAutoSwitchedHint(false);
              }}
              tabs={[
                { id: "stdio", label: "STDIO (Local)" },
                { id: "http", label: "Streamable HTTP (Remoto)" },
              ]}
            />
            {autoSwitchedHint && (
              <p className="text-[12px] text-[#42A0FF]">
                URL detectada no comando: alternamos automaticamente para Streamable HTTP (Remoto).
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="custom-mcp-name" className="block text-[14px] font-semibold text-[#F0F0F0]">
                Nome do servidor
              </label>
              <input
                id="custom-mcp-name"
                type="text"
                required
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Servidor Interno da Marca"
                className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 text-[14px] text-[#F0F0F0] placeholder-[#979797] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="custom-mcp-label" className="block text-[14px] font-semibold text-[#F0F0F0]">
                Rótulo da conta (opcional)
              </label>
              <input
                id="custom-mcp-label"
                type="text"
                value={contaRotulo}
                onChange={(e) => setContaRotulo(e.target.value)}
                placeholder="Conta Principal"
                className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 text-[14px] text-[#F0F0F0] placeholder-[#979797] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
              />
            </div>
          </div>

          {transporte === "stdio" ? (
            <div className="space-y-4 rounded-[12px] border border-[#2A2A2A] bg-[#1A1A1A] p-4">
              <div className="space-y-1">
                <label htmlFor="custom-mcp-cmd" className="block text-[14px] font-semibold text-[#F0F0F0]">
                  Comando executável
                </label>
                <input
                  id="custom-mcp-cmd"
                  type="text"
                  value={comando}
                  onChange={(e) => handleCommandChange(e.target.value)}
                  placeholder="npx ou cole uma URL https://..."
                  className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 font-mono text-[14px] text-[#F0F0F0] placeholder-[#979797] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="custom-mcp-args" className="block text-[14px] font-semibold text-[#F0F0F0]">
                  Argumentos
                </label>
                <input
                  id="custom-mcp-args"
                  type="text"
                  value={argsLine}
                  onChange={(e) => setArgsLine(e.target.value)}
                  placeholder="-y @modelcontextprotocol/server-filesystem ./saidas"
                  className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 font-mono text-[14px] text-[#F0F0F0] placeholder-[#979797] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="custom-mcp-workdir" className="block text-[14px] font-semibold text-[#F0F0F0]">
                  Diretório de trabalho (opcional)
                </label>
                <input
                  id="custom-mcp-workdir"
                  type="text"
                  value={workingDirectory}
                  onChange={(e) => setWorkingDirectory(e.target.value)}
                  placeholder="C:\projetos\ferramentas-mcp"
                  className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 font-mono text-[14px] text-[#F0F0F0] placeholder-[#979797] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                />
                {workingDirectory.trim().length > 0 && (
                  <p className="text-[12px] text-[#FF9412]">
                    Servidores STDIO com diretório customizado executam apenas no runner nativo e não são injetados em sessões ACP externas.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-semibold text-[#F0F0F0]">
                    Variáveis de ambiente
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setEnvPairs((prev) => [
                        ...prev,
                        { id: `env-${Date.now()}`, key: "", value: "" },
                      ])
                    }
                    className="rounded-[8px] border border-[#2A2A2A] bg-[#242424] px-3 py-1 text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                  >
                    Adicionar variável
                  </button>
                </div>
                {envPairs.map((pair, idx) => (
                  <div key={pair.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <input
                      type="text"
                      aria-label={`Chave variável ${idx + 1}`}
                      value={pair.key}
                      onChange={(e) =>
                        setEnvPairs((prev) =>
                          prev.map((item) =>
                            item.id === pair.id ? { ...item, key: e.target.value } : item
                          )
                        )
                      }
                      placeholder="API_TOKEN"
                      className="rounded-[8px] border border-[#2A2A2A] bg-[#242424] px-2.5 py-1.5 font-mono text-[12px] text-[#F0F0F0]"
                    />
                    <input
                      type="password"
                      aria-label={`Valor variável ${idx + 1}`}
                      value={pair.value}
                      onChange={(e) =>
                        setEnvPairs((prev) =>
                          prev.map((item) =>
                            item.id === pair.id ? { ...item, value: e.target.value } : item
                          )
                        )
                      }
                      placeholder="Valor secreto"
                      className="rounded-[8px] border border-[#2A2A2A] bg-[#242424] px-2.5 py-1.5 font-mono text-[12px] text-[#F0F0F0]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setEnvPairs((prev) => prev.filter((item) => item.id !== pair.id))
                      }
                      aria-label="Remover item"
                      className="rounded-[8px] border border-[#2A2A2A] bg-[#242424] px-2.5 py-1.5 text-[12px] text-[#FD2F3B] hover:bg-[#FD2F3B]/10"
                    >
                      Remover item
                    </button>
                  </div>
                ))}
                <div className="space-y-1 pt-1">
                  <label htmlFor="custom-mcp-passthrough" className="block text-[12px] font-semibold text-[#979797]">
                    Herdar do sistema (nomes separados por vírgula)
                  </label>
                  <input
                    id="custom-mcp-passthrough"
                    type="text"
                    value={envPassthroughText}
                    onChange={(e) => setEnvPassthroughText(e.target.value)}
                    placeholder="PATH, HOME, USERPROFILE"
                    className="w-full rounded-[8px] border border-[#2A2A2A] bg-[#242424] px-2.5 py-1.5 font-mono text-[12px] text-[#F0F0F0]"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 rounded-[12px] border border-[#2A2A2A] bg-[#1A1A1A] p-4">
              <div className="space-y-1">
                <label htmlFor="custom-mcp-url" className="block text-[14px] font-semibold text-[#F0F0F0]">
                  URL do endpoint MCP
                </label>
                <input
                  id="custom-mcp-url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://mcp.exemplo.invalid/mcp"
                  className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 font-mono text-[14px] text-[#F0F0F0] placeholder-[#979797] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-semibold text-[#F0F0F0]">
                    Cabeçalhos HTTP
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setHeaderPairs((prev) => [
                        ...prev,
                        { id: `hdr-${Date.now()}`, key: "", value: "" },
                      ])
                    }
                    className="rounded-[8px] border border-[#2A2A2A] bg-[#242424] px-3 py-1 text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                  >
                    Adicionar cabeçalho
                  </button>
                </div>
                <p className="text-[12px] text-[#979797]">
                  Servidores compatíveis com OAuth 2.1 não exigem colar Authorization manualmente; faça o login após salvar.
                </p>
                {headerPairs.map((pair, idx) => (
                  <div key={pair.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <input
                      type="text"
                      aria-label={`Nome cabeçalho ${idx + 1}`}
                      value={pair.key}
                      onChange={(e) =>
                        setHeaderPairs((prev) =>
                          prev.map((item) =>
                            item.id === pair.id ? { ...item, key: e.target.value } : item
                          )
                        )
                      }
                      placeholder="X-Api-Key"
                      className="rounded-[8px] border border-[#2A2A2A] bg-[#242424] px-2.5 py-1.5 font-mono text-[12px] text-[#F0F0F0]"
                    />
                    <input
                      type="password"
                      aria-label={`Valor cabeçalho ${idx + 1}`}
                      value={pair.value}
                      onChange={(e) =>
                        setHeaderPairs((prev) =>
                          prev.map((item) =>
                            item.id === pair.id ? { ...item, value: e.target.value } : item
                          )
                        )
                      }
                      placeholder="Segredo mascarado"
                      className="rounded-[8px] border border-[#2A2A2A] bg-[#242424] px-2.5 py-1.5 font-mono text-[12px] text-[#F0F0F0]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setHeaderPairs((prev) => prev.filter((item) => item.id !== pair.id))
                      }
                      aria-label="Remover item"
                      className="rounded-[8px] border border-[#2A2A2A] bg-[#242424] px-2.5 py-1.5 text-[12px] text-[#FD2F3B] hover:bg-[#FD2F3B]/10"
                    >
                      Remover item
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <span className="block text-[14px] font-semibold text-[#F0F0F0]">
              Acesso inicial de Criativos
            </span>
            <SlidingTabs<"everyone" | "agents">
              ariaLabel="Escopo inicial de Criativos"
              value={accessMode}
              onChange={setAccessMode}
              tabs={[
                { id: "everyone", label: "Todos os Criativos" },
                { id: "agents", label: "Criativos selecionados" },
              ]}
            />
            {accessMode === "agents" && (
              <div className="grid max-h-36 grid-cols-1 gap-1.5 overflow-y-auto rounded-[10px] border border-[#2A2A2A] bg-[#1A1A1A] p-3 md:grid-cols-2">
                {agentes
                  .filter(
                    (ag) =>
                      ag.agente_id !== "assistente_setup" &&
                      ag.agente_id !== "assistente_servidor_vps" &&
                      (ag.config as Record<string, unknown>)?.upgrade_desbloqueado !== false
                  )
                  .map((ag) => {
                  const checked = selectedAgents.includes(ag.agente_id);
                  return (
                    <label
                      key={ag.agente_id}
                      className="flex cursor-pointer items-center gap-2 rounded-[8px] bg-[#242424] px-2.5 py-1.5 text-[12px] text-[#F0F0F0]"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedAgents((prev) =>
                            checked
                              ? prev.filter((id) => id !== ag.agente_id)
                              : [...prev, ag.agente_id]
                          )
                        }
                        className="accent-[#007CF7]"
                      />
                      <span className="truncate">{ag.nome}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="rounded-[10px] border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 px-4 py-2 text-[12px] text-[#FD2F3B]">
              {errorMsg}
            </div>
          )}

          {confirmRemoveOpen && editingServer && (
            <div className="space-y-2 rounded-[12px] border border-[#FD2F3B]/40 bg-[#1A1A1A] p-4">
              <p className="text-[14px] font-semibold text-[#F0F0F0]">
                Remover servidor {editingServer.nome}?
              </p>
              <p className="text-[12px] text-[#979797]">
                Os Criativos vinculados perderão acesso imediato às ferramentas deste servidor e os tokens OAuth locais serão revogados.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmRemoveOpen(false)}
                  className="rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-1.5 text-[12px] font-semibold text-[#F0F0F0]"
                >
                  Manter registro
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmDelete()}
                  className="rounded-full bg-[#FD2F3B] px-4 py-1.5 text-[12px] font-semibold text-[#F0F0F0]"
                >
                  Remover servidor
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#2A2A2A] pt-4">
            <div className="text-[12px]">
              {probing ? (
                <span className="inline-flex items-center gap-1.5 text-[#007CF7]">
                  <Loader2 size={14} className="animate-spin" /> Testando servidor MCP...
                </span>
              ) : probeResult ? (
                probeResult.status === "passed" ? (
                  <span className="font-semibold text-[#31CF76]">
                    {probeResult.toolCount} ferramentas disponíveis
                  </span>
                ) : probeResult.status === "needs_sign_in" ? (
                  <span className="font-semibold text-[#FF9412]">
                    Requer autenticação OAuth no navegador após registrar
                  </span>
                ) : (
                  <span className="text-[#FD2F3B]">
                    {probeResult.error ?? "O servidor não respondeu dentro do limite esperado."}
                  </span>
                )
              ) : (
                <span className="text-[#979797]">Execute Testar conexão para validar ferramentas.</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {editingServer && !confirmRemoveOpen && (
                <button
                  type="button"
                  onClick={() => setConfirmRemoveOpen(true)}
                  className="rounded-full border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 px-4 py-2 text-[14px] font-semibold text-[#FD2F3B] hover:bg-[#FD2F3B]/20"
                >
                  Remover servidor
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
              >
                Descartar alterações
              </button>
              <button
                type="button"
                disabled={probing}
                onClick={() => void handleTestConnection()}
                className="rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A] disabled:opacity-50"
              >
                Testar conexão
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-full bg-[#F0F0F0] px-5 py-2 text-[14px] font-semibold text-[#141414] hover:bg-white disabled:opacity-50"
              >
                {saving ? "Salvando..." : "Registrar servidor"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ====================================================================
// Modal 2: CreateSkillModal (+ Criar habilidade)
// ====================================================================
