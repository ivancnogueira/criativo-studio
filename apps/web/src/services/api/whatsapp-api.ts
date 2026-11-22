import type { StatusMensageria, WhatsAppContaResumo, WhatsAppContatoAutorizado, WhatsAppMensagemRegistro, WhatsAppMetodoPareamento, WhatsAppModoOperacao, WhatsAppPairingRequest } from "@criativo/contracts";
import { apiFetch } from "../http-client";

export const whatsappApi = {
  async getWhatsAppStatus(): Promise<{
    status: StatusMensageria;
    qrcode_base64: string | null;
  }> {
    const res = await apiFetch("/api/mensageria/whatsapp/status");
    return (await res.json()) as { status: StatusMensageria; qrcode_base64: string | null };
  },

  async connectWhatsApp(): Promise<{
    status: StatusMensageria;
    qrcode_base64: string | null;
  }> {
    const res = await apiFetch("/api/mensageria/whatsapp/conectar", { method: "POST" });
    return (await res.json()) as { status: StatusMensageria; qrcode_base64: string | null };
  },

  async disconnectWhatsApp(): Promise<void> {
    await apiFetch("/api/mensageria/whatsapp/desconectar", { method: "POST" });
  },

  async listWhatsAppAccounts(): Promise<WhatsAppContaResumo[]> {
    const res = await apiFetch("/api/mensageria/whatsapp/contas");
    const json = (await res.json()) as { contas?: WhatsAppContaResumo[] };
    return json.contas ?? [];
  },

  async createWhatsAppAccount(input: {
    rotulo: string;
    modo_operacao?: WhatsAppModoOperacao;
    notificar_aprovacoes?: boolean;
    codigo_autorizacao_obrigatorio?: boolean;
    grupo_auto_responder?: boolean;
    agente_orquestrador_id?: string | null;
  }): Promise<WhatsAppContaResumo> {
    const res = await apiFetch("/api/mensageria/whatsapp/contas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json()) as { conta?: WhatsAppContaResumo; erro?: string };
    if (!res.ok || !json.conta) {
      throw new Error(json.erro ?? "Falha ao criar conta WhatsApp.");
    }
    return json.conta;
  },

  async updateWhatsAppAccount(
    contaId: string,
    patch: Partial<{
      rotulo: string;
      modo_operacao: WhatsAppModoOperacao;
      notificar_aprovacoes: boolean;
      codigo_autorizacao_obrigatorio: boolean;
      grupo_auto_responder: boolean;
      agente_orquestrador_id: string | null;
    }>
  ): Promise<WhatsAppContaResumo> {
    const res = await apiFetch(`/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as { conta?: WhatsAppContaResumo; erro?: string };
    if (!res.ok || !json.conta) {
      throw new Error(json.erro ?? "Falha ao atualizar configuraÃ§Ãµes do WhatsApp.");
    }
    return json.conta;
  },

  async deleteWhatsAppAccount(contaId: string): Promise<void> {
    const res = await apiFetch(`/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao remover conta WhatsApp.");
    }
  },

  async connectWhatsAppAccount(
    contaId: string,
    input: { mode?: WhatsAppMetodoPareamento; phoneNumber?: string }
  ): Promise<{ status: Record<string, unknown>; conta: WhatsAppContaResumo | null }> {
    const res = await apiFetch(
      `/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}/conectar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );
    const json = (await res.json()) as {
      status?: Record<string, unknown>;
      conta?: WhatsAppContaResumo | null;
      erro?: string;
    };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao iniciar conexÃ£o WhatsApp.");
    }
    return { status: json.status ?? {}, conta: json.conta ?? null };
  },

  async disconnectWhatsAppAccount(
    contaId: string,
    limparSessao = false
  ): Promise<{ status: Record<string, unknown>; conta: WhatsAppContaResumo | null }> {
    const res = await apiFetch(
      `/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}/desconectar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limparSessao }),
      }
    );
    const json = (await res.json()) as {
      status?: Record<string, unknown>;
      conta?: WhatsAppContaResumo | null;
      erro?: string;
    };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao desconectar conta WhatsApp.");
    }
    return { status: json.status ?? {}, conta: json.conta ?? null };
  },

  async listWhatsAppContacts(contaId: string): Promise<WhatsAppContatoAutorizado[]> {
    const res = await apiFetch(
      `/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}/contatos`
    );
    const json = (await res.json()) as { contatos?: WhatsAppContatoAutorizado[] };
    return json.contatos ?? [];
  },

  async addWhatsAppContact(
    contaId: string,
    input: {
      tipo?: "contato" | "grupo";
      identificador_jid: string;
      nome_exibicao?: string | null;
      permitido?: boolean;
      somente_mencao?: boolean;
    }
  ): Promise<WhatsAppContatoAutorizado> {
    const res = await apiFetch(
      `/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}/contatos`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );
    const json = (await res.json()) as { contato?: WhatsAppContatoAutorizado; erro?: string };
    if (!res.ok || !json.contato) {
      throw new Error(json.erro ?? "Falha ao autorizar contato ou grupo.");
    }
    return json.contato;
  },

  async removeWhatsAppContact(contaId: string, autorizacaoId: string): Promise<void> {
    const res = await apiFetch(
      `/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}/contatos/${encodeURIComponent(autorizacaoId)}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao revogar contato autorizado.");
    }
  },

  async listWhatsAppPairings(contaId: string): Promise<WhatsAppPairingRequest[]> {
    const res = await apiFetch(
      `/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}/pareamentos`
    );
    const json = (await res.json()) as { pareamentos?: WhatsAppPairingRequest[] };
    return json.pareamentos ?? [];
  },

  async resolveWhatsAppPairing(
    contaId: string,
    requestId: string,
    aprovar: boolean
  ): Promise<Record<string, unknown>> {
    const res = await apiFetch(
      `/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}/pareamentos/${encodeURIComponent(requestId)}/resolver`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aprovar }),
      }
    );
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(String(json.erro ?? "Falha ao resolver pedido de pareamento."));
    }
    return json;
  },

  async getWhatsAppHistory(
    contaId: string,
    chatJid?: string,
    limit = 30
  ): Promise<WhatsAppMensagemRegistro[]> {
    const params = new URLSearchParams();
    if (chatJid) params.set("chatJid", chatJid);
    params.set("limit", String(limit));
    const res = await apiFetch(
      `/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}/historico?${params.toString()}`
    );
    const json = (await res.json()) as { mensagens?: WhatsAppMensagemRegistro[] };
    return json.mensagens ?? [];
  },

  async sendWhatsAppMessage(
    contaId: string,
    payload: { chatJid: string; text?: string; mediaPath?: string }
  ): Promise<Record<string, unknown>> {
    const res = await apiFetch(
      `/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}/enviar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(String(json.erro ?? "Falha ao enviar mensagem pelo WhatsApp."));
    }
    return json;
  },
};
