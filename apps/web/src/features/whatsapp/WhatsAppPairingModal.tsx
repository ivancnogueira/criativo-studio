import React, { useEffect, useMemo, useState } from "react";
import type {
  AgenteRegistro,
  StatusMensageria,
  WhatsAppContaResumo,
  WhatsAppContatoAutorizado,
  WhatsAppMetodoPareamento,
  WhatsAppModoOperacao,
  WhatsAppPairingRequest,
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
  QrCode,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import {
  CarbonSelect,
  SlidingTabs,
  type CarbonSelectOption,
} from "../../components/ui/CarbonControls";
import { daemonApi } from "../../services/websocket-client";

export interface WhatsAppIntegrationPanelProps {
  accounts?: WhatsAppContaResumo[];
  activeAccountId?: string;
  onSelectAccount?: (contaId: string) => void;
  fallbackStatus?: StatusMensageria;
  fallbackQrCode?: string | null;
  agentes?: AgenteRegistro[];
  pairings?: WhatsAppPairingRequest[];
  contacts?: WhatsAppContatoAutorizado[];
  onRefreshAccounts?: () => Promise<void>;
  onConnect?: (opts?: { mode?: WhatsAppMetodoPareamento; phoneNumber?: string }) => Promise<void>;
  onDisconnect?: (limparSessao?: boolean) => Promise<void>;
}

function statusBadgeMeta(status: StatusMensageria): { label: string; color: string } {
  if (status === "conectado") return { label: "Conectado", color: "#31CF76" };
  if (status === "aguardando_qrcode") return { label: "Aguardando leitura", color: "#FF9412" };
  return { label: "Desconectado", color: "#979797" };
}

/**
 * Painel completo multi-número do WhatsApp Baileys:
 * - Seletor multi-número (`CarbonSelect` + `Adicionar número`)
 * - Pareamento via `QR Code` ou `Código no telefone` (8 dígitos E.164)
 * - Política `Número dedicado` vs `Número próprio` + switches de aprovações/menção
 * - Aprovações de pareamento 6 chars, Contatos/Grupos autorizados (nota 9º dígito BR) e Agente Orquestrador
 */
export function WhatsAppIntegrationPanel({
  accounts: externalAccounts,
  activeAccountId: externalActiveId,
  onSelectAccount,
  fallbackStatus = "desconectado",
  fallbackQrCode = null,
  agentes = [],
  pairings: externalPairings,
  contacts: externalContacts,
  onRefreshAccounts,
  onConnect,
  onDisconnect,
}: WhatsAppIntegrationPanelProps) {
  const [internalAccounts, setInternalAccounts] = useState<WhatsAppContaResumo[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    externalActiveId ?? "whatsapp-principal"
  );
  const [pairMethod, setPairMethod] = useState<WhatsAppMetodoPareamento>("qr");
  const [phoneNumberInput, setPhoneNumberInput] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);

  const [addingAccount, setAddingAccount] = useState(false);
  const [newAccountLabel, setNewAccountLabel] = useState("");
  const [newAccountMode, setNewAccountMode] = useState<WhatsAppModoOperacao>("dedicated");

  const [pairings, setPairings] = useState<WhatsAppPairingRequest[]>(externalPairings ?? []);
  const [contacts, setContacts] = useState<WhatsAppContatoAutorizado[]>(externalContacts ?? []);
  const [contactType, setContactType] = useState<"contato" | "grupo">("contato");
  const [contactInput, setContactInput] = useState("");
  const [contactNameInput, setContactNameInput] = useState("");
  const [contactMentionOnly, setContactMentionOnly] = useState(true);
  const [busyAction, setBusyAction] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resolvedAccounts: WhatsAppContaResumo[] = useMemo(() => {
    if (externalAccounts && externalAccounts.length > 0) return externalAccounts;
    if (internalAccounts.length > 0) return internalAccounts;
    return [
      {
        conta_id: "whatsapp-principal",
        rotulo: "Número Principal",
        numero_telefone: null,
        jid_proprio: null,
        modo_operacao: "dedicated",
        status: fallbackStatus,
        qrcode_base64: fallbackQrCode,
        pairing_code: null,
        notificar_aprovacoes: true,
        codigo_autorizacao_obrigatorio: true,
        grupo_auto_responder: false,
        agente_orquestrador_id: agentes[0]?.agente_id ?? "estrategista",
        total_contatos_autorizados: contacts.length,
        pareamentos_pendentes: pairings.length,
        ultimo_erro: null,
        conectado_em: null,
        atualizado_em: new Date().toISOString(),
      },
    ];
  }, [externalAccounts, internalAccounts, fallbackStatus, fallbackQrCode, agentes, contacts.length, pairings.length]);

  const currentAccountId = externalActiveId ?? selectedAccountId;
  const activeAccount =
    resolvedAccounts.find((a) => a.conta_id === currentAccountId) ?? resolvedAccounts[0];

  const loadAccountDetails = async (contaId: string) => {
    try {
      const [pList, cList] = await Promise.all([
        daemonApi.listWhatsAppPairings(contaId),
        daemonApi.listWhatsAppContacts(contaId),
      ]);
      setPairings(pList);
      setContacts(cList);
    } catch {
      // Silencioso em SSR isolado
    }
  };

  useEffect(() => {
    if (!externalAccounts) {
      void daemonApi
        .listWhatsAppAccounts()
        .then((list) => {
          if (list.length > 0) {
            setInternalAccounts(list);
          }
        })
        .catch(() => {});
    }
  }, [externalAccounts]);

  useEffect(() => {
    if (externalPairings) setPairings(externalPairings);
  }, [externalPairings]);

  useEffect(() => {
    if (externalContacts) setContacts(externalContacts);
  }, [externalContacts]);

  useEffect(() => {
    if (!externalPairings && !externalContacts && activeAccount?.conta_id && typeof window !== "undefined") {
      void loadAccountDetails(activeAccount.conta_id);
    }
  }, [activeAccount?.conta_id]);

  const refreshAll = async () => {
    if (onRefreshAccounts) {
      await onRefreshAccounts();
    } else {
      const list = await daemonApi.listWhatsAppAccounts().catch(() => []);
      if (list.length > 0) setInternalAccounts(list);
    }
    if (activeAccount) {
      await loadAccountDetails(activeAccount.conta_id);
    }
  };

  const accountOptions: CarbonSelectOption[] = resolvedAccounts.map((acc) => {
    const meta = statusBadgeMeta(acc.status);
    return {
      value: acc.conta_id,
      label: acc.numero_telefone ? `${acc.rotulo} (${acc.numero_telefone})` : acc.rotulo,
      badge: meta.label,
      badgeColor: meta.color,
    };
  });

  const orchestratorOptions: CarbonSelectOption[] = (
    agentes.length > 0
      ? agentes
      : [
          {
            agente_id: "estrategista",
            nome: "Estrategista Editorial",
            papel: "Orquestrador principal",
          } as AgenteRegistro,
        ]
  ).map((ag) => ({
    value: ag.agente_id,
    label: ag.nome,
    description: ag.papel,
  }));

  const handleSelectAccount = (contaId: string) => {
    setSelectedAccountId(contaId);
    onSelectAccount?.(contaId);
  };

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccountLabel.trim()) return;
    setBusyAction(true);
    setErrorMessage(null);
    try {
      const created = await daemonApi.createWhatsAppAccount({
        rotulo: newAccountLabel.trim(),
        modo_operacao: newAccountMode,
        agente_orquestrador_id: agentes[0]?.agente_id ?? "estrategista",
      });
      setAddingAccount(false);
      setNewAccountLabel("");
      handleSelectAccount(created.conta_id);
      await refreshAll();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Falha ao adicionar número.");
    } finally {
      setBusyAction(false);
    }
  };

  const handleConnectClick = async () => {
    setBusyAction(true);
    setErrorMessage(null);
    try {
      if (onConnect && activeAccount.conta_id === "whatsapp-principal" && pairMethod === "qr") {
        await onConnect({ mode: "qr" });
      } else {
        await daemonApi.connectWhatsAppAccount(activeAccount.conta_id, {
          mode: pairMethod,
          phoneNumber: pairMethod === "pairing_code" ? phoneNumberInput.trim() : undefined,
        });
      }
      await refreshAll();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Falha ao iniciar pareamento.");
    } finally {
      setBusyAction(false);
    }
  };

  const handleDisconnectClick = async () => {
    setBusyAction(true);
    setErrorMessage(null);
    try {
      if (onDisconnect && activeAccount.conta_id === "whatsapp-principal") {
        await onDisconnect(false);
      } else {
        await daemonApi.disconnectWhatsAppAccount(activeAccount.conta_id, false);
      }
      await refreshAll();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Falha ao desconectar número.");
    } finally {
      setBusyAction(false);
    }
  };

  const handleUpdateAccountPatch = async (
    patch: Partial<{
      modo_operacao: WhatsAppModoOperacao;
      notificar_aprovacoes: boolean;
      grupo_auto_responder: boolean;
      agente_orquestrador_id: string | null;
    }>
  ) => {
    try {
      await daemonApi.updateWhatsAppAccount(activeAccount.conta_id, patch);
      await refreshAll();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Falha ao atualizar políticas da conta.");
    }
  };

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactInput.trim()) return;
    setBusyAction(true);
    setErrorMessage(null);
    try {
      await daemonApi.addWhatsAppContact(activeAccount.conta_id, {
        tipo: contactType,
        identificador_jid: contactInput.trim(),
        nome_exibicao: contactNameInput.trim() || null,
        permitido: true,
        somente_mencao: contactType === "grupo" ? contactMentionOnly : false,
      });
      setContactInput("");
      setContactNameInput("");
      await refreshAll();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Falha ao autorizar contato.");
    } finally {
      setBusyAction(false);
    }
  };

  const handleResolvePairing = async (requestId: string, aprovar: boolean) => {
    setBusyAction(true);
    try {
      await daemonApi.resolveWhatsAppPairing(activeAccount.conta_id, requestId, aprovar);
      await refreshAll();
    } finally {
      setBusyAction(false);
    }
  };

  const badge = statusBadgeMeta(activeAccount.status);

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
                { id: "dedicated", label: "Número dedicado" },
                { id: "ownNumber", label: "Número próprio" },
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
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => void handleConnectClick()}
                  className="w-full rounded-full bg-[#F0F0F0] py-2.5 text-[14px] font-semibold text-[#141414] hover:bg-white disabled:opacity-50"
                >
                  Gerar código
                </button>
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
                { id: "dedicated", label: "Número dedicado" },
                { id: "ownNumber", label: "Número próprio" },
              ]}
            />
            <p className="text-[12px] text-[#979797]">
              {activeAccount.modo_operacao === "ownNumber"
                ? "Número próprio: ignora desconhecidos silenciosamente e permite self-chat protegido."
                : "Número dedicado: desconhecidos recebem desafio de pareamento com código de 6 caracteres."}
            </p>
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

        {errorMessage && (
          <div className="rounded-[10px] border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 px-4 py-2 text-[12px] text-[#FD2F3B]">
            {errorMessage}
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

interface WhatsAppPairingModalProps {
  open: boolean;
  status: StatusMensageria;
  qrcodeBase64: string | null;
  onClose: () => void;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  accounts?: WhatsAppContaResumo[];
  agentes?: AgenteRegistro[];
  onRefreshAccounts?: () => Promise<void>;
}

/**
 * Dialog modal completo do WhatsApp preservando compatibilidade com props legadas.
 */
export function WhatsAppPairingModal({
  open,
  status,
  qrcodeBase64,
  onClose,
  onConnect,
  onDisconnect,
  accounts,
  agentes,
  onRefreshAccounts,
}: WhatsAppPairingModalProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Conexão WhatsApp do Estúdio"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D0D0D]/80 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[16px] border border-[#2A2A2A] bg-[#1A1A1A] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#2A2A2A] bg-[#212121] px-6 py-4">
          <div className="flex items-center gap-2">
            <QrCode size={18} className="text-[#31CF76]" />
            <h2 className="text-[20px] font-semibold text-[#F0F0F0]">
              Pareamento Nativo WhatsApp
            </h2>
          </div>
          <button
            type="button"
            aria-label="Fechar modal"
            onClick={onClose}
            className="rounded-[8px] p-1 text-[#979797] hover:bg-[#2A2A2A] hover:text-[#F0F0F0]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <WhatsAppIntegrationPanel
            accounts={accounts}
            fallbackStatus={status}
            fallbackQrCode={qrcodeBase64}
            agentes={agentes}
            onRefreshAccounts={onRefreshAccounts}
            onConnect={async () => {
              await onConnect();
            }}
            onDisconnect={async () => {
              await onDisconnect();
            }}
          />
        </div>
      </div>
    </div>
  );
}
