import {
  randomUUID,
} from "node:crypto";
import {
  whatsAppNumberForms,
  type WhatsAppContatoAutorizado,
  type WhatsAppPairingRequest,
  type WhatsAppPairingStatus,
} from "@criativo/contracts";
import {
  ensureWhatsAppAccountRow,
} from "./auth-store.ts";
import type {
  SqliteConnectionLike,
} from "./types.ts";
import { extractPhoneDigits, normalizeContactJid, isSameWhatsAppUser, mapAuthorizedRow, mapPairingRow, type AddAuthorizedContactInput, type AuthorizedRow, type PairingRequestRow, type SenderRulesDeps, type TailArgs } from "./sender-rules-helpers.ts";
import * as evalOp from "./sender-evaluate-op.ts";

export * from "./sender-rules-helpers.ts";

export class WhatsAppSenderRules {
  private readonly db: SqliteConnectionLike;
  private readonly now: () => number;
  private readonly lidCache = new Map<string, string | null>();

  constructor(db: SqliteConnectionLike, options: { now?: () => number } = {}) {
    this.db = db;
    this.now = options.now ?? Date.now;
  }

  private async resolvePhoneForCandidate(
    contaId: string,
    candidates: Array<string | null | undefined>,
    resolveLid?: (lid: string) => Promise<string | null>
  ): Promise<string | null> {
    for (const candidate of candidates) {
      const direct = extractPhoneDigits(candidate);
      if (direct) return direct;
    }

    for (const candidate of candidates) {
      if (!candidate || !candidate.endsWith("@lid")) continue;
      const cacheKey = `${contaId}:${candidate}`;
      if (this.lidCache.has(cacheKey)) {
        const cached = this.lidCache.get(cacheKey);
        if (cached) return cached;
        continue;
      }
      if (!resolveLid) continue;
      try {
        const resolved = await resolveLid(candidate);
        const digits = resolved ? resolved.replace(/[^0-9]/g, "") : null;
        const normalized = digits && digits.length >= 6 ? digits : null;
        this.lidCache.set(cacheKey, normalized);
        if (normalized) return normalized;
      } catch {
        this.lidCache.set(cacheKey, null);
      }
    }

    return null;
  }

  private expirePendingRequests(contaId: string): void {
    const nowIso = new Date(this.now()).toISOString();
    this.db
      .prepare(
        `
        UPDATE whatsapp_pairing_requests
        SET status = 'expirado'
        WHERE conta_id = ? AND status = 'pendente' AND expira_em <= ?;
      `
      )
      .run(contaId, nowIso);
  }

  private findAuthorizedContact(
    contaId: string,
    remoteJid: string,
    resolvedPhone: string | null
  ): WhatsAppContatoAutorizado | null {
    const candidateForms = new Set<string>();
    if (resolvedPhone) {
      for (const form of whatsAppNumberForms(resolvedPhone)) {
        candidateForms.add(form);
      }
    }
    for (const form of whatsAppNumberForms(remoteJid)) {
      candidateForms.add(form);
    }

    const rows = this.db
      .prepare(
        `
        SELECT * FROM whatsapp_contatos_autorizados
        WHERE conta_id = ? AND tipo = 'contato' AND permitido = 1;
      `
      )
      .all(contaId) as unknown as AuthorizedRow[];

    for (const row of rows) {
      if (isSameWhatsAppUser(row.identificador_jid, remoteJid)) {
        return mapAuthorizedRow(row);
      }
      if (row.telefone_normalizado && candidateForms.has(row.telefone_normalizado)) {
        return mapAuthorizedRow(row);
      }
      const mapped = mapAuthorizedRow(row);
      if (mapped.variantes.some((variant) => candidateForms.has(variant))) {
        return mapped;
      }
    }

    return null;
  }


  private deps(): SenderRulesDeps {
    return {
      db: this.db,
      now: this.now,
      lidCache: this.lidCache,
      resolvePhoneForCandidate: this.resolvePhoneForCandidate.bind(this),
      expirePendingRequests: this.expirePendingRequests.bind(this),
      findAuthorizedContact: this.findAuthorizedContact.bind(this),
    };
  }

  public evaluateIncoming(...args: TailArgs<typeof evalOp.evaluateIncomingOp>): ReturnType<typeof evalOp.evaluateIncomingOp> {
    return evalOp.evaluateIncomingOp(this.deps(), ...args);
  }

  public addAuthorizedContact(input: AddAuthorizedContactInput): WhatsAppContatoAutorizado {
    ensureWhatsAppAccountRow(this.db, input.contaId);

    const identificadorJid = normalizeContactJid(input.identificadorJid, input.tipo);
    const variantes = input.tipo === "contato" ? whatsAppNumberForms(identificadorJid) : [];
    const telefoneNormalizado =
      input.tipo === "contato"
        ? variantes.find((v) => v.startsWith("55") && v.length === 13) ?? variantes[0] ?? null
        : null;

    const agora = new Date(this.now()).toISOString();
    const autorizacaoId = `auth-${randomUUID()}`;
    const permitido = input.permitido === false ? 0 : 1;
    const somenteMencao = input.somenteMencao === false ? 0 : 1;
    const origem = input.origem ?? "manual";
    const nomeExibicao = input.nomeExibicao?.trim() || null;

    this.db
      .prepare(
        `
        INSERT INTO whatsapp_contatos_autorizados (
          autorizacao_id,
          conta_id,
          tipo,
          identificador_jid,
          telefone_normalizado,
          variantes_json,
          nome_exibicao,
          permitido,
          somente_mencao,
          origem,
          criado_em,
          atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(conta_id, identificador_jid) DO UPDATE SET
          tipo = excluded.tipo,
          telefone_normalizado = excluded.telefone_normalizado,
          variantes_json = excluded.variantes_json,
          nome_exibicao = COALESCE(excluded.nome_exibicao, whatsapp_contatos_autorizados.nome_exibicao),
          permitido = excluded.permitido,
          somente_mencao = excluded.somente_mencao,
          origem = excluded.origem,
          atualizado_em = excluded.atualizado_em;
      `
      )
      .run(
        autorizacaoId,
        input.contaId,
        input.tipo,
        identificadorJid,
        telefoneNormalizado,
        JSON.stringify(variantes),
        nomeExibicao,
        permitido,
        somenteMencao,
        origem,
        agora,
        agora
      );

    const saved = this.db
      .prepare(
        `
        SELECT * FROM whatsapp_contatos_autorizados
        WHERE conta_id = ? AND identificador_jid = ?
        LIMIT 1;
      `
      )
      .get(input.contaId, identificadorJid) as AuthorizedRow;

    return mapAuthorizedRow(saved);
  }

  public removeAuthorizedContact(contaId: string, autorizacaoId: string): boolean {
    const res = this.db
      .prepare(
        `DELETE FROM whatsapp_contatos_autorizados WHERE conta_id = ? AND autorizacao_id = ?;`
      )
      .run(contaId, autorizacaoId);
    return Number(res.changes) > 0;
  }

  public listAuthorizedContacts(contaId: string): WhatsAppContatoAutorizado[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM whatsapp_contatos_autorizados
        WHERE conta_id = ?
        ORDER BY atualizado_em DESC;
      `
      )
      .all(contaId) as unknown as AuthorizedRow[];

    return rows.map(mapAuthorizedRow);
  }

  public listPairingRequests(
    contaId: string,
    statusFilter?: WhatsAppPairingStatus
  ): WhatsAppPairingRequest[] {
    this.expirePendingRequests(contaId);
    const rows = statusFilter
      ? (this.db
          .prepare(
            `
            SELECT * FROM whatsapp_pairing_requests
            WHERE conta_id = ? AND status = ?
            ORDER BY criado_em DESC;
          `
          )
          .all(contaId, statusFilter) as unknown as PairingRequestRow[])
      : (this.db
          .prepare(
            `
            SELECT * FROM whatsapp_pairing_requests
            WHERE conta_id = ?
            ORDER BY criado_em DESC;
          `
          )
          .all(contaId) as unknown as PairingRequestRow[]);

    return rows.map(mapPairingRow);
  }

  public resolvePairingRequest(
    contaId: string,
    requestId: string,
    aprovar: boolean
  ): { request: WhatsAppPairingRequest; contato?: WhatsAppContatoAutorizado } | null {
    this.expirePendingRequests(contaId);

    const existing = this.db
      .prepare(
        `
        SELECT * FROM whatsapp_pairing_requests
        WHERE conta_id = ? AND request_id = ?
        LIMIT 1;
      `
      )
      .get(contaId, requestId) as PairingRequestRow | undefined;

    if (!existing) {
      return null;
    }

    const agora = new Date(this.now()).toISOString();
    const novoStatus: WhatsAppPairingStatus = aprovar ? "aprovado" : "recusado";

    this.db
      .prepare(
        `
        UPDATE whatsapp_pairing_requests
        SET status = ?, resolvido_em = ?
        WHERE conta_id = ? AND request_id = ?;
      `
      )
      .run(novoStatus, agora, contaId, requestId);

    const updated = this.db
      .prepare(
        `
        SELECT * FROM whatsapp_pairing_requests
        WHERE conta_id = ? AND request_id = ?
        LIMIT 1;
      `
      )
      .get(contaId, requestId) as PairingRequestRow;

    const request = mapPairingRow(updated);
    if (!aprovar) {
      return { request };
    }

    const identificadorJid = existing.remetente_pn
      ? `${existing.remetente_pn}@s.whatsapp.net`
      : existing.remetente_jid;

    const contato = this.addAuthorizedContact({
      contaId,
      tipo: "contato",
      identificadorJid,
      nomeExibicao: existing.nome_contato,
      permitido: true,
      somenteMencao: false,
      origem: "pareamento",
    });

    return { request, contato };
  }
}

