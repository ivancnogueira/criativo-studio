import type {
  WhatsAppMetodoPareamento,
  WhatsAppModoOperacao,
} from "@criativo/contracts";
import {
  Check,
  CheckCircle2,
  Copy,
  HardDrive,
  Loader2,
  Phone,
  Plus,
  PowerOff,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
import {
  CarbonSelect,
  SlidingTabs,
} from "../../components/ui/CarbonControls";
import {
  daemonApi,
} from "../../services/websocket-client";
import { statusBadgeMeta, type WhatsAppIntegrationPanelProps } from "./whatsapp-pairing-helpers";
import { useWhatsAppPanelController } from "./useWhatsAppPanelController";

export function WhatsAppIntegrationPanel(props: WhatsAppIntegrationPanelProps) {
  const {
    pairMethod,
    setPairMethod,
    phoneNumberInput,
    setPhoneNumberInput,
    copiedCode,
    setCopiedCode,
    addingAccount,
    setAddingAccount,
    newAccountLabel,
    setNewAccountLabel,
    newAccountMode,
    setNewAccountMode,
    pairings,
    contacts,
    contactType,
    setContactType,
    contactInput,
    setContactInput,
    contactNameInput,
    setContactNameInput,
    contactMentionOnly,
    setContactMentionOnly,
    busyAction,
    activeAccount,
    refreshAll,
    accountOptions,
    orchestratorOptions,
    handleSelectAccount,
    handleAddAccount,
    handleConnectClick,
    handleDisconnectClick,
    handleUpdateAccountPatch,
    handleAddContact,
    handleResolvePairing,
    handleResetAndReconnectClick,
    visibleError,
    badge,
  } = useWhatsAppPanelController(props);
  return (
    <div className="space-y-4 text-[#F0F0F0]">
      {/* Topo Multi-Número */}
      <section className="rounded-[12px] border border-[#2A2A2A] bg-[#212121] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-[220px] flex-1">
            <span className="mb-1 block text-[12px] font-semibold text-[#979797]">
              Conta WhatsApp ativa
            </span>
            <CarbonSelect
              ariaLabel="Selecionar número WhatsApp ativo"
              value={activeAccount.conta_id}
              options={accountOptions}
              onChange={handleSelectAccount}
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => setAddingAccount((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
            >
              <Plus size={14} /> Adicionar número
            </button>
          </div>
        </div>

        {addingAccount && (
          <form
            onSubmit={handleAddAccount}
            className="grid grid-cols-1 gap-3 rounded-[10px] border border-[#2A2A2A] bg-[#1A1A1A] p-4 md:grid-cols-[1fr_auto_auto]"
          >
            <input
              type="text"
              required
              value={newAccountLabel}
              onChange={(e) => setNewAccountLabel(e.target.value)}
              placeholder="Ex.: Atendimento Comercial"
              className="rounded-[8px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 text-[14px] text-[#F0F0F0]"
            />
            <SlidingTabs<WhatsAppModoOperacao>
              ariaLabel="Modo da nova conta"
              value={newAccountMode}
              onChange={setNewAccountMode}
              tabs={[
                { id: "ownNumber", label: "Meu número (Conversa comigo mesmo)" },
                { id: "dedicated", label: "Número dedicado (Bot)" },
              ]}
            />
            <button
              type="submit"
              disabled={busyAction}
              className="rounded-full bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414]"
            >
              Salvar número
            </button>
          </form>
        )}
      </section>

      {/* Bloco 1 — Pareamento & Política do Número */}
      <section className="rounded-[12px] border border-[#2A2A2A] bg-[#212121] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Smartphone size={18} className="text-[#31CF76]" />
            <h3 className="text-[20px] font-semibold text-[#F0F0F0]">
              Conexão e Política do Número
            </h3>
          </div>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold"
            style={{ backgroundColor: `${badge.color}20`, color: badge.color }}
          >
            {badge.label}
          </span>
        </div>

        {activeAccount.status === "conectado" ? (
          <div className="space-y-4 rounded-[12px] border border-[#2A2A2A] bg-[#1A1A1A] p-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#31CF76]/20 text-[#31CF76]">
              <CheckCircle2 size={28} />
            </div>
            <div className="space-y-1">
              <span className="inline-block rounded-full border border-[#31CF76]/40 bg-[#31CF76]/15 px-3 py-1 text-[12px] font-semibold text-[#31CF76]">
                WhatsApp Conectado com Sucesso
              </span>
              <p className="text-[12px] text-[#979797]">
                Envie áudios ou comandos de texto no WhatsApp do estúdio e aprove publicações respondendo com &ldquo;1&rdquo;.
              </p>
            </div>
            <button
              type="button"
              disabled={busyAction}
              onClick={() => void handleDisconnectClick()}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 px-4 py-2 text-[14px] font-semibold text-[#FD2F3B] hover:bg-[#FD2F3B]/20"
            >
              <PowerOff size={14} /> Desconectar número
            </button>
          </div>
        ) : (
          <div className="space-y-4 rounded-[12px] border border-[#2A2A2A] bg-[#1A1A1A] p-4">
            <SlidingTabs<WhatsAppMetodoPareamento>
              ariaLabel="Método de pareamento WhatsApp"
              value={pairMethod}
              onChange={setPairMethod}
              tabs={[
                { id: "qr", label: "QR Code" },
                { id: "pairing_code", label: "Código no telefone" },
              ]}
            />

            {pairMethod === "qr" ? (
              <div className="space-y-3 text-center">
                {activeAccount.qrcode_base64 ? (
                  <div className="mx-auto inline-block rounded-[14px] bg-[#F0F0F0] p-4 shadow-lg">
                    <img
                      src={activeAccount.qrcode_base64}
                      alt="QR Code de pareamento WhatsApp"
                      className="h-48 w-48"
                    />
                  </div>
                ) : (
                  <div className="mx-auto flex h-48 w-48 flex-col items-center justify-center rounded-[14px] border border-dashed border-[#2A2A2A] bg-[#141414] p-4 text-[12px] text-[#979797]">
                    {activeAccount.status === "aguardando_qrcode" ? (
                      <>
                        <Loader2 size={24} className="mb-2 animate-spin text-[#007CF7]" />
                        Gerando QR Code na sessão Baileys...
                      </>
                    ) : (
                      <>Clique abaixo para gerar um novo QR Code de pareamento.</>
                    )}
                  </div>
                )}
                <p className="text-[12px] text-[#979797]">
                  Abra o WhatsApp &gt; Aparelhos Conectados &gt; Conectar Aparelho
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => void handleConnectClick()}
                    className="flex-1 rounded-full bg-[#F0F0F0] py-2.5 text-[14px] font-semibold text-[#141414] hover:bg-white disabled:opacity-50"
                  >
                    Gerar código
                  </button>
                  {(activeAccount.status === "aguardando_qrcode" || visibleError) && (
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={() => void handleResetAndReconnectClick()}
                      className="rounded-full border border-white/15 bg-[#242424] px-4 py-2.5 text-[13px] font-semibold text-[#F0F0F0] hover:bg-[#2E2E2E] disabled:opacity-50"
                    >
                      Resetar sessão e gerar novo QR
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <label
                  htmlFor="wpp-pairing-phone"
                  className="block text-[14px] font-semibold text-[#F0F0F0]"
                >
                  Número de telefone com DDI/DDD (E.164)
                </label>
                <div className="flex flex-wrap gap-2">
                  <input
                    id="wpp-pairing-phone"
                    type="tel"
                    value={phoneNumberInput}
                    onChange={(e) => setPhoneNumberInput(e.target.value)}
                    placeholder="+55 11 90000-0000"
                    className="flex-1 rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 font-mono text-[14px] text-[#F0F0F0] placeholder-[#979797]"
                  />
                  <button
                    type="button"
                    disabled={busyAction || !phoneNumberInput.trim()}
                    onClick={() => void handleConnectClick()}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#F0F0F0] px-5 py-2 text-[14px] font-semibold text-[#141414] disabled:opacity-50"
                  >
                    <Phone size={14} /> Gerar código
                  </button>
                  {(activeAccount.status === "aguardando_qrcode" || visibleError) && (
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={() => void handleResetAndReconnectClick()}
                      className="rounded-full border border-white/15 bg-[#242424] px-4 py-2 text-[13px] font-semibold text-[#F0F0F0] hover:bg-[#2E2E2E] disabled:opacity-50"
                    >
                      Resetar sessão e gerar novo QR
                    </button>
                  )}
                </div>

                {activeAccount.pairing_code && (
                  <div className="flex items-center justify-between rounded-[12px] border border-[#007CF7]/40 bg-[#141414] p-4">
                    <div>
                      <span className="block text-[12px] text-[#979797]">
                        Digite no WhatsApp &gt; Aparelhos Conectados &gt; Conectar com número de telefone
                      </span>
                      <span className="mt-1 block font-mono text-[28px] font-semibold tracking-wider text-[#F0F0F0]">
                        {activeAccount.pairing_code}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof navigator !== "undefined" && navigator.clipboard) {
                          void navigator.clipboard.writeText(activeAccount.pairing_code ?? "");
                          setCopiedCode(true);
                          setTimeout(() => setCopiedCode(false), 2000);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-[#2A2A2A] bg-[#242424] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0]"
                    >
                      {copiedCode ? <Check size={12} /> : <Copy size={12} />}
                      {copiedCode ? "Copiado" : "Copiar código"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <span className="block text-[14px] font-semibold text-[#F0F0F0]">
              Política de atendimento
            </span>
            <SlidingTabs<WhatsAppModoOperacao>
              ariaLabel="Modo operacional do número WhatsApp"
              value={activeAccount.modo_operacao}
              onChange={(mode) => void handleUpdateAccountPatch({ modo_operacao: mode })}
              tabs={[
                { id: "ownNumber", label: "Meu número (Conversa comigo mesmo)" },
                { id: "dedicated", label: "Número dedicado (Bot)" },
              ]}
            />
            {activeAccount.modo_operacao === "ownNumber" ? (
              <div className="rounded-[10px] border border-[#31CF76]/25 bg-[#31CF76]/10 p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-white">
                    Conversa Interna (Comigo mesmo)
                  </span>
                  {contacts.length === 0 && (
                    <span className="rounded-full bg-[#31CF76]/20 px-2 py-0.5 text-[10.5px] font-semibold text-[#31CF76]">
                      Somente conversa interna ativa
                    </span>
                  )}
                </div>
                <p className="text-[11.5px] leading-relaxed text-[#D7F5E3]">
                  Modo Conversa Interna ativo: o agente monitora e responde apenas às mensagens que
                  você enviar na conversa consigo mesmo (&lsquo;Você / Mensagens salvas&rsquo;).
                  Conversas com outras pessoas ou clientes não recebem resposta automática, salvo
                  contatos/grupos que você autorizar abaixo.
                </p>
              </div>
            ) : (
              <p className="text-[12px] text-[#979797]">
                Número dedicado: desconhecidos recebem desafio de pareamento com código de 6
                caracteres.
              </p>
            )}
          </div>

          <div className="space-y-2.5 rounded-[10px] border border-[#2A2A2A] bg-[#1A1A1A] p-3">
            <label className="flex cursor-pointer items-center justify-between gap-3 text-[14px] text-[#F0F0F0]">
              <span>Notificar aprovações de posts</span>
              <input
                type="checkbox"
                checked={activeAccount.notificar_aprovacoes}
                onChange={(e) =>
                  void handleUpdateAccountPatch({ notificar_aprovacoes: e.target.checked })
                }
                className="accent-[#007CF7]"
              />
            </label>
            <label className="flex cursor-pointer items-center justify-between gap-3 text-[14px] text-[#F0F0F0]">
              <span>Responder grupos apenas com menção</span>
              <input
                type="checkbox"
                checked={!activeAccount.grupo_auto_responder}
                onChange={(e) =>
                  void handleUpdateAccountPatch({ grupo_auto_responder: !e.target.checked })
                }
                className="accent-[#007CF7]"
              />
            </label>
          </div>
        </div>

        {visibleError && (
          <div className="rounded-[10px] border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 px-4 py-2.5 text-[12px] text-[#FF8A91]">
            <strong className="font-semibold text-[#FD2F3B]">Falha no pareamento:</strong>{" "}
            {visibleError}
          </div>
        )}
      </section>

      {/* Bloco 2 — Solicitações de Pareamento Pendentes (6 chars) */}
      <section className="rounded-[12px] border border-[#2A2A2A] bg-[#212121] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-[#FF9412]" />
            <h4 className="text-[14px] font-semibold text-[#F0F0F0]">
              Solicitações de Pareamento Pendentes ({pairings.length})
            </h4>
          </div>
        </div>

        {pairings.length === 0 ? (
          <p className="text-[12px] text-[#979797]">
            Nenhum pedido de pareamento aguardando revisão neste número.
          </p>
        ) : (
          <div className="space-y-2">
            {pairings.map((req) => (
              <div
                key={req.request_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[#2A2A2A] bg-[#1A1A1A] p-3"
              >
                <div className="space-y-0.5">
                  <p className="text-[14px] font-semibold text-[#F0F0F0]">
                    {req.nome_contato || req.remetente_pn || req.remetente_jid}
                  </p>
                  <p className="font-mono text-[14px] font-semibold text-[#FF9412]">
                    {req.codigo}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => void handleResolvePairing(req.request_id, true)}
                    className="rounded-full bg-[#F0F0F0] px-3 py-1.5 text-[12px] font-semibold text-[#141414]"
                  >
                    Aprovar pareamento
                  </button>
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => void handleResolvePairing(req.request_id, false)}
                    className="rounded-full border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 px-3 py-1.5 text-[12px] font-semibold text-[#FD2F3B]"
                  >
                    Recusar pedido
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Bloco 3 — Contatos e Grupos Autorizados */}
      <section className="rounded-[12px] border border-[#2A2A2A] bg-[#212121] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-[14px] font-semibold text-[#F0F0F0]">
            Contatos e Grupos Autorizados
          </h4>
          <SlidingTabs<"contato" | "grupo">
            ariaLabel="Tipo de destinatário autorizado"
            value={contactType}
            onChange={setContactType}
            variant="subtle"
            tabs={[
              { id: "contato", label: "Contato 1:1" },
              { id: "grupo", label: "Grupo WhatsApp" },
            ]}
          />
        </div>

        <form onSubmit={handleAddContact} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
          <input
            type="text"
            required
            value={contactInput}
            onChange={(e) => setContactInput(e.target.value)}
            placeholder={contactType === "grupo" ? "120363000111@g.us" : "+55 11 90000-0000"}
            className="rounded-[8px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 font-mono text-[12px] text-[#F0F0F0] placeholder-[#979797]"
          />
          <input
            type="text"
            value={contactNameInput}
            onChange={(e) => setContactNameInput(e.target.value)}
            placeholder="Nome de exibição (opcional)"
            className="rounded-[8px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 text-[14px] text-[#F0F0F0] placeholder-[#979797]"
          />
          <button
            type="submit"
            disabled={busyAction}
            className="rounded-full bg-[#F0F0F0] px-4 py-2 text-[12px] font-semibold text-[#141414]"
          >
            {contactType === "grupo" ? "Adicionar grupo" : "Autorizar contato"}
          </button>
        </form>

        {contactType === "grupo" && (
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[#DCDCDC]">
            <input
              type="checkbox"
              checked={contactMentionOnly}
              onChange={(e) => setContactMentionOnly(e.target.checked)}
              className="accent-[#007CF7]"
            />
            <span>Exigir @menção ou resposta neste grupo</span>
          </label>
        )}

        <p className="text-[12px] text-[#979797]">
          Compatibilidade automática com ou sem o 9º dígito brasileiro em DDDs locais.
        </p>

        {contacts.length > 0 && (
          <div className="space-y-1.5">
            {contacts.map((ct) => (
              <div
                key={ct.autorizacao_id}
                className="flex items-center justify-between gap-3 rounded-[8px] border border-[#2A2A2A] bg-[#1A1A1A] px-3 py-2 text-[12px]"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[#F0F0F0]">
                    {ct.nome_exibicao || ct.identificador_jid}
                  </p>
                  <p className="truncate font-mono text-[#979797]">
                    {ct.identificador_jid} · {ct.tipo === "grupo" ? "Grupo" : "Contato"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void daemonApi
                      .removeWhatsAppContact(activeAccount.conta_id, ct.autorizacao_id)
                      .then(() => refreshAll())
                  }
                  className="inline-flex items-center gap-1 rounded-full border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 px-2.5 py-1 text-[12px] font-semibold text-[#FD2F3B]"
                >
                  <Trash2 size={12} /> Revogar contato
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Bloco 4 — Orquestrador & Mídia */}
      <section className="rounded-[12px] border border-[#2A2A2A] bg-[#212121] p-5 space-y-3">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <span className="block text-[14px] font-semibold text-[#F0F0F0]">
              Agente Orquestrador
            </span>
            <CarbonSelect
              ariaLabel="Agente orquestrador do WhatsApp"
              value={activeAccount.agente_orquestrador_id ?? "estrategista"}
              options={orchestratorOptions}
              onChange={(agenteId) =>
                void handleUpdateAccountPatch({ agente_orquestrador_id: agenteId })
              }
            />
          </div>

          <div className="flex items-start gap-2.5 rounded-[10px] border border-[#2A2A2A] bg-[#1A1A1A] p-3 text-[12px] text-[#979797]">
            <HardDrive size={16} className="mt-0.5 shrink-0 text-[#42A0FF]" />
            <div className="space-y-0.5">
              <p className="font-semibold text-[#F0F0F0]">
                Aprovação 1 / Recusa 2 · Retenção de mídia
              </p>
              <p>
                Arquivos baixados ficam em recursos/uploads/whatsapp/ com limpeza automática após 90 dias (teto 2 GiB).
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

