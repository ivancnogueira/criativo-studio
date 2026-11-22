import {
  ArrowLeft,
  Copy,
  FlaskConical,
  KeyRound,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { BrandTile, AgentCustomPicker, type ConnectorsPageProps } from "./connectors-types";
import type { ConnectorsController } from "./useConnectorsController";

export function ConnectorsAppsTab({
  ctrl,
  props,
}: {
  ctrl: ConnectorsController;
  props: ConnectorsPageProps;
}) {
  const {
    whatsappStatus,
    onOpenWhatsAppModal,
    agentes = [],
    conectores,
    onTestConnector,
  } = props;
  const {
    hubTab,
    setSelectedConnectorId,
    connectorSecretDrafts,
    setConnectorSecretDrafts,
    connectorAgentDrafts,
    setConnectorAgentDrafts,
    mcpNameDraft,
    setMcpNameDraft,
    mcpCmdDraft,
    setMcpCmdDraft,
    mcpArgsDraft,
    setMcpArgsDraft,
    testResult,
    setTestResult,
    testingConnector,
    copiedWebhookId,
    setCopiedWebhookId,
    effectiveConnectors,
    activeConnector,
    handleSaveConnector,
    handleTest,
  } = ctrl;

  return (
    <>
        {/* ABA 2: APPS & CANAIS (Marketplace Grid + IntegrationPage sem selects crus) */}
        {hubTab === "apps" && (
          <div className="space-y-4">
            {!activeConnector ? (
              <>
                <div className="rounded-2xl bg-[#202020] border border-white/[0.07] px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="h-5 w-5 text-[#31CF76]" />
                    <div className="text-[12.5px] text-[#DCDCDC]">
                      <strong>Trava Segura Meta API ativa:</strong> nenhuma arte ou Reels é publicado sem sua aprovação explícita no Cockpit ou via &ldquo;1&rdquo; no WhatsApp.
                    </div>
                  </div>
                  <span className="rounded-full bg-[#31CF76]/15 px-2.5 py-0.5 text-[11px] font-medium text-[#31CF76] shrink-0">
                    Cofre AES-256-GCM
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {effectiveConnectors.map((conn) => (
                    <button
                      key={conn.id}
                      type="button"
                      onClick={() => {
                        setSelectedConnectorId(conn.id);
                        setTestResult(null);
                      }}
                      className="rounded-2xl bg-[#202020] hover:bg-[#252525] border border-white/[0.07] hover:border-white/15 p-4 text-left flex flex-col justify-between gap-3 transition-colors"
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <BrandTile id={conn.id} color={conn.cor_marca} />
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-medium ${
                              conn.status === "conectado"
                                ? "bg-[#31CF76]/15 text-[#31CF76]"
                                : conn.status === "atencao"
                                  ? "bg-[#FF9412]/15 text-[#FF9412]"
                                  : "bg-white/[0.06] text-[#888]"
                            }`}
                          >
                            {conn.status === "conectado"
                              ? "Conectado"
                              : conn.status === "atencao"
                                ? "Atenção"
                                : "Configurar"}
                          </span>
                        </div>
                        <div>
                          <div className="text-[14px] font-semibold text-white">{conn.nome}</div>
                          <div className="text-[12px] text-[#888] mt-1 line-clamp-2">
                            {conn.descricao}
                          </div>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-white/[0.05] flex items-center justify-between text-[11px] text-[#787878]">
                        <span className="truncate">{conn.resumo_estado}</span>
                        <span className="text-white/80 font-medium shrink-0">Abrir →</span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              /* IntegrationPage dedicada para o App selecionado */
              <div className="rounded-2xl bg-[#202020] border border-white/[0.08] p-5 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/[0.06]">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedConnectorId(null)}
                      className="h-8 w-8 rounded-xl bg-[#161616] border border-white/10 flex items-center justify-center text-[#B5B5B5] hover:text-white"
                      aria-label="Voltar para lista de Apps"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    <BrandTile id={activeConnector.id} color={activeConnector.cor_marca} />
                    <div>
                      <h2 className="text-[16px] font-semibold text-white">{activeConnector.nome}</h2>
                      <p className="text-[12px] text-[#888]">{activeConnector.descricao}</p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                      activeConnector.status === "conectado"
                        ? "bg-[#31CF76]/15 text-[#31CF76]"
                        : "bg-white/[0.06] text-[#979797]"
                    }`}
                  >
                    {activeConnector.resumo_estado}
                  </span>
                </div>

                {/* Ação especial WhatsApp Baileys QR */}
                {activeConnector.id === "whatsapp" && (
                  <div className="rounded-xl bg-[#161616] border border-white/[0.06] p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Smartphone className="h-5 w-5 text-[#25D366]" />
                      <div>
                        <div className="text-[13px] font-semibold text-white">
                          Pareamento Baileys Nativo
                        </div>
                        <div className="text-[11.5px] text-[#888]">
                          Gere o QR Code ao vivo e escaneie pelo WhatsApp no celular.
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onOpenWhatsAppModal}
                      className="studio-btn-primary px-4 py-2 text-[12px]"
                    >
                      {whatsappStatus === "conectado" ? "Gerenciar Conexão" : "Gerar QR Code"}
                    </button>
                  </div>
                )}

                {/* Campos dedicados por conector (sem dropdown nativo) */}
                {(activeConnector.id === "slack" ||
                  activeConnector.id === "discord" ||
                  activeConnector.id === "github") && (
                  <div className="rounded-xl bg-[#161616] border border-white/[0.06] p-3.5 flex flex-wrap items-center justify-between gap-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#979797]">
                        Endpoint local do Webhook ({activeConnector.nome})
                      </div>
                      <code className="block truncate font-mono text-[11.5px] text-[#42A0FF] mt-0.5">
                        {`${typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:4190"}/api/conectores/${activeConnector.id}/webhook`}
                      </code>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const url = `${typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:4190"}/api/conectores/${activeConnector.id}/webhook`;
                        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                          await navigator.clipboard.writeText(url);
                        }
                        setCopiedWebhookId(activeConnector.id);
                        setTimeout(() => setCopiedWebhookId(null), 2000);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#242424] px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-[#2A2A2A]"
                    >
                      <Copy className="h-3.5 w-3.5 text-[#42A0FF]" />
                      <span>
                        {copiedWebhookId === activeConnector.id
                          ? "Endpoint copiado!"
                          : "Copiar endpoint"}
                      </span>
                    </button>
                  </div>
                )}

                {activeConnector.id !== "whatsapp" && activeConnector.id !== "mcp" && (
                  <div className="space-y-3">
                    {activeConnector.detalhes.map((det) => (
                      <div key={det.chave} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label
                            htmlFor={`field-${det.chave}`}
                            className="text-[12px] font-medium text-[#DCDCDC] flex items-center gap-1.5"
                          >
                            <KeyRound className="h-3.5 w-3.5 text-[#42A0FF]" />
                            <span>{det.rotulo}</span>
                          </label>
                          {det.configurado && (
                            <span className="text-[11px] text-[#31CF76]">
                              {det.valor_mascarado ?? "Salvo e cifrado no Cofre"}
                            </span>
                          )}
                        </div>
                        <input
                          id={`field-${det.chave}`}
                          name={`field_${det.chave}`}
                          aria-label={det.rotulo}
                          type="password"
                          value={connectorSecretDrafts[det.chave] ?? ""}
                          onChange={(e) =>
                            setConnectorSecretDrafts((prev) => ({
                              ...prev,
                              [det.chave]: e.target.value,
                            }))
                          }
                          placeholder={
                            det.configurado
                              ? "Já salvo no Cofre — digite apenas se desejar substituir"
                              : `Cole aqui ${det.rotulo}`
                          }
                          className="w-full rounded-xl bg-[#141414] border border-white/10 px-3.5 py-2 text-[12.5px] text-white placeholder-[#6A6A6A]"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Servidores MCP cadastro limpo */}
                {activeConnector.id === "mcp" && (
                  <div className="space-y-3">
                    {activeConnector.detalhes.length > 0 && (
                      <div className="space-y-2">
                        {activeConnector.detalhes.map((srv) => (
                          <div
                            key={srv.chave}
                            className="rounded-xl bg-[#161616] border border-white/[0.05] px-3 py-2 flex items-center justify-between text-[12px]"
                          >
                            <span className="text-white">{srv.rotulo}</span>
                            <span className="text-[#31CF76]">Ativo</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        id="mcp-server-name"
                        name="mcp_server_name"
                        aria-label="Nome do servidor MCP"
                        type="text"
                        value={mcpNameDraft}
                        onChange={(e) => setMcpNameDraft(e.target.value)}
                        placeholder="Nome (ex: wordpress-mcp)"
                        className="rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[12px] text-white"
                      />
                      <input
                        id="mcp-server-cmd"
                        name="mcp_server_cmd"
                        aria-label="Comando do servidor MCP"
                        type="text"
                        value={mcpCmdDraft}
                        onChange={(e) => setMcpCmdDraft(e.target.value)}
                        placeholder="Comando (ex: npx)"
                        className="rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[12px] text-white"
                      />
                      <input
                        id="mcp-server-args"
                        name="mcp_server_args"
                        aria-label="Argumentos do servidor MCP"
                        type="text"
                        value={mcpArgsDraft}
                        onChange={(e) => setMcpArgsDraft(e.target.value)}
                        placeholder="Args (ex: -y @org/mcp)"
                        className="rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[12px] text-white"
                      />
                    </div>
                  </div>
                )}

                {/* Seletor customizado de Agente Orquestrador */}
                {agentes.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="block text-[12px] font-medium text-[#DCDCDC]">
                      Agente Orquestrador Vinculado
                    </span>
                    <AgentCustomPicker
                      agentes={agentes}
                      selectedId={
                        connectorAgentDrafts[activeConnector.id] ??
                        activeConnector.agente_orquestrador_id ??
                        agentes[0].agente_id
                      }
                      onSelect={(id) =>
                        setConnectorAgentDrafts((prev) => ({
                          ...prev,
                          [activeConnector.id]: id,
                        }))
                      }
                    />
                  </div>
                )}

                {testResult && testResult.conectorId === activeConnector.id && (
                  <div
                    className={`rounded-xl border px-3.5 py-2.5 text-[12px] ${
                      testResult.ok
                        ? "bg-[#31CF76]/15 border-[#31CF76]/30 text-[#31CF76]"
                        : "bg-[#FF7675]/15 border-[#FF7675]/30 text-[#FF7675]"
                    }`}
                  >
                    {testResult.mensagem}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                  {onTestConnector && activeConnector.id !== "mcp" && (
                    <button
                      type="button"
                      disabled={testingConnector}
                      onClick={() => void handleTest(activeConnector)}
                      className="studio-btn-secondary px-4 py-2 text-[12px] inline-flex items-center gap-1.5"
                    >
                      <FlaskConical className="h-3.5 w-3.5" />
                      {testingConnector ? "Testando..." : "Testar conector"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleSaveConnector(activeConnector)}
                    className="studio-btn-primary px-5 py-2 text-[12px]"
                  >
                    Salvar credenciais
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
    </>
  );
}
