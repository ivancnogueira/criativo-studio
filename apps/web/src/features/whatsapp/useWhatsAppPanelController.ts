import React, {
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  AgenteRegistro,
  WhatsAppContaResumo,
  WhatsAppContatoAutorizado,
  WhatsAppMetodoPareamento,
  WhatsAppModoOperacao,
  WhatsAppPairingRequest,
} from "@criativo/contracts";
import {
  type CarbonSelectOption,
} from "../../components/ui/CarbonControls";
import {
  daemonApi,
} from "../../services/websocket-client";
import { statusBadgeMeta, type WhatsAppIntegrationPanelProps } from "./whatsapp-pairing-helpers";

export function useWhatsAppPanelController(props: WhatsAppIntegrationPanelProps) {
  const {
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
} = props;
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

  const isWaitingPairCode =
    activeAccount?.status === "aguardando_qrcode" &&
    !activeAccount.qrcode_base64 &&
    !activeAccount.pairing_code;

  useEffect(() => {
    if (!isWaitingPairCode || typeof window === "undefined") return;
    const timer = window.setInterval(() => {
      void refreshAll();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [isWaitingPairCode, activeAccount?.conta_id]);

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

  const handleResetAndReconnectClick = async () => {
    setBusyAction(true);
    setErrorMessage(null);
    try {
      await daemonApi.disconnectWhatsAppAccount(activeAccount.conta_id, true);
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
      setErrorMessage(err instanceof Error ? err.message : "Falha ao resetar sessão WhatsApp.");
    } finally {
      setBusyAction(false);
    }
  };

  const visibleError = errorMessage || activeAccount.ultimo_erro || null;
  const badge = statusBadgeMeta(activeAccount.status);


  return {
    externalAccounts,
    externalActiveId,
    onSelectAccount,
    fallbackStatus,
    fallbackQrCode,
    agentes,
    externalPairings,
    externalContacts,
    onRefreshAccounts,
    onConnect,
    onDisconnect,
    internalAccounts,
    setInternalAccounts,
    selectedAccountId,
    setSelectedAccountId,
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
    setPairings,
    contacts,
    setContacts,
    contactType,
    setContactType,
    contactInput,
    setContactInput,
    contactNameInput,
    setContactNameInput,
    contactMentionOnly,
    setContactMentionOnly,
    busyAction,
    setBusyAction,
    errorMessage,
    setErrorMessage,
    resolvedAccounts,
    currentAccountId,
    activeAccount,
    loadAccountDetails,
    isWaitingPairCode,
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
  };
}

export type WhatsAppPanelController = ReturnType<typeof useWhatsAppPanelController>;
