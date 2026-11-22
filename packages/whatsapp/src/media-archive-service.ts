import {
  randomUUID,
} from "node:crypto";
import {
  existsSync,
  rmSync,
  statSync,
} from "node:fs";
import {
  join,
  resolve,
  sep,
} from "node:path";
import type {
  WhatsAppContaResumo,
  WhatsAppContatoAutorizado,
  WhatsAppMensagemRegistro,
} from "@criativo/contracts";
import {
  ensureWhatsAppAccountRow,
} from "./auth-store.ts";
import type {
  SqliteConnectionLike,
} from "./types.ts";
import { WHATSAPP_MAX_MEDIA_TOTAL_BYTES, WHATSAPP_RETENTION_MS, mapHistoryRow, collectFilesRecursively, type WhatsAppArchiveServiceOptions, type RecordWhatsAppMessageInput, type ListWhatsAppHistoryQuery, type WhatsAppPlacesSnapshot, type PruneArchiveReport, type HistoryDbRow } from "./media-archive-helpers.ts";

export class WhatsAppArchiveService {
  private readonly db: SqliteConnectionLike;
  private readonly workspaceRoot: string;
  private readonly maxTotalBytes: number;
  private readonly retentionMs: number;
  private readonly now: () => number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(options: WhatsAppArchiveServiceOptions) {
    this.db = options.db;
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.maxTotalBytes = options.maxTotalBytes ?? WHATSAPP_MAX_MEDIA_TOTAL_BYTES;
    this.retentionMs = options.retentionMs ?? WHATSAPP_RETENTION_MS;
    this.now = options.now ?? Date.now;
  }

  public recordMessage(input: RecordWhatsAppMessageInput): WhatsAppMensagemRegistro {
    ensureWhatsAppAccountRow(this.db, input.contaId);

    const mensagemId = input.mensagemId?.trim() || `wppmsg-${randomUUID()}`;
    const currentNow = this.now();
    const ocorridoEm = input.ocorridoEm ?? new Date(currentNow).toISOString();
    const parsedOcorrido = Date.parse(ocorridoEm);
    const baseMs = Number.isFinite(parsedOcorrido) ? parsedOcorrido : currentNow;
    const expiraEm = input.expiraEm ?? new Date(baseMs + this.retentionMs).toISOString();

    const tipoConteudo = input.tipoConteudo ?? "texto";
    const texto = input.texto ?? null;
    const midiaCaminho = input.midiaCaminho ?? null;
    const midiaMime = input.midiaMime ?? null;
    const midiaTamanhoBytes = Number(input.midiaTamanhoBytes ?? 0);
    const ehGrupo = input.ehGrupo ? 1 : 0;
    const ackStatus = input.ackStatus ?? "enviado";
    const metadadosJson = JSON.stringify(input.metadados ?? {});

    this.db
      .prepare(
        `
        INSERT INTO whatsapp_historico_mensagens (
          mensagem_id,
          conta_id,
          chat_jid,
          remetente_jid,
          remetente_nome,
          direcao,
          tipo_conteudo,
          texto,
          midia_caminho,
          midia_mime,
          midia_tamanho_bytes,
          eh_grupo,
          ack_status,
          metadados_json,
          ocorrido_em,
          expira_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(mensagem_id) DO UPDATE SET
          texto = COALESCE(excluded.texto, whatsapp_historico_mensagens.texto),
          midia_caminho = COALESCE(excluded.midia_caminho, whatsapp_historico_mensagens.midia_caminho),
          midia_mime = COALESCE(excluded.midia_mime, whatsapp_historico_mensagens.midia_mime),
          midia_tamanho_bytes = CASE
            WHEN excluded.midia_tamanho_bytes > 0 THEN excluded.midia_tamanho_bytes
            ELSE whatsapp_historico_mensagens.midia_tamanho_bytes
          END,
          ack_status = COALESCE(excluded.ack_status, whatsapp_historico_mensagens.ack_status),
          metadados_json = excluded.metadados_json;
      `
      )
      .run(
        mensagemId,
        input.contaId,
        input.chatJid,
        input.remetenteJid,
        input.remetenteNome ?? null,
        input.direcao,
        tipoConteudo,
        texto,
        midiaCaminho,
        midiaMime,
        midiaTamanhoBytes,
        ehGrupo,
        ackStatus,
        metadadosJson,
        ocorridoEm,
        expiraEm
      );

    return {
      mensagem_id: mensagemId,
      conta_id: input.contaId,
      chat_jid: input.chatJid,
      remetente_jid: input.remetenteJid,
      remetente_nome: input.remetenteNome ?? null,
      direcao: input.direcao,
      tipo_conteudo: tipoConteudo,
      texto,
      midia_caminho: midiaCaminho,
      midia_mime: midiaMime,
      midia_tamanho_bytes: midiaTamanhoBytes,
      eh_grupo: ehGrupo === 1,
      ack_status: ackStatus,
      metadados: input.metadados ?? {},
      ocorrido_em: ocorridoEm,
      expira_em: expiraEm,
    };
  }

  public listHistory(query: ListWhatsAppHistoryQuery = {}): WhatsAppMensagemRegistro[] {
    const safeLimit = Math.min(100, Math.max(1, Math.trunc(query.limit ?? 30)));
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.contaId) {
      conditions.push("conta_id = ?");
      params.push(query.contaId);
    }
    if (query.chatJid) {
      conditions.push("chat_jid = ?");
      params.push(query.chatJid);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(safeLimit);

    const rows = this.db
      .prepare(
        `
        SELECT * FROM whatsapp_historico_mensagens
        ${whereClause}
        ORDER BY ocorrido_em DESC
        LIMIT ?;
      `
      )
      .all(...params) as unknown as HistoryDbRow[];

    return rows.map(mapHistoryRow);
  }

  public listPlaces(contaId?: string): WhatsAppPlacesSnapshot {
    const contas = (contaId
      ? this.db
          .prepare(
            `SELECT conta_id, rotulo, status, numero_telefone, modo_operacao FROM whatsapp_contas WHERE conta_id = ?;`
          )
          .all(contaId)
      : this.db
          .prepare(
            `SELECT conta_id, rotulo, status, numero_telefone, modo_operacao FROM whatsapp_contas ORDER BY atualizado_em DESC;`
          )
          .all()) as Array<
      Pick<WhatsAppContaResumo, "conta_id" | "rotulo" | "status" | "numero_telefone" | "modo_operacao">
    >;

    const autorizadosRows = (contaId
      ? this.db
          .prepare(
            `SELECT * FROM whatsapp_contatos_autorizados WHERE conta_id = ? AND permitido = 1 ORDER BY atualizado_em DESC;`
          )
          .all(contaId)
      : this.db
          .prepare(
            `SELECT * FROM whatsapp_contatos_autorizados WHERE permitido = 1 ORDER BY atualizado_em DESC;`
          )
          .all()) as Array<{
      autorizacao_id: string;
      conta_id: string;
      tipo: "contato" | "grupo";
      identificador_jid: string;
      telefone_normalizado: string | null;
      variantes_json: string;
      nome_exibicao: string | null;
      permitido: number;
      somente_mencao: number;
      origem: "manual" | "pareamento" | "auto_chat";
      criado_em: string;
      atualizado_em: string;
    }>;

    const autorizados: WhatsAppContatoAutorizado[] = autorizadosRows.map((row) => {
      let variantes: string[] = [];
      try {
        const parsed = JSON.parse(row.variantes_json);
        if (Array.isArray(parsed)) {
          variantes = parsed.filter((v): v is string => typeof v === "string");
        }
      } catch {
        variantes = [];
      }
      return {
        autorizacao_id: row.autorizacao_id,
        conta_id: row.conta_id,
        tipo: row.tipo,
        identificador_jid: row.identificador_jid,
        telefone_normalizado: row.telefone_normalizado,
        variantes,
        nome_exibicao: row.nome_exibicao,
        permitido: row.permitido === 1,
        somente_mencao: row.somente_mencao === 1,
        origem: row.origem,
        criado_em: row.criado_em,
        atualizado_em: row.atualizado_em,
      };
    });

    const recentRows = (contaId
      ? this.db
          .prepare(
            `
            SELECT
              conta_id,
              chat_jid,
              MAX(ocorrido_em) AS ultima_mensagem_em,
              COUNT(*) AS total_mensagens,
              MAX(eh_grupo) AS eh_grupo
            FROM whatsapp_historico_mensagens
            WHERE conta_id = ?
            GROUP BY conta_id, chat_jid
            ORDER BY ultima_mensagem_em DESC
            LIMIT 50;
          `
          )
          .all(contaId)
      : this.db
          .prepare(
            `
            SELECT
              conta_id,
              chat_jid,
              MAX(ocorrido_em) AS ultima_mensagem_em,
              COUNT(*) AS total_mensagens,
              MAX(eh_grupo) AS eh_grupo
            FROM whatsapp_historico_mensagens
            GROUP BY conta_id, chat_jid
            ORDER BY ultima_mensagem_em DESC
            LIMIT 50;
          `
          )
          .all()) as Array<{
      conta_id: string;
      chat_jid: string;
      ultima_mensagem_em: string;
      total_mensagens: number;
      eh_grupo: number;
    }>;

    const chatsRecentes = recentRows.map((item) => {
      const last = this.db
        .prepare(
          `
          SELECT texto FROM whatsapp_historico_mensagens
          WHERE conta_id = ? AND chat_jid = ?
          ORDER BY ocorrido_em DESC
          LIMIT 1;
        `
        )
        .get(item.conta_id, item.chat_jid) as { texto: string | null } | undefined;

      return {
        conta_id: item.conta_id,
        chat_jid: item.chat_jid,
        ultima_mensagem_em: item.ultima_mensagem_em,
        total_mensagens: Number(item.total_mensagens),
        ultimo_texto: last?.texto ?? null,
        eh_grupo: item.eh_grupo === 1,
      };
    });

    return {
      contas,
      autorizados,
      chatsRecentes,
    };
  }

  public pruneExpiredAndEnforceCap(): PruneArchiveReport {
    const nowIso = new Date(this.now()).toISOString();
    const whatsappUploadsRoot = resolve(this.workspaceRoot, "recursos", "uploads", "whatsapp");

    const expiredRows = this.db
      .prepare(
        `
        SELECT mensagem_id, midia_caminho
        FROM whatsapp_historico_mensagens
        WHERE expira_em < ?;
      `
      )
      .all(nowIso) as Array<{ mensagem_id: string; midia_caminho: string | null }>;

    let removidosArquivosExpirados = 0;
    let bytesLiberados = 0;

    for (const row of expiredRows) {
      if (!row.midia_caminho) continue;
      const diskCandidate = resolve(this.workspaceRoot, row.midia_caminho);
      if (diskCandidate.startsWith(`${whatsappUploadsRoot}${sep}`) && existsSync(diskCandidate)) {
        try {
          bytesLiberados += statSync(diskCandidate).size;
          rmSync(diskCandidate, { force: true });
          removidosArquivosExpirados += 1;
        } catch {
          // Ignora arquivo bloqueado
        }
      }
      this.db
        .prepare(`DELETE FROM projecao_arquivos WHERE caminho_relativo = ?;`)
        .run(row.midia_caminho);
    }

    const deletedRes = this.db
      .prepare(`DELETE FROM whatsapp_historico_mensagens WHERE expira_em < ?;`)
      .run(nowIso);
    const removidosHistorico = Number(deletedRes.changes ?? 0);

    // Garante teto de 2 GiB em recursos/uploads/whatsapp/ removendo anexos mais antigos primeiro
    const allFiles = collectFilesRecursively(whatsappUploadsRoot).sort(
      (a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path)
    );
    let totalBytes = allFiles.reduce((acc, item) => acc + item.size, 0);
    let removidosArquivosPorTeto = 0;

    for (const file of allFiles) {
      if (totalBytes <= this.maxTotalBytes) {
        break;
      }
      if (!resolve(file.path).startsWith(`${whatsappUploadsRoot}${sep}`)) {
        continue;
      }
      try {
        rmSync(file.path, { force: true });
        totalBytes -= file.size;
        bytesLiberados += file.size;
        removidosArquivosPorTeto += 1;

        const relativePosix = file.path
          .slice(this.workspaceRoot.length + 1)
          .split(sep)
          .join("/");

        this.db
          .prepare(`DELETE FROM projecao_arquivos WHERE caminho_relativo = ?;`)
          .run(relativePosix);
        this.db
          .prepare(
            `UPDATE whatsapp_historico_mensagens SET midia_caminho = NULL, midia_tamanho_bytes = 0 WHERE midia_caminho = ?;`
          )
          .run(relativePosix);
      } catch {
        // Ignora arquivo bloqueado e continua com próximo
      }
    }

    return {
      removidosHistorico,
      removidosArquivosExpirados,
      removidosArquivosPorTeto,
      bytesLiberados,
    };
  }

  public startPeriodicCleanup(intervalMs: number = 60 * 60_000): void {
    if (this.cleanupTimer) {
      return;
    }
    this.cleanupTimer = setInterval(() => {
      try {
        this.pruneExpiredAndEnforceCap();
      } catch {
        // Limpeza periódica não pode derrubar o daemon
      }
    }, intervalMs);
    this.cleanupTimer.unref?.();
  }

  public stopPeriodicCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

