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

export type MarketplaceYourAppEntry = McpServidorConfig & {
  oauthStatus?: McpOAuthStatus;
};

interface KeyValuePair {
  id: string;
  key: string;
  value: string;
}

const SKILL_CATEGORY_OPTIONS: CarbonSelectOption[] = [
  { value: "Automação & Rotinas", label: "Automação & Rotinas" },
  { value: "Conteúdo & Copy", label: "Conteúdo & Copy" },
  { value: "Design & Vídeo", label: "Design & Vídeo" },
  { value: "Pesquisa & Estratégia", label: "Pesquisa & Estratégia" },
  { value: "Integração & Dados", label: "Integração & Dados" },
];

function slugifyLocal(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isGithubUrlCandidate(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/.test(trimmed) ||
    /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)
  );
}

function statusDotColor(server: MarketplaceYourAppEntry): string {
  if (!server.ativo || server.oauthStatus === "lost") return "#FF9412";
  if (server.ultimoErro) return "#FD2F3B";
  if (server.oauthStatus === "signing_in") return "#007CF7";
  return "#31CF76";
}

function groupByCategory<T extends { category: string }>(
  items: readonly T[]
): Array<{ category: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const cat = item.category?.trim() || "Geral";
    const list = map.get(cat) ?? [];
    list.push(item);
    map.set(cat, list);
  }
  return Array.from(map.entries()).map(([category, list]) => ({
    category,
    items: list,
  }));
}

// ====================================================================
// Modal 1: CustomMcpModal (+ Adicionar personalizado / Editar MCP)
// ====================================================================

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
              Acesso inicial de agentes
            </span>
            <SlidingTabs<"everyone" | "agents">
              ariaLabel="Escopo inicial de agentes"
              value={accessMode}
              onChange={setAccessMode}
              tabs={[
                { id: "everyone", label: "Todos os agentes" },
                { id: "agents", label: "Agentes selecionados" },
              ]}
            />
            {accessMode === "agents" && (
              <div className="grid max-h-36 grid-cols-1 gap-1.5 overflow-y-auto rounded-[10px] border border-[#2A2A2A] bg-[#1A1A1A] p-3 md:grid-cols-2">
                {agentes
                  .filter(
                    (ag) =>
                      ag.agente_id !== "assistente_setup" &&
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
                Os agentes vinculados perderão acesso imediato às ferramentas deste servidor e os tokens OAuth locais serão revogados.
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

export interface CreateSkillModalProps {
  open: boolean;
  agentes: AgenteRegistro[];
  defaultAgentId?: string;
  onClose: () => void;
  onCreated?: (skill: MarketplaceSkillItem) => void;
  onCreateWithAgent?: (agentId: string, prompt: string) => void;
}

export function CreateSkillModal({
  open,
  agentes,
  defaultAgentId = "estrategista",
  onClose,
  onCreated,
  onCreateWithAgent,
}: CreateSkillModalProps) {
  const [mode, setMode] = useState<"assisted" | "manual">("manual");
  const [assistantAgentId, setAssistantAgentId] = useState(defaultAgentId);
  const [assistedGoal, setAssistedGoal] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [category, setCategory] = useState("Automação & Rotinas");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<string[]>([defaultAgentId]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setSlug("");
    setSlugEdited(false);
    setDescription("");
    setInstructions("");
    setAssistedGoal("");
    setErrorMsg(null);
  }, [open]);

  if (!open) return null;

  const agentSelectOptions: CarbonSelectOption[] = agentes.map((ag) => ({
    value: ag.agente_id,
    label: ag.nome,
    description: ag.papel,
  }));

  const handleNameChange = (nextName: string) => {
    setName(nextName);
    if (!slugEdited) {
      setSlug(slugifyLocal(nextName));
    }
  };

  const handleStartAssisted = () => {
    const prompt = assistedGoal.trim()
      ? `Crie uma nova habilidade reutilizável usando a ferramenta create_skill com objetivo: ${assistedGoal.trim()}`
      : "Me ajude a projetar e registrar uma nova habilidade personalizada (SKILL.md) usando a ferramenta create_skill.";
    onCreateWithAgent?.(assistantAgentId, prompt);
    onClose();
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!name.trim() || !description.trim() || !instructions.trim()) {
      setErrorMsg("Preencha nome, descrição curta e instruções completas da habilidade.");
      return;
    }
    setSaving(true);
    try {
      const created = await daemonApi.createCustomSkill({
        name: name.trim(),
        slug: slug.trim() || slugifyLocal(name),
        description: description.trim(),
        category,
        instructions: instructions.trim(),
        agentIds: selectedAgents,
      });
      onCreated?.(created);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Falha ao criar habilidade.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Criar nova habilidade"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D0D0D]/80 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[16px] border border-[#2A2A2A] bg-[#212121] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#2A2A2A] px-6 py-4">
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-[#007CF7]" />
            <h2 className="text-[20px] font-semibold text-[#F0F0F0]">
              Criar nova habilidade
            </h2>
          </div>
          <button
            type="button"
            aria-label="Fechar janela"
            onClick={onClose}
            className="rounded-[8px] p-1 text-[#979797] hover:bg-[#2A2A2A] hover:text-[#F0F0F0]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <SlidingTabs<"assisted" | "manual">
            ariaLabel="Modo de criação da habilidade"
            value={mode}
            onChange={setMode}
            tabs={[
              { id: "assisted", label: "Assistida por agente" },
              { id: "manual", label: "Definição manual" },
            ]}
          />

          {mode === "assisted" ? (
            <div className="space-y-4 rounded-[12px] border border-[#2A2A2A] bg-[#1A1A1A] p-4">
              <p className="text-[14px] text-[#DCDCDC]">
                Descreva o que a habilidade deve ensinar ao agente. Abriremos uma conversa pronta para gerar e registrar o arquivo `SKILL.md` com `create_skill`.
              </p>
              <div className="space-y-1">
                <span className="block text-[14px] font-semibold text-[#F0F0F0]">
                  Agente responsável
                </span>
                <CarbonSelect
                  ariaLabel="Selecionar agente criador da habilidade"
                  value={assistantAgentId}
                  options={agentSelectOptions}
                  onChange={setAssistantAgentId}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="skill-assisted-goal" className="block text-[14px] font-semibold text-[#F0F0F0]">
                  Objetivo da habilidade
                </label>
                <textarea
                  id="skill-assisted-goal"
                  rows={4}
                  value={assistedGoal}
                  onChange={(e) => setAssistedGoal(e.target.value)}
                  placeholder="Ex.: Checklist editorial para revisar carrosséis antes da aprovação humana..."
                  className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 text-[14px] text-[#F0F0F0] placeholder-[#979797] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0]"
                >
                  Descartar alterações
                </button>
                <button
                  type="button"
                  onClick={handleStartAssisted}
                  className="rounded-full bg-[#F0F0F0] px-5 py-2 text-[14px] font-semibold text-[#141414]"
                >
                  Criar habilidade
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor="skill-name" className="block text-[14px] font-semibold text-[#F0F0F0]">
                    Nome da habilidade
                  </label>
                  <input
                    id="skill-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="Auditoria de Legendas"
                    className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 text-[14px] text-[#F0F0F0] placeholder-[#979797] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="skill-slug" className="block text-[14px] font-semibold text-[#F0F0F0]">
                    Identificador (slug)
                  </label>
                  <input
                    id="skill-slug"
                    type="text"
                    value={slug}
                    onChange={(e) => {
                      setSlugEdited(true);
                      setSlug(slugifyLocal(e.target.value));
                    }}
                    placeholder="auditoria-de-legendas"
                    className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 font-mono text-[12px] text-[#F0F0F0] placeholder-[#979797]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <span className="block text-[14px] font-semibold text-[#F0F0F0]">Categoria</span>
                  <CarbonSelect
                    ariaLabel="Categoria da habilidade"
                    value={category}
                    options={SKILL_CATEGORY_OPTIONS}
                    onChange={setCategory}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="skill-desc" className="block text-[14px] font-semibold text-[#F0F0F0]">
                    Descrição curta
                  </label>
                  <input
                    id="skill-desc"
                    type="text"
                    required
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Quando ativar esta habilidade durante a conversa"
                    className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 text-[14px] text-[#F0F0F0] placeholder-[#979797]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="skill-md" className="block text-[14px] font-semibold text-[#F0F0F0]">
                  Instruções completas (SKILL.md)
                </label>
                <textarea
                  id="skill-md"
                  required
                  rows={6}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="# Regras de execução&#10;1. Verifique gancho inicial..."
                  className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 font-mono text-[12px] text-[#F0F0F0] placeholder-[#979797]"
                />
              </div>

              <div className="space-y-2">
                <span className="block text-[14px] font-semibold text-[#F0F0F0]">
                  Vincular aos agentes ({selectedAgents.length})
                </span>
                <div className="grid max-h-32 grid-cols-1 gap-1.5 overflow-y-auto rounded-[10px] border border-[#2A2A2A] bg-[#1A1A1A] p-3 md:grid-cols-2">
                  {agentes.map((ag) => {
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
              </div>

              {errorMsg && (
                <div className="rounded-[10px] border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 px-4 py-2 text-[12px] text-[#FD2F3B]">
                  {errorMsg}
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-[#2A2A2A] pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0]"
                >
                  Descartar alterações
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full bg-[#F0F0F0] px-5 py-2 text-[14px] font-semibold text-[#141414] disabled:opacity-50"
                >
                  {saving ? "Salvando..." : "Criar habilidade"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ====================================================================
// Dialog auxiliar: AddToAgentsDialog (vinculação em lote + 6s Undo)
// ====================================================================

interface AddToAgentsDialogProps {
  skill: MarketplaceSkillItem | null;
  agentes: AgenteRegistro[];
  onClose: () => void;
  onConfirmBatch: (
    skill: MarketplaceSkillItem,
    nextAgentIds: string[]
  ) => Promise<void>;
}

function AddToAgentsDialog({
  skill,
  agentes,
  onClose,
  onConfirmBatch,
}: AddToAgentsDialogProps) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!skill) return;
    setSelected(skill.agentIds ?? []);
    setFilter("");
  }, [skill]);

  if (!skill) return null;

  const filtered = agentes.filter(
    (ag) =>
      ag.nome.toLowerCase().includes(filter.toLowerCase()) ||
      ag.papel.toLowerCase().includes(filter.toLowerCase())
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      await onConfirmBatch(skill, selected);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Adicionar habilidade ${skill.name} aos agentes`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D0D0D]/80 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-[16px] border border-[#2A2A2A] bg-[#212121] p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-[20px] font-semibold text-[#F0F0F0]">
            Adicionar aos agentes
          </h3>
          <button
            type="button"
            aria-label="Fechar janela"
            onClick={onClose}
            className="text-[#979797] hover:text-[#F0F0F0]"
          >
            <X size={18} />
          </button>
        </div>

        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar agentes..."
          className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 text-[14px] text-[#F0F0F0] placeholder-[#979797]"
        />

        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {filtered.map((ag) => {
            const checked = selected.includes(ag.agente_id);
            return (
              <label
                key={ag.agente_id}
                className="flex cursor-pointer items-center justify-between rounded-[10px] border border-[#2A2A2A] bg-[#1A1A1A] px-3 py-2 text-[14px] text-[#F0F0F0]"
              >
                <span className="truncate">{ag.nome}</span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setSelected((prev) =>
                      checked
                        ? prev.filter((id) => id !== ag.agente_id)
                        : [...prev, ag.agente_id]
                    )
                  }
                  className="accent-[#007CF7]"
                />
              </label>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#2A2A2A] pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0]"
          >
            Manter registro
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="rounded-full bg-[#F0F0F0] px-5 py-2 text-[14px] font-semibold text-[#141414]"
          >
            Atualizar vínculos
          </button>
        </div>
      </div>
    </div>
  );
}

// ====================================================================
// Componente Principal: MarketplacePage (Central Loja Unificada)
// ====================================================================

export interface MarketplacePageProps {
  agentes: AgenteRegistro[];
  initialCatalog?: {
    apps?: MarketplaceAppItem[];
    agents?: MarketplaceAgentPackage[];
    skills?: MarketplaceSkillItem[];
    nativeAccounts?: NativeAppAccountSummary[];
    connectedNativeSlugs?: string[];
  };
  initialTab?: MarketplaceTab;
  initialAppSlug?: string | null;
  initialYourApps?: MarketplaceYourAppEntry[];
  initialNativeAccounts?: NativeAppAccountSummary[];
  onRefreshStudio?: () => Promise<void>;
  onTryPromptInChat?: (agentId: string, prompt: string) => void;
  onCreateSkillWithAgent?: (agentId: string, prompt: string) => void;
  onOpenWhatsAppModal?: () => void;
}

export function MarketplacePage({
  agentes,
  initialCatalog,
  initialTab = "apps",
  initialAppSlug = null,
  initialYourApps = [],
  initialNativeAccounts = [],
  onRefreshStudio,
  onTryPromptInChat,
  onCreateSkillWithAgent,
  onOpenWhatsAppModal,
}: MarketplacePageProps) {
  const [tab, setTab] = useState<MarketplaceTab>(initialTab);
  const [sourceFilter, setSourceFilter] = useState<MarketplaceSourceFilter>("all");
  const [query, setQuery] = useState("");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const [apps, setApps] = useState<MarketplaceAppItem[]>(initialCatalog?.apps ?? []);
  const [agentTemplates, setAgentTemplates] = useState<MarketplaceAgentPackage[]>(
    initialCatalog?.agents ?? []
  );
  const [skills, setSkills] = useState<MarketplaceSkillItem[]>(initialCatalog?.skills ?? []);
  const [yourApps, setYourApps] = useState<MarketplaceYourAppEntry[]>(initialYourApps);

  const [selectedAppSlug, setSelectedAppSlug] = useState<string | null>(initialAppSlug);
  const [appDetail, setAppDetail] = useState<MarketplaceAppItem | null>(() =>
    initialAppSlug
      ? (initialCatalog?.apps ?? []).find((a) => a.slug === initialAppSlug) ?? null
      : null
  );
  const [appAccounts, setAppAccounts] = useState<
    Array<{
      server: McpServidorConfig;
      contaRotulo: string | null;
      oauthStatus: McpOAuthStatus;
    }>
  >([]);
  const [nativeAccounts, setNativeAccounts] = useState<NativeAppAccountSummary[]>(initialNativeAccounts);
  const [allNativeAccounts, setAllNativeAccounts] =
    useState<NativeAppAccountSummary[]>(initialNativeAccounts);
  const [connectedNativeSlugs, setConnectedNativeSlugs] = useState<string[]>(() =>
    initialCatalog?.connectedNativeSlugs ??
    Array.from(new Set(initialNativeAccounts.map((a) => a.app_slug)))
  );
  const [selectedNativeContaId, setSelectedNativeContaId] = useState<string | null>(
    initialNativeAccounts[0]?.conta_id ?? null
  );
  const [nativeCreatingNew, setNativeCreatingNew] = useState(false);
  const [testingContaId, setTestingContaId] = useState<string | null>(null);
  const [activeFlowIndex, setActiveFlowIndex] = useState(0);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [contaRotuloInput, setContaRotuloInput] = useState("");
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectFeedback, setConnectFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [accessFeedback, setAccessFeedback] = useState<string | null>(null);
  const [localInstructions, setLocalInstructions] = useState<string[]>([]);

  const unlockedAgents = useMemo(
    () =>
      agentes.filter(
        (ag) =>
          ag.agente_id !== "assistente_setup" &&
          (ag.config as Record<string, unknown>)?.upgrade_desbloqueado !== false
      ),
    [agentes]
  );

  const [accessServerId, setAccessServerId] = useState<string | null>(null);
  const [accessMode, setAccessMode] = useState<"everyone" | "agents">("everyone");
  const [accessAgents, setAccessAgents] = useState<string[]>([]);
  const [tryTargetAgentId, setTryTargetAgentId] = useState(
    unlockedAgents[0]?.agente_id ?? agentes[0]?.agente_id ?? "estrategista"
  );

  const [customMcpModalOpen, setCustomMcpModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<MarketplaceYourAppEntry | null>(null);
  const [createSkillModalOpen, setCreateSkillModalOpen] = useState(false);
  const [batchSkillTarget, setBatchSkillTarget] = useState<MarketplaceSkillItem | null>(null);
  const [skillPendingDelete, setSkillPendingDelete] = useState<MarketplaceSkillItem | null>(null);

  const [githubPreview, setGithubPreview] = useState<GithubImportPreview | null>(null);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [githubUrlInput, setGithubUrlInput] = useState("");

  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const nativeSidebarEntries = useMemo(() => {
    const grouped = new Map<string, NativeAppAccountSummary[]>();
    for (const acc of allNativeAccounts) {
      if (!acc.configurado) continue;
      const list = grouped.get(acc.app_slug) ?? [];
      list.push(acc);
      grouped.set(acc.app_slug, list);
    }
    for (const slug of connectedNativeSlugs) {
      if (!grouped.has(slug)) {
        grouped.set(slug, []);
      }
    }
    return Array.from(grouped.entries()).map(([slug, accounts]) => {
      const meta = apps.find((a) => a.slug === slug);
      const primary = accounts[0];
      const handle = primary?.perfil_conectado?.username
        ? `@${primary.perfil_conectado.username.replace(/^@/, "")}`
        : primary?.conta_rotulo ?? "";
      return {
        slug,
        name: meta?.name ?? slug,
        accountsCount: accounts.length,
        subtitle:
          accounts.length > 1
            ? `${accounts.length} contas conectadas`
            : handle || "Conectado",
        allOk: accounts.length === 0 ? true : accounts.every((a) => a.testado_ok || a.configurado),
      };
    });
  }, [allNativeAccounts, connectedNativeSlugs, apps]);
  const [undoState, setUndoState] = useState<{
    skillId: string;
    skillName: string;
    previousAgentIds: string[];
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCatalogAndApps = async () => {
    try {
      const [snap, servers] = await Promise.all([
        daemonApi.getLojaCatalogo(),
        daemonApi.listMcpServers(),
      ]);
      setApps(snap.apps);
      setAgentTemplates(snap.agents);
      setSkills(snap.skills);
      setYourApps(servers);
      setAllNativeAccounts(snap.nativeAccounts ?? []);
      setConnectedNativeSlugs(
        snap.connectedNativeSlugs ??
          Array.from(new Set((snap.nativeAccounts ?? []).map((a) => a.app_slug)))
      );
    } catch {
      // Silencioso em SSR ou daemon indisponível antes do boot
    }
  };

  useEffect(() => {
    if (!initialCatalog) {
      void loadCatalogAndApps();
    }
  }, []);

  useEffect(() => {
    if (initialAppSlug) {
      setTab("apps");
      setSelectedAppSlug(initialAppSlug);
    }
  }, [initialAppSlug]);

  const applyAppDetailResponse = (
    res: Awaited<ReturnType<typeof daemonApi.getLojaAppDetail>>,
    preferredContaId?: string | null,
    preserveBlankForm = false
  ) => {
    setAppDetail(res.app);
    setAppAccounts(res.accounts);
    const nextNative = res.nativeAccounts ?? [];
    setNativeAccounts(nextNative);

    if (res.app.isNative) {
      setAccessServerId(null);
      if (preserveBlankForm) {
        return;
      }
      const chosen =
        (preferredContaId
          ? nextNative.find((acc) => acc.conta_id === preferredContaId)
          : undefined) ?? nextNative[0];
      if (chosen) {
        setSelectedNativeContaId(chosen.conta_id);
        setNativeCreatingNew(false);
        setContaRotuloInput(chosen.conta_rotulo || "");
        setFieldValues({ ...(chosen.campos_visiveis ?? {}) });
        setAccessMode(chosen.acesso?.mode ?? "everyone");
        setAccessAgents(chosen.acesso?.agentIds ?? []);
      } else {
        setSelectedNativeContaId(null);
        setNativeCreatingNew(false);
        setContaRotuloInput("");
        setFieldValues({});
        setAccessMode("everyone");
        setAccessAgents([]);
      }
      return;
    }

    setNativeAccounts([]);
    setSelectedNativeContaId(null);
    setNativeCreatingNew(false);
    const firstAcc = res.accounts[0]?.server;
    if (firstAcc) {
      setAccessServerId(firstAcc.mcp_id);
      setAccessMode(firstAcc.acesso.mode);
      setAccessAgents(firstAcc.acesso.agentIds);
    } else {
      setAccessServerId(null);
      setAccessMode("everyone");
      setAccessAgents([]);
    }
  };

  useEffect(() => {
    setConnectFeedback(null);
    setAccessFeedback(null);
    setLocalInstructions([]);
    setNativeCreatingNew(false);
    setSelectedNativeContaId(null);
    if (!selectedAppSlug) {
      setAppDetail(null);
      setAppAccounts([]);
      setNativeAccounts([]);
      return;
    }
    const localFound = apps.find((a) => a.slug === selectedAppSlug) ?? null;
    if (localFound) setAppDetail(localFound);

    void daemonApi
      .getLojaAppDetail(selectedAppSlug)
      .then((res) => applyAppDetailResponse(res))
      .catch(() => {
        // Usa versão em memória caso esteja em teste isolado
      });
  }, [selectedAppSlug]);

  useEffect(() => {
    if ((tab === "skills" || tab === "agents") && isGithubUrlCandidate(query)) {
      const kind = tab === "agents" ? "agents" : "skills";
      setGithubLoading(true);
      const timer = setTimeout(() => {
        void daemonApi
          .inspectGithubRepo(query.trim(), kind)
          .then(setGithubPreview)
          .catch(() => setGithubPreview(null))
          .finally(() => setGithubLoading(false));
      }, 280);
      return () => clearTimeout(timer);
    }
    setGithubPreview(null);
  }, [query, tab]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  const normalizedQuery = query.trim().toLowerCase();

  const filteredApps = useMemo(() => {
    return apps.filter((app) => {
      if (expandedCategory && app.category !== expandedCategory) return false;
      if (!normalizedQuery) return true;
      return (
        app.name.toLowerCase().includes(normalizedQuery) ||
        app.tagline.toLowerCase().includes(normalizedQuery) ||
        app.category.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [apps, normalizedQuery, expandedCategory]);

  const appGroups = useMemo(() => groupByCategory(filteredApps), [filteredApps]);

  const filteredAgents = useMemo(() => {
    return agentTemplates.filter((ag) => {
      if (sourceFilter === "verified" && !ag.verified) return false;
      if (sourceFilter === "public" && ag.verified) return false;
      if (!normalizedQuery || isGithubUrlCandidate(query)) return true;
      return (
        ag.name.toLowerCase().includes(normalizedQuery) ||
        ag.role.toLowerCase().includes(normalizedQuery) ||
        ag.description.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [agentTemplates, sourceFilter, normalizedQuery, query]);

  const filteredSkills = useMemo(() => {
    return skills.filter((sk) => {
      if (sourceFilter === "verified" && !sk.verified) return false;
      if (sourceFilter === "public" && sk.verified) return false;
      if (!normalizedQuery || isGithubUrlCandidate(query)) return true;
      return (
        sk.name.toLowerCase().includes(normalizedQuery) ||
        sk.description.toLowerCase().includes(normalizedQuery) ||
        sk.category.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [skills, sourceFilter, normalizedQuery, query]);

  const installedSkills = useMemo(
    () => filteredSkills.filter((sk) => sk.installed),
    [filteredSkills]
  );
  const catalogSkillGroups = useMemo(
    () => groupByCategory(filteredSkills.filter((sk) => !sk.installed)),
    [filteredSkills]
  );

  const totalAgentsCount = Math.max(1, unlockedAgents.length);

  const selectNativeAccount = (acc: NativeAppAccountSummary) => {
    setNativeCreatingNew(false);
    setSelectedNativeContaId(acc.conta_id);
    setContaRotuloInput(acc.conta_rotulo || "");
    setFieldValues({ ...(acc.campos_visiveis ?? {}) });
    setAccessMode(acc.acesso?.mode ?? "everyone");
    setAccessAgents(acc.acesso?.agentIds ?? []);
    setConnectFeedback(null);
    setAccessFeedback(null);
  };

  const handleStartNewNativeAccount = () => {
    setNativeCreatingNew(true);
    setSelectedNativeContaId(null);
    setContaRotuloInput("");
    setFieldValues({});
    setConnectFeedback({
      ok: true,
      text: "Preencha as credenciais da nova conta abaixo e clique em Testar conexão.",
    });
  };

  const handleConnectAppFlow = async (flow: MarketplaceAuthFlow) => {
    if (!appDetail) return;
    if (appDetail.slug === "whatsapp" && onOpenWhatsAppModal) {
      onOpenWhatsAppModal();
      return;
    }

    setConnectBusy(true);
    setConnectFeedback(null);
    setAccessFeedback(null);
    setLocalInstructions([]);
    try {
      const targetContaId =
        appDetail.isNative && !nativeCreatingNew && selectedNativeContaId
          ? selectedNativeContaId
          : undefined;
      const res = await daemonApi.connectLojaApp(appDetail.slug, {
        flowId: flow.id,
        kind: flow.kind,
        contaId: targetContaId,
        contaRotulo: contaRotuloInput.trim() || undefined,
        fields: fieldValues,
        acesso: {
          mode: accessMode,
          agentIds: accessMode === "agents" ? accessAgents : [],
        },
      });

      if (res.authorizeUrl && typeof window !== "undefined") {
        window.open(res.authorizeUrl, "_blank", "noopener,noreferrer");
        setConnectFeedback({ ok: true, text: "Aguardando autenticação no navegador..." });
      } else if (res.instructions && res.instructions.length > 0) {
        setLocalInstructions(res.instructions);
        setConnectFeedback({
          ok: res.probe?.status === "passed",
          text:
            res.probe?.status === "passed"
              ? `App local validado (${res.probe.toolCount} ferramentas).`
              : "Siga os passos abaixo no aplicativo local e execute Testar conexão.",
        });
      } else if (res.nativeAccount) {
        const acc = res.nativeAccount;
        const ok = Boolean(res.validationReport?.ok ?? acc.testado_ok);
        const rawHandle = acc.perfil_conectado?.username?.replace(/^@/, "") ?? "";
        const usernameSuffix = rawHandle ? ` (@${rawHandle})` : "";
        const resumo = res.validationReport?.resumo ?? "";
        const resumoHasHandle =
          Boolean(rawHandle) &&
          resumo.toLowerCase().includes(rawHandle.toLowerCase());
        const text = resumo
          ? `${resumo}${resumoHasHandle ? "" : usernameSuffix}`
          : ok
            ? `Conta "${acc.conta_rotulo}" conectada no Cofre${usernameSuffix}.`
            : acc.ultimo_erro || "Credenciais salvas no Cofre AES-256-GCM. Verifique os dados na Meta.";
        setConnectFeedback({ ok, text });
      } else {
        setConnectFeedback({
          ok: true,
          text:
            res.probe?.status === "passed"
              ? `Conectado com ${res.probe.toolCount} ferramentas disponíveis.`
              : "Configuração salva no Cofre AES-256-GCM.",
        });
      }
      await loadCatalogAndApps();
      if (selectedAppSlug) {
        const refreshed = await daemonApi.getLojaAppDetail(selectedAppSlug);
        applyAppDetailResponse(refreshed, res.nativeAccount?.conta_id ?? targetContaId ?? null);
      }
    } catch (err) {
      setConnectFeedback({
        ok: false,
        text: err instanceof Error ? err.message : "Falha ao conectar aplicativo.",
      });
    } finally {
      setConnectBusy(false);
    }
  };

  const handleTestNativeAccount = async (contaId: string) => {
    if (!appDetail) return;
    setTestingContaId(contaId);
    setConnectFeedback(null);
    try {
      const res = await daemonApi.testNativeAppConnection(appDetail.slug, { contaId });
      setConnectFeedback({ ok: res.ok, text: res.resumo });
      await loadCatalogAndApps();
      if (selectedAppSlug) {
        const refreshed = await daemonApi.getLojaAppDetail(selectedAppSlug);
        applyAppDetailResponse(refreshed, contaId);
      }
    } catch (err) {
      setConnectFeedback({
        ok: false,
        text: err instanceof Error ? err.message : "Falha ao testar conta conectada.",
      });
    } finally {
      setTestingContaId(null);
    }
  };

  const handleDeleteNativeAccount = async (contaId: string) => {
    if (!appDetail) return;
    setConnectBusy(true);
    setConnectFeedback(null);
    try {
      await daemonApi.deleteNativeAppAccount(appDetail.slug, contaId);
      setConnectFeedback({ ok: true, text: "Conta removida do Cofre com segurança." });
      await loadCatalogAndApps();
      if (selectedAppSlug) {
        const refreshed = await daemonApi.getLojaAppDetail(selectedAppSlug);
        applyAppDetailResponse(refreshed, null);
      }
    } catch (err) {
      setConnectFeedback({
        ok: false,
        text: err instanceof Error ? err.message : "Falha ao desconectar conta.",
      });
    } finally {
      setConnectBusy(false);
    }
  };

  const handleApplyAgentAccess = async () => {
    if (!appDetail) return;
    const acessoPayload: McpAcessoAgentes = {
      mode: accessMode,
      agentIds: accessMode === "agents" ? accessAgents : [],
    };
    setAccessFeedback(null);
    if (appDetail.isNative) {
      try {
        const res = await daemonApi.updateNativeAppAccess(appDetail.slug, {
          contaId: selectedNativeContaId,
          acesso: acessoPayload,
        });
        setNativeAccounts(res.nativeAccounts);
        const targetAcc =
          (selectedNativeContaId
            ? res.nativeAccounts.find((a) => a.conta_id === selectedNativeContaId)
            : res.nativeAccounts[0]) ?? null;
        if (targetAcc) {
          setAccessMode(targetAcc.acesso.mode);
          setAccessAgents(targetAcc.acesso.agentIds);
        }
        setAccessFeedback(
          accessMode === "everyone"
            ? "Acesso liberado para todos os agentes do estúdio."
            : `Acesso atualizado para ${acessoPayload.agentIds.length} agente(s) selecionado(s).`
        );
        await loadCatalogAndApps();
        await onRefreshStudio?.();
      } catch (err) {
        setAccessFeedback(
          err instanceof Error ? err.message : "Falha ao atualizar permissões deste conector."
        );
      }
      return;
    }

    if (!accessServerId) return;
    await daemonApi.setMcpServerStatus(accessServerId, {
      acesso: acessoPayload,
    });
    setAccessFeedback("Permissões de agentes atualizadas com sucesso.");
    await loadCatalogAndApps();
  };

  const handleInstallAgentTemplate = async (pkg: MarketplaceAgentPackage) => {
    const installed = await daemonApi.installLojaAgent(pkg.slug);
    setFeedbackBanner(`Agente "${installed.agente.nome}" instalado no estúdio.`);
    await onRefreshStudio?.();
  };

  const handleConfirmSkillBatch = async (
    skill: MarketplaceSkillItem,
    nextAgentIds: string[]
  ) => {
    const res = await daemonApi.setSkillAgentsBatch(skill.skillId, nextAgentIds);
    await loadCatalogAndApps();
    await onRefreshStudio?.();

    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoState({
      skillId: res.skillId,
      skillName: skill.name,
      previousAgentIds: res.previousAgentIds,
    });
    undoTimerRef.current = setTimeout(() => {
      setUndoState(null);
    }, 6000);
  };

  const handleUndoSkillBatch = async () => {
    if (!undoState) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const target = undoState;
    setUndoState(null);
    await daemonApi.setSkillAgentsBatch(target.skillId, target.previousAgentIds);
    await loadCatalogAndApps();
    await onRefreshStudio?.();
  };

  const handleInstallGithubItem = async (
    repoUrl: string,
    kind: "skills" | "agents",
    itemPath: string
  ) => {
    const res = await daemonApi.installFromGithub({
      url: repoUrl,
      kind,
      itemPaths: [itemPath],
      targetAgentIds: ["estrategista"],
    });
    setFeedbackBanner(`${res.installedCount} item(ns) instalados a partir do GitHub.`);
    await loadCatalogAndApps();
    await onRefreshStudio?.();
  };

  const agentSelectOptions: CarbonSelectOption[] = useMemo(
    () =>
      (unlockedAgents.length > 0
        ? unlockedAgents
        : [{ agente_id: "estrategista", nome: "Estrategista Editorial" } as AgenteRegistro]
      ).map((ag) => ({
        value: ag.agente_id,
        label: ag.nome,
      })),
    [unlockedAgents]
  );

  // ------------------------------------------------------------------
  // Render da página detalhada do app (`MarketplaceAppPage`)
  // ------------------------------------------------------------------
  const renderAppDetailPage = () => {
    if (!appDetail) return null;
    const flows = appDetail.authFlows ?? [];
    const activeFlow = flows[activeFlowIndex] ?? flows[0];
    const hasConnected = appAccounts.length > 0 || nativeAccounts.length > 0;
    const selectedNativeAcc =
      (!nativeCreatingNew
        ? nativeAccounts.find((a) => a.conta_id === selectedNativeContaId)
        : undefined) ?? null;

    return (
      <div className="space-y-6">
        <nav aria-label="Breadcrumb da Loja" className="flex items-center gap-2 text-[12px] text-[#979797]">
          <button
            type="button"
            onClick={() => setSelectedAppSlug(null)}
            className="text-[#42A0FF] hover:text-[#F0F0F0]"
          >
            Apps
          </button>
          <span>&gt;</span>
          <button
            type="button"
            onClick={() => {
              setExpandedCategory(appDetail.category);
              setSelectedAppSlug(null);
            }}
            className="text-[#42A0FF] hover:text-[#F0F0F0]"
          >
            {appDetail.category}
          </button>
          <span>&gt;</span>
          <span className="text-[#F0F0F0]">{appDetail.name}</span>
        </nav>

        <section className="rounded-[14px] border border-[#2A2A2A] bg-[#212121] p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <AppBrandIcon slug={appDetail.slug} name={appDetail.name} size={48} />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-[28px] font-semibold leading-[1.2] text-[#F0F0F0]">
                    {appDetail.name}
                  </h1>
                  {appDetail.verified && (
                    <span className="rounded-full bg-[#31CF76]/15 px-2.5 py-0.5 text-[12px] font-semibold text-[#31CF76]">
                      Verificado
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-[#979797]">
                  {appDetail.creatorName} · {appDetail.category}
                </p>
                <p className="text-[14px] text-[#DCDCDC]">{appDetail.description}</p>
              </div>
            </div>

            {activeFlow && (
              <div className="flex items-center gap-2">
                {appDetail.isNative && hasConnected && !nativeCreatingNew && (
                  <button
                    type="button"
                    disabled={connectBusy}
                    onClick={handleStartNewNativeAccount}
                    className="rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[13px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                  >
                    + Adicionar outra conta
                  </button>
                )}
                <button
                  type="button"
                  disabled={connectBusy}
                  onClick={() => void handleConnectAppFlow(activeFlow)}
                  className="rounded-full bg-[#F0F0F0] px-5 py-2 text-[14px] font-semibold text-[#141414] hover:bg-white disabled:opacity-50"
                >
                  {appDetail.isNative && selectedNativeAcc
                    ? "Atualizar e validar"
                    : hasConnected
                      ? "Adicionar outra conta"
                      : "Conectar aplicativo"}
                </button>
              </div>
            )}
          </div>

          {flows.length > 1 && (
            <SlidingTabs<string>
              ariaLabel="Fluxos de autenticação suportados"
              value={activeFlow?.id ?? "0"}
              onChange={(flowId) => {
                const idx = flows.findIndex((f) => f.id === flowId);
                if (idx >= 0) setActiveFlowIndex(idx);
              }}
              tabs={flows.map((f) => ({ id: f.id, label: f.label }))}
            />
          )}

          {activeFlow && (
            <div className="space-y-4 rounded-[12px] border border-[#2A2A2A] bg-[#1A1A1A] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[14px] font-semibold text-[#F0F0F0]">
                  {activeFlow.label}
                </span>
                {activeFlow.kind === "oauth" && (
                  <button
                    type="button"
                    disabled={connectBusy}
                    onClick={() => void handleConnectAppFlow(activeFlow)}
                    className="rounded-full bg-[#F0F0F0] px-4 py-1.5 text-[14px] font-semibold text-[#141414]"
                  >
                    Autenticar no navegador
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="block text-[12px] font-semibold text-[#979797]">
                    Rótulo da conta
                  </label>
                  <input
                    type="text"
                    value={contaRotuloInput}
                    onChange={(e) => setContaRotuloInput(e.target.value)}
                    placeholder={`Conta ${Math.max(appAccounts.length, nativeAccounts.length) + 1}`}
                    className="w-full rounded-[8px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 text-[14px] text-[#F0F0F0]"
                  />
                </div>
                {(activeFlow.fields ?? []).map((fld) => {
                  const maskedStored = selectedNativeAcc?.campos_mascarados?.[fld.key];
                  return (
                    <div key={fld.key} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <label className="block text-[12px] font-semibold text-[#979797]">
                          {fld.label}
                        </label>
                        {maskedStored && (
                          <span className="rounded-full bg-[#31CF76]/15 px-2 py-0.5 text-[10px] font-semibold text-[#31CF76]">
                            Salvo no Cofre ({maskedStored})
                          </span>
                        )}
                      </div>
                      <input
                        type={fld.secret ? "password" : "text"}
                        value={fieldValues[fld.key] ?? ""}
                        onChange={(e) =>
                          setFieldValues((prev) => ({ ...prev, [fld.key]: e.target.value }))
                        }
                        placeholder={
                          maskedStored
                            ? `Salvo (${maskedStored}) — deixe vazio para manter`
                            : fld.placeholder ?? ""
                        }
                        className="w-full rounded-[8px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 font-mono text-[12px] text-[#F0F0F0]"
                      />
                    </div>
                  );
                })}
              </div>

              {activeFlow.kind !== "oauth" && (
                <div className="flex items-center justify-end gap-2">
                  {activeFlow.helpUrl && (
                    <a
                      href={activeFlow.helpUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[12px] text-[#42A0FF] hover:underline"
                    >
                      {activeFlow.docsLabel || "Abrir documentação"} <ExternalLink size={12} />
                    </a>
                  )}
                  <button
                    type="button"
                    disabled={connectBusy}
                    onClick={() => void handleConnectAppFlow(activeFlow)}
                    className="rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-1.5 text-[14px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                  >
                    {connectBusy ? "Testando..." : "Testar conexão"}
                  </button>
                </div>
              )}

              {localInstructions.length > 0 && (
                <ol className="list-decimal space-y-1 pl-5 text-[12px] text-[#DCDCDC]">
                  {localInstructions.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              )}

              {connectFeedback && (
                <p
                  className={`text-[12px] font-semibold ${
                    connectFeedback.ok ? "text-[#31CF76]" : "text-[#FD2F3B]"
                  }`}
                >
                  {connectFeedback.text}
                </p>
              )}
            </div>
          )}
        </section>

        {nativeAccounts.length > 0 && (
          <section className="rounded-[14px] border border-[#2A2A2A] bg-[#212121] p-6 space-y-3">
            <h2 className="text-[20px] font-semibold text-[#F0F0F0]">Contas conectadas</h2>
            {nativeAccounts.map((acc) => {
              const isSelected = !nativeCreatingNew && selectedNativeContaId === acc.conta_id;
              const isTesting = testingContaId === acc.conta_id;
              const handleLabel = acc.perfil_conectado?.username
                ? `@${acc.perfil_conectado.username}`
                : acc.campos_visiveis?.IG_USER_ID || acc.campos_visiveis?.META_WABA_ID || "";
              return (
                <div
                  key={acc.conta_id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-[10px] border p-4 ${
                    isSelected
                      ? "border-[#007CF7]/60 bg-[#142030]"
                      : "border-[#2A2A2A] bg-[#1A1A1A]"
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[14px] font-semibold text-[#F0F0F0]">
                        {acc.conta_rotulo || "Conta"}
                      </p>
                      {handleLabel && (
                        <span className="font-mono text-[12px] text-[#42A0FF]">{handleLabel}</span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          acc.testado_ok
                            ? "bg-[#31CF76]/15 text-[#31CF76]"
                            : acc.ultimo_erro
                              ? "bg-[#FD2F3B]/15 text-[#FD2F3B]"
                              : "bg-[#FF9412]/15 text-[#FF9412]"
                        }`}
                      >
                        {acc.testado_ok
                          ? "Conectada"
                          : acc.ultimo_erro
                            ? "Falha na validação"
                            : "Salva no Cofre"}
                      </span>
                    </div>
                    <p className="text-[12px] text-[#979797]">
                      {acc.perfil_conectado?.followers_count != null
                        ? `${acc.perfil_conectado.followers_count} seguidores · ${acc.perfil_conectado.media_count ?? 0} mídias · `
                        : ""}
                      Acesso:{" "}
                      {acc.acesso?.mode === "agents"
                        ? `${acc.acesso.agentIds.length} agente(s) liberado(s)`
                        : "Todos os agentes"}
                    </p>
                    {acc.ultimo_erro && (
                      <p className="text-[11px] text-[#FD2F3B]">{acc.ultimo_erro}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => selectNativeAccount(acc)}
                      className="rounded-full border border-[#2A2A2A] bg-[#242424] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                    >
                      {isSelected ? "Editando" : "Selecionar"}
                    </button>
                    <button
                      type="button"
                      disabled={isTesting}
                      onClick={() => void handleTestNativeAccount(acc.conta_id)}
                      className="rounded-full border border-[#2A2A2A] bg-[#242424] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A] disabled:opacity-50"
                    >
                      {isTesting ? "Testando..." : "Testar conexão"}
                    </button>
                    <button
                      type="button"
                      disabled={connectBusy}
                      onClick={() => void handleDeleteNativeAccount(acc.conta_id)}
                      className="rounded-full border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 px-3 py-1.5 text-[12px] font-semibold text-[#FD2F3B] hover:bg-[#FD2F3B]/20"
                    >
                      Desconectar conta
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {appAccounts.length > 0 && (
          <section className="rounded-[14px] border border-[#2A2A2A] bg-[#212121] p-6 space-y-3">
            <h2 className="text-[20px] font-semibold text-[#F0F0F0]">Contas conectadas</h2>
            {appAccounts.map((acc, idx) => (
              <div
                key={acc.server.mcp_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[#2A2A2A] bg-[#1A1A1A] p-4"
              >
                <div>
                  <p className="text-[14px] font-semibold text-[#F0F0F0]">
                    {acc.contaRotulo || `Conta #${idx + 1}`} (#account-{idx + 1})
                  </p>
                  <p className="text-[12px] text-[#979797]">
                    {acc.server.qtdFerramentas} ferramentas descobertas ·{" "}
                    {acc.oauthStatus === "lost" ? "Reautenticar" : acc.server.ativo ? "Conectado" : "Inativo"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void daemonApi.testMcpServer(acc.server.mcp_id).then(() => loadCatalogAndApps())}
                    className="rounded-full border border-[#2A2A2A] bg-[#242424] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0]"
                  >
                    Testar conexão
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void daemonApi
                        .disconnectMcpOAuth(acc.server.mcp_id)
                        .then(() => daemonApi.deleteMcpServer(acc.server.mcp_id))
                        .then(() => loadCatalogAndApps())
                    }
                    className="rounded-full border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 px-3 py-1.5 text-[12px] font-semibold text-[#FD2F3B]"
                  >
                    Desconectar conta
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="rounded-[14px] border border-[#2A2A2A] bg-[#212121] p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[20px] font-semibold text-[#F0F0F0]">Acesso de agentes</h2>
              <p className="text-[12px] text-[#979797]">
                Defina quais agentes da sua licença podem usar as ferramentas deste conector no chat e em fluxos.
              </p>
            </div>
            <SlidingTabs<"everyone" | "agents">
              ariaLabel="Controle de acesso por agente"
              value={accessMode}
              onChange={setAccessMode}
              tabs={[
                { id: "everyone", label: "Todos os agentes" },
                { id: "agents", label: "Agentes selecionados" },
              ]}
            />
          </div>
          {accessMode === "agents" && (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              {unlockedAgents.map((ag) => {
                const checked = accessAgents.includes(ag.agente_id);
                return (
                  <label
                    key={ag.agente_id}
                    className="flex cursor-pointer items-center gap-2 rounded-[8px] border border-[#2A2A2A] bg-[#1A1A1A] px-3 py-2 text-[14px] text-[#F0F0F0]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setAccessAgents((prev) =>
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
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="min-h-[18px]">
              {accessFeedback && (
                <p className="text-[12px] font-semibold text-[#31CF76]">{accessFeedback}</p>
              )}
            </div>
            {(accessServerId || appDetail.isNative) && (
              <button
                type="button"
                onClick={() => void handleApplyAgentAccess()}
                className="rounded-full bg-[#F0F0F0] px-4 py-1.5 text-[14px] font-semibold text-[#141414] hover:bg-white"
              >
                Aplicar acesso
              </button>
            )}
          </div>
        </section>

        {appDetail.prompts && appDetail.prompts.length > 0 && (
          <section className="rounded-[14px] border border-[#2A2A2A] bg-[#212121] p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[20px] font-semibold text-[#F0F0F0]">Experimentar no chat</h2>
              <div className="w-64">
                <CarbonSelect
                  ariaLabel="Selecionar agente destino para testar prompt"
                  value={tryTargetAgentId}
                  options={agentSelectOptions}
                  onChange={setTryTargetAgentId}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {appDetail.prompts.map((pr, idx) => (
                <div
                  key={`${pr.id}-${idx}`}
                  className="flex flex-col justify-between gap-3 rounded-[12px] border border-[#2A2A2A] bg-[#1A1A1A] p-4"
                >
                  <div className="space-y-1">
                    {pr.title && (
                      <p className="text-[14px] font-semibold text-[#F0F0F0]">{pr.title}</p>
                    )}
                    <p className="text-[14px] text-[#979797]">{pr.text}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onTryPromptInChat?.(tryTargetAgentId, pr.text)}
                    className="self-start text-[14px] font-semibold text-[#42A0FF] hover:underline"
                  >
                    Experimentar prompt
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-1 bg-[#1A1A1A] text-[#F0F0F0]">
      {/* Barra Lateral Interna da Loja (224px, #141414) */}
      <aside
        aria-label="Navegação da Loja"
        className="flex w-[224px] shrink-0 flex-col border-r border-[#2A2A2A] bg-[#141414] p-4 space-y-6 overflow-y-auto"
      >
        <div className="space-y-1">
          <p className="px-2 pb-1 text-[12px] font-semibold uppercase tracking-wide text-[#979797]">
            Loja
          </p>
          {[
            { id: "apps" as const, label: "Apps", count: apps.length, Icon: Blocks },
            { id: "agents" as const, label: "Agentes", count: agentTemplates.length, Icon: Bot },
            { id: "skills" as const, label: "Habilidades", count: skills.length, Icon: Sparkles },
          ].map(({ id, label, count, Icon }) => {
            const active = tab === id && !selectedAppSlug;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTab(id);
                  setSelectedAppSlug(null);
                  setExpandedCategory(null);
                }}
                className={`relative flex w-full items-center justify-between rounded-[8px] px-3 py-2 text-[14px] transition-colors ${
                  active
                    ? "bg-[#212121] font-semibold text-[#F0F0F0]"
                    : "text-[#979797] hover:bg-[#1A1A1A] hover:text-[#F0F0F0]"
                }`}
              >
                {tab === id && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-[#007CF7]" />
                )}
                <span className="flex items-center gap-2">
                  <Icon size={16} />
                  <span>{label}</span>
                </span>
                <span className="text-[12px] tabular-nums text-[#979797]">{count}</span>
              </button>
            );
          })}
        </div>

        {(tab === "agents" || tab === "skills") && (
          <div className="space-y-2">
            <p className="px-2 text-[12px] font-semibold text-[#979797]">Origem</p>
            <SlidingTabs<MarketplaceSourceFilter>
              ariaLabel="Filtro de origem"
              value={sourceFilter}
              onChange={setSourceFilter}
              variant="subtle"
              className="flex-wrap"
              tabs={[
                { id: "all", label: "Todos" },
                { id: "verified", label: "Verificados" },
                { id: "public", label: "Públicos" },
              ]}
            />
          </div>
        )}

        <div className="space-y-2 border-t border-[#2A2A2A] pt-4">
          <p className="px-2 text-[12px] font-semibold text-[#979797]">Seus apps</p>
          {yourApps.length === 0 && nativeSidebarEntries.length === 0 ? (
            <div className="space-y-2 rounded-[10px] border border-[#2A2A2A] bg-[#1A1A1A] p-3">
              <p className="text-[12px] font-semibold text-[#F0F0F0]">
                Nenhum aplicativo conectado ainda
              </p>
              <p className="text-[12px] text-[#979797]">
                Conecte Canva, Figma ou registre um servidor MCP personalizado.
              </p>
              <button
                type="button"
                onClick={() => {
                  setTab("apps");
                  setSelectedAppSlug(null);
                }}
                className="text-[12px] font-semibold text-[#42A0FF] hover:underline"
              >
                Explorar aplicativos
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {nativeSidebarEntries.map((entry) => (
                <button
                  key={`native:${entry.slug}`}
                  type="button"
                  onClick={() => {
                    setTab("apps");
                    setSelectedAppSlug(entry.slug);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-[8px] px-2.5 py-2 text-left text-[12px] text-[#DCDCDC] hover:bg-[#212121]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <AppBrandIcon slug={entry.slug} name={entry.name} size={20} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-[#F0F0F0]">{entry.name}</span>
                      <span className="block truncate text-[10.5px] text-[#979797]">
                        {entry.subtitle}
                      </span>
                    </span>
                  </span>
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: entry.allOk ? "#31CF76" : "#FF9412" }}
                  />
                </button>
              ))}
              {yourApps.map((srv) => (
                <button
                  key={srv.mcp_id}
                  type="button"
                  onClick={() => {
                    if (srv.origemAppSlug) {
                      setTab("apps");
                      setSelectedAppSlug(srv.origemAppSlug);
                    } else {
                      setEditingServer(srv);
                      setCustomMcpModalOpen(true);
                    }
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-[8px] px-2.5 py-2 text-left text-[12px] text-[#DCDCDC] hover:bg-[#212121]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <AppBrandIcon slug={srv.origemAppSlug} name={srv.nome} size={20} kind="mcp" />
                    <span className="truncate">{srv.nome}</span>
                  </span>
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: statusDotColor(srv) }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Conteúdo Principal (#1A1A1A) */}
      <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8 space-y-6 pb-16">
        {feedbackBanner && (
          <div className="flex items-center justify-between rounded-[12px] border border-[#31CF76]/40 bg-[#31CF76]/10 px-4 py-2 text-[14px] text-[#31CF76]">
            <span>{feedbackBanner}</span>
            <button type="button" onClick={() => setFeedbackBanner(null)}>
              <X size={14} />
            </button>
          </div>
        )}

        {selectedAppSlug ? (
          renderAppDetailPage()
        ) : (
          <>
            <header className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-[28px] font-semibold leading-[1.2] text-[#F0F0F0]">
                  {tab === "apps" ? "Apps" : tab === "agents" ? "Agentes" : "Habilidades"}
                </h1>
                <p className="mt-1 text-[14px] text-[#979797]">
                  {tab === "apps"
                    ? "Conecte serviços criativos, ferramentas MCP e integrações nativas do estúdio."
                    : tab === "agents"
                      ? "Instale especialistas em 1 clique ou importe agentes públicos de repositórios."
                      : "Gerencie instruções reutilizáveis (SKILL.md) e vincule aos seus agentes."}
                </p>
              </div>

              {tab === "apps" && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingServer(null);
                    setCustomMcpModalOpen(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                >
                  <Plus size={16} /> Adicionar personalizado
                </button>
              )}
              {tab === "agents" && (
                <button
                  type="button"
                  onClick={() => setGithubModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                >
                  <Github size={16} /> Importar repositório
                </button>
              )}
              {tab === "skills" && (
                <button
                  type="button"
                  onClick={() => setCreateSkillModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414] hover:bg-white"
                >
                  <Plus size={16} /> Criar habilidade
                </button>
              )}
            </header>

            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-3 text-[#979797]" />
              <input
                type="search"
                aria-label="Buscar na Loja"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar apps, habilidades ou colar link do GitHub..."
                className="w-full rounded-[12px] border border-[#2A2A2A] bg-[#242424] py-2.5 pl-10 pr-4 text-[14px] text-[#F0F0F0] placeholder-[#979797] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
              />
            </div>

            {expandedCategory && (
              <div className="flex items-center gap-2 text-[12px] text-[#979797]">
                <button
                  type="button"
                  onClick={() => setExpandedCategory(null)}
                  className="inline-flex items-center gap-1 text-[#42A0FF] hover:underline"
                >
                  <ArrowLeft size={14} /> Apps &gt; {expandedCategory}
                </button>
              </div>
            )}

            {/* Preview de repositório GitHub colado na busca */}
            {(tab === "skills" || tab === "agents") && isGithubUrlCandidate(query) && (
              <section className="space-y-3 rounded-[14px] border border-[#FF9412]/50 bg-[#212121] p-4">
                <div className="flex items-start gap-2 rounded-[10px] border border-[#FF9412]/40 bg-[#FF9412]/10 p-3 text-[12px] text-[#FF9412]">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>
                    Origem externa do GitHub: este pacote não foi auditado pela equipe do estúdio. Revise as instruções antes de vincular aos seus agentes.
                  </span>
                </div>
                {githubLoading ? (
                  <p className="text-[14px] text-[#979797]">Inspecionando repositório GitHub...</p>
                ) : githubPreview && githubPreview.items.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {githubPreview.items.map((item) => (
                      <div
                        key={item.path}
                        className="flex items-center justify-between gap-3 rounded-[10px] border border-[#2A2A2A] bg-[#1A1A1A] p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[14px] font-semibold text-[#F0F0F0]">
                            {item.name}
                          </p>
                          <p className="truncate text-[12px] text-[#979797]">{item.description}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            void handleInstallGithubItem(
                              githubPreview.repositoryUrl,
                              githubPreview.kind,
                              item.path
                            )
                          }
                          className="shrink-0 rounded-full bg-[#F0F0F0] px-3 py-1.5 text-[12px] font-semibold text-[#141414]"
                        >
                          {githubPreview.kind === "agents" ? "Instalar agente" : "Instalar habilidade"}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-[#979797]">
                    Nenhum arquivo SKILL.md ou manifesto compatível localizado neste repositório.
                  </p>
                )}
              </section>
            )}

            {/* Conteúdo da Aba Apps */}
            {tab === "apps" && (
              appGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center space-y-3 rounded-[14px] border border-[#2A2A2A] bg-[#212121] py-12 px-4 text-center">
                  <h2 className="text-[20px] font-semibold text-[#F0F0F0]">
                    Nenhum resultado encontrado na Loja
                  </h2>
                  <p className="text-[14px] text-[#979797]">
                    Tente outro termo, cole um link do GitHub (owner/repo) ou adicione um servidor MCP personalizado.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setExpandedCategory(null);
                      }}
                      className="rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0]"
                    >
                      Limpar filtros
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomMcpModalOpen(true)}
                      className="rounded-full bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414]"
                    >
                      Adicionar personalizado
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-8">
                  {appGroups.map((group) => {
                    const visible = expandedCategory ? group.items : group.items.slice(0, 6);
                    return (
                      <section key={group.category} className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <h2 className="text-[20px] font-semibold text-[#F0F0F0]">
                              {group.category}
                            </h2>
                            <span className="text-[12px] text-[#979797] tabular-nums">
                              {group.items.length}
                            </span>
                          </div>
                          {!expandedCategory && group.items.length > 6 && (
                            <button
                              type="button"
                              onClick={() => setExpandedCategory(group.category)}
                              className="text-[14px] font-semibold text-[#42A0FF] hover:underline"
                            >
                              Ver todos
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                          {visible.map((app) => {
                            const nativeAccountsForApp = allNativeAccounts.filter(
                              (a) => a.app_slug === app.slug && a.configurado
                            );
                            const hasNativeConn =
                              nativeAccountsForApp.length > 0 ||
                              connectedNativeSlugs.includes(app.slug);
                            const connected =
                              hasNativeConn ||
                              yourApps.some((s) => s.origemAppSlug === app.slug && s.ativo);
                            return (
                              <button
                                key={app.slug}
                                type="button"
                                onClick={() => setSelectedAppSlug(app.slug)}
                                className={`flex flex-col justify-between gap-3 rounded-[12px] border bg-[#212121] p-4 text-left transition-colors hover:border-[#42A0FF]/50 ${
                                  connected ? "border-[#31CF76]/35" : "border-[#2A2A2A]"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-3 min-w-0">
                                    <AppBrandIcon slug={app.slug} name={app.name} size={32} />
                                    <div className="min-w-0">
                                      <p className="truncate text-[14px] font-semibold text-[#F0F0F0]">
                                        {app.name}
                                      </p>
                                      <p className="truncate text-[12px] text-[#979797]">
                                        {app.creatorName}
                                      </p>
                                    </div>
                                  </div>
                                  {connected && (
                                    <span className="shrink-0 rounded-full bg-[#31CF76]/15 px-2 py-0.5 text-[12px] font-semibold text-[#31CF76]">
                                      {nativeAccountsForApp.length > 1
                                        ? `${nativeAccountsForApp.length} contas`
                                        : "Conectado"}
                                    </span>
                                  )}
                                </div>
                                <p className="line-clamp-2 text-[14px] text-[#DCDCDC]">
                                  {app.tagline}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )
            )}

            {/* Conteúdo da Aba Agentes */}
            {tab === "agents" && (
              <div className="space-y-8">
                <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {filteredAgents.map((pkg) => (
                    <div
                      key={pkg.slug}
                      className="flex flex-col justify-between gap-4 rounded-[12px] border border-[#2A2A2A] bg-[#212121] p-4"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-[14px] font-semibold text-[#F0F0F0]">{pkg.name}</h3>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${
                              pkg.verified
                                ? "bg-[#31CF76]/15 text-[#31CF76]"
                                : "bg-[#242424] text-[#979797]"
                            }`}
                          >
                            {pkg.verified ? "Verificado" : "Público"}
                          </span>
                        </div>
                        <p className="text-[12px] text-[#979797]">{pkg.role}</p>
                        <p className="text-[14px] text-[#DCDCDC]">{pkg.description}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleInstallAgentTemplate(pkg)}
                        className="rounded-full bg-[#F0F0F0] px-4 py-1.5 text-[14px] font-semibold text-[#141414] hover:bg-white"
                      >
                        Instalar agente
                      </button>
                    </div>
                  ))}
                </section>

                {agentes.length > 0 && (
                  <section className="space-y-3 border-t border-[#2A2A2A] pt-6">
                    <h2 className="text-[20px] font-semibold text-[#F0F0F0]">
                      Agentes instalados no estúdio
                    </h2>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {agentes.map((ag) => (
                        <div
                          key={ag.agente_id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#2A2A2A] bg-[#212121] p-4"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[14px] font-semibold text-[#F0F0F0]">
                              {ag.nome}
                            </p>
                            <p className="truncate text-[12px] text-[#979797]">{ag.papel}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void daemonApi.duplicateLojaAgent(ag.agente_id).then(() => onRefreshStudio?.())}
                              className="inline-flex items-center gap-1 rounded-full border border-[#2A2A2A] bg-[#242424] px-3 py-1 text-[12px] font-semibold text-[#F0F0F0]"
                            >
                              <Copy size={12} /> Duplicar agente
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void daemonApi.exportLojaAgent(ag.agente_id).then((exp) => {
                                  setFeedbackBanner(`Template "${exp.name}" exportado como JSON.`);
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-full border border-[#2A2A2A] bg-[#242424] px-3 py-1 text-[12px] font-semibold text-[#F0F0F0]"
                            >
                              <Download size={12} /> Exportar agente
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* Conteúdo da Aba Habilidades */}
            {tab === "skills" && (
              <div className="space-y-8">
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[20px] font-semibold text-[#F0F0F0]">Suas habilidades</h2>
                    <span className="text-[12px] text-[#979797] tabular-nums">
                      {installedSkills.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {installedSkills.map((sk) => (
                      <div
                        key={sk.skillId}
                        className="flex flex-col justify-between gap-3 rounded-[12px] border border-[#2A2A2A] bg-[#212121] p-4"
                      >
                        <div className="space-y-1">
                          <p className="text-[14px] font-semibold text-[#F0F0F0]">{sk.name}</p>
                          <p className="text-[12px] text-[#31CF76]">
                            Ativada em {sk.agentIds.length} de {totalAgentsCount}
                          </p>
                          <p className="line-clamp-2 text-[14px] text-[#DCDCDC]">
                            {sk.description}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setBatchSkillTarget(sk)}
                            className="rounded-full border border-[#2A2A2A] bg-[#242424] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                          >
                            Adicionar aos agentes
                          </button>
                          {sk.source !== "nativa" && (
                            <button
                              type="button"
                              aria-label={`Excluir habilidade ${sk.name}`}
                              onClick={() => setSkillPendingDelete(sk)}
                              className="rounded-full border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 p-1.5 text-[#FD2F3B]"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {catalogSkillGroups.map((grp) => (
                  <section key={grp.category} className="space-y-4">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[20px] font-semibold text-[#F0F0F0]">{grp.category}</h2>
                      <span className="text-[12px] text-[#979797] tabular-nums">
                        {grp.items.length}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {grp.items.slice(0, 6).map((sk) => (
                        <div
                          key={sk.skillId}
                          className="flex flex-col justify-between gap-3 rounded-[12px] border border-[#2A2A2A] bg-[#212121] p-4"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-[14px] font-semibold text-[#F0F0F0]">
                                {sk.name}
                              </p>
                              <span className="text-[12px] text-[#979797]">
                                {sk.verified ? "Verificada" : "Pública"}
                              </span>
                            </div>
                            <p className="line-clamp-2 text-[14px] text-[#DCDCDC]">
                              {sk.description}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              void daemonApi
                                .installCatalogSkill(sk.slug, [agentes[0]?.agente_id ?? "estrategista"])
                                .then(() => loadCatalogAndApps())
                            }
                            className="self-start rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-1.5 text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                          >
                            Instalar habilidade
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal Excluir Habilidade */}
      {skillPendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D0D0D]/80 p-4"
        >
          <div className="w-full max-w-md rounded-[16px] border border-[#2A2A2A] bg-[#212121] p-6 space-y-4">
            <h3 className="text-[20px] font-semibold text-[#F0F0F0]">
              Excluir habilidade {skillPendingDelete.name}?
            </h3>
            <p className="text-[14px] text-[#979797]">
              Os agentes vinculados perderão acesso imediato às instruções desta habilidade.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSkillPendingDelete(null)}
                className="rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0]"
              >
                Manter registro
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = skillPendingDelete.skillId;
                  setSkillPendingDelete(null);
                  void daemonApi.deleteLojaSkill(id).then(() => loadCatalogAndApps());
                }}
                className="rounded-full bg-[#FD2F3B] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0]"
              >
                Excluir habilidade
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Importar Repositório GitHub (Agentes/Skills) */}
      {githubModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Importar repositório do GitHub"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D0D0D]/80 p-4"
        >
          <div className="w-full max-w-md rounded-[16px] border border-[#2A2A2A] bg-[#212121] p-6 space-y-4">
            <h3 className="text-[20px] font-semibold text-[#F0F0F0]">Importar repositório</h3>
            <p className="text-[12px] text-[#FF9412]">
              Origem externa do GitHub: este pacote não foi auditado pela equipe do estúdio. Revise as instruções antes de vincular aos seus agentes.
            </p>
            <input
              type="url"
              value={githubUrlInput}
              onChange={(e) => setGithubUrlInput(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 font-mono text-[12px] text-[#F0F0F0]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setGithubModalOpen(false)}
                className="rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0]"
              >
                Descartar alterações
              </button>
              <button
                type="button"
                onClick={() => {
                  setQuery(githubUrlInput);
                  setGithubModalOpen(false);
                }}
                className="rounded-full bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414]"
              >
                Inspecionar repositório
              </button>
            </div>
          </div>
        </div>
      )}

      <CustomMcpModal
        open={customMcpModalOpen}
        editingServer={editingServer}
        agentes={unlockedAgents}
        onClose={() => {
          setCustomMcpModalOpen(false);
          setEditingServer(null);
        }}
        onSaved={() => void loadCatalogAndApps()}
        onDeleted={() => void loadCatalogAndApps()}
      />

      <CreateSkillModal
        open={createSkillModalOpen}
        agentes={unlockedAgents}
        defaultAgentId={unlockedAgents[0]?.agente_id ?? agentes[0]?.agente_id ?? "estrategista"}
        onClose={() => setCreateSkillModalOpen(false)}
        onCreated={() => void loadCatalogAndApps()}
        onCreateWithAgent={onCreateSkillWithAgent}
      />

      <AddToAgentsDialog
        skill={batchSkillTarget}
        agentes={unlockedAgents}
        onClose={() => setBatchSkillTarget(null)}
        onConfirmBatch={handleConfirmSkillBatch}
      />

      {/* Toast de Undo (6 segundos) */}
      {undoState && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-[12px] border border-[#2A2A2A] bg-[#212121] px-4 py-3 shadow-2xl"
        >
          <span className="text-[14px] text-[#F0F0F0]">
            Vínculos de <strong>{undoState.skillName}</strong> atualizados.
          </span>
          <button
            type="button"
            onClick={() => void handleUndoSkillBatch()}
            className="inline-flex items-center gap-1 rounded-full bg-[#007CF7] px-3 py-1 text-[12px] font-semibold text-[#F0F0F0]"
          >
            <Undo2 size={12} /> Desfazer vínculo
          </button>
        </div>
      )}
    </div>
  );
}
