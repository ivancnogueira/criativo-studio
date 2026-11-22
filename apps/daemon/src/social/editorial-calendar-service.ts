import { randomUUID } from "node:crypto";
import type {
  CreateEditorialPostInput,
  EditorialPostFormato,
  EditorialPostRecord,
  EditorialPostsFilter,
  EditorialPostStatus,
  EditorialSlideItem,
  UpdateEditorialPostInput,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";

interface EditorialPostRow {
  id: string;
  titulo: string;
  formato: EditorialPostFormato;
  status: EditorialPostStatus;
  pilar: string | null;
  data_agendada: string | null;
  agente_id: string | null;
  tarefa_id: string | null;
  legenda: string;
  slides_json: string;
  meta_media_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

const FORMATOS_VALIDOS = new Set<EditorialPostFormato>(["feed_4_5", "carrossel", "reels", "story"]);
const STATUS_VALIDOS = new Set<EditorialPostStatus>([
  "ideia",
  "rascunho",
  "em_producao",
  "aprovacao",
  "agendado",
  "publicado",
]);

function normalizeSlides(slides: unknown): EditorialSlideItem[] {
  if (!Array.isArray(slides)) return [];
  const normalized: EditorialSlideItem[] = [];
  for (let i = 0; i < slides.length; i += 1) {
    const raw = slides[i];
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!url) continue;
    normalized.push({
      id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `slide-${i + 1}-${randomUUID().slice(0, 6)}`,
      url,
      ordem: i,
      titulo_overlay: typeof item.titulo_overlay === "string" ? item.titulo_overlay : null,
      legenda_slide: typeof item.legenda_slide === "string" ? item.legenda_slide : null,
      aspect_ratio:
        item.aspect_ratio === "1:1" || item.aspect_ratio === "9:16" || item.aspect_ratio === "4:5"
          ? item.aspect_ratio
          : undefined,
    });
  }
  return normalized.slice(0, 10);
}

function parseSlidesJson(raw: string): EditorialSlideItem[] {
  try {
    return normalizeSlides(JSON.parse(raw));
  } catch {
    return [];
  }
}

function mapEditorialRow(row: EditorialPostRow): EditorialPostRecord {
  return {
    id: row.id,
    titulo: row.titulo,
    formato: row.formato,
    status: row.status,
    pilar: row.pilar ?? null,
    data_agendada: row.data_agendada ?? null,
    agente_id: row.agente_id ?? null,
    tarefa_id: row.tarefa_id ?? null,
    legenda: row.legenda ?? "",
    slides: parseSlidesJson(row.slides_json),
    meta_media_id: row.meta_media_id ?? null,
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em,
  };
}

/**
 * Serviço de domínio para o Calendário Editorial de Posts Instagram.
 * Totalmente isolado da tabela técnica `projecao_rotinas`.
 */
export class EditorialCalendarService {
  private readonly db: CriativoDatabase;

  constructor(db: CriativoDatabase) {
    this.db = db;
  }

  public listPosts(filters: EditorialPostsFilter = {}): EditorialPostRecord[] {
    const clauses: string[] = [];
    const params: Array<string> = [];

    if (filters.mes && /^\d{4}-\d{2}$/.test(filters.mes.trim())) {
      clauses.push("substr(data_agendada, 1, 7) = ?");
      params.push(filters.mes.trim());
    }
    if (filters.status && STATUS_VALIDOS.has(filters.status)) {
      clauses.push("status = ?");
      params.push(filters.status);
    }
    if (filters.formato && FORMATOS_VALIDOS.has(filters.formato)) {
      clauses.push("formato = ?");
      params.push(filters.formato);
    }
    if (filters.pilar && filters.pilar.trim()) {
      clauses.push("LOWER(COALESCE(pilar, '')) = LOWER(?)");
      params.push(filters.pilar.trim());
    }
    if (filters.busca && filters.busca.trim()) {
      const term = `%${filters.busca.trim()}%`;
      clauses.push("(LOWER(titulo) LIKE LOWER(?) OR LOWER(legenda) LIKE LOWER(?) OR LOWER(COALESCE(pilar, '')) LIKE LOWER(?))");
      params.push(term, term, term);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM calendario_editorial_posts
        ${where}
        ORDER BY
          CASE WHEN data_agendada IS NULL THEN 1 ELSE 0 END ASC,
          data_agendada ASC,
          atualizado_em DESC;
      `
      )
      .all(...params) as unknown as EditorialPostRow[];

    return rows.map(mapEditorialRow);
  }

  public getPost(id: string): EditorialPostRecord | null {
    const row = this.db.connection
      .prepare("SELECT * FROM calendario_editorial_posts WHERE id = ? LIMIT 1;")
      .get(id) as EditorialPostRow | undefined;
    return row ? mapEditorialRow(row) : null;
  }

  public createPost(input: CreateEditorialPostInput): EditorialPostRecord {
    const titulo = String(input.titulo ?? "").trim();
    if (!titulo) {
      throw new Error("Título da pauta editorial é obrigatório.");
    }

    const formato: EditorialPostFormato =
      input.formato && FORMATOS_VALIDOS.has(input.formato) ? input.formato : "feed_4_5";
    const status: EditorialPostStatus =
      input.status && STATUS_VALIDOS.has(input.status) ? input.status : "ideia";
    const id = input.id?.trim() || `ed-${randomUUID().slice(0, 12)}`;
    const agora = new Date().toISOString();
    const slides = normalizeSlides(input.slides ?? []);

    this.db.connection
      .prepare(
        `
        INSERT INTO calendario_editorial_posts (
          id, titulo, formato, status, pilar, data_agendada,
          agente_id, tarefa_id, legenda, slides_json, meta_media_id,
          criado_em, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `
      )
      .run(
        id,
        titulo,
        formato,
        status,
        input.pilar?.trim() || null,
        input.data_agendada?.trim() || null,
        input.agente_id?.trim() || null,
        input.tarefa_id?.trim() || null,
        String(input.legenda ?? ""),
        JSON.stringify(slides),
        input.meta_media_id?.trim() || null,
        agora,
        agora
      );

    const created = this.getPost(id);
    if (!created) {
      throw new Error(`Falha ao recuperar pauta editorial recém-criada: ${id}`);
    }
    return created;
  }

  public updatePost(id: string, patch: UpdateEditorialPostInput): EditorialPostRecord {
    const existing = this.getPost(id);
    if (!existing) {
      throw new Error(`Pauta editorial '${id}' não encontrada.`);
    }

    const nextTitulo = patch.titulo !== undefined ? String(patch.titulo).trim() : existing.titulo;
    if (!nextTitulo) {
      throw new Error("Título da pauta editorial não pode ficar vazio.");
    }

    const nextFormato =
      patch.formato !== undefined && FORMATOS_VALIDOS.has(patch.formato)
        ? patch.formato
        : existing.formato;
    const nextStatus =
      patch.status !== undefined && STATUS_VALIDOS.has(patch.status)
        ? patch.status
        : existing.status;
    const nextPilar = patch.pilar !== undefined ? (patch.pilar?.trim() || null) : existing.pilar;
    const nextData =
      patch.data_agendada !== undefined ? (patch.data_agendada?.trim() || null) : existing.data_agendada;
    const nextAgente =
      patch.agente_id !== undefined ? (patch.agente_id?.trim() || null) : existing.agente_id;
    const nextTarefa =
      patch.tarefa_id !== undefined ? (patch.tarefa_id?.trim() || null) : existing.tarefa_id;
    const nextLegenda = patch.legenda !== undefined ? String(patch.legenda) : existing.legenda;
    const nextSlides =
      patch.slides !== undefined ? normalizeSlides(patch.slides) : existing.slides;
    const nextMetaId =
      patch.meta_media_id !== undefined ? (patch.meta_media_id?.trim() || null) : existing.meta_media_id;
    const agora = new Date().toISOString();

    this.db.connection
      .prepare(
        `
        UPDATE calendario_editorial_posts
        SET titulo = ?, formato = ?, status = ?, pilar = ?, data_agendada = ?,
            agente_id = ?, tarefa_id = ?, legenda = ?, slides_json = ?,
            meta_media_id = ?, atualizado_em = ?
        WHERE id = ?;
      `
      )
      .run(
        nextTitulo,
        nextFormato,
        nextStatus,
        nextPilar,
        nextData,
        nextAgente,
        nextTarefa,
        nextLegenda,
        JSON.stringify(nextSlides),
        nextMetaId,
        agora,
        id
      );

    return this.getPost(id)!;
  }

  public deletePost(id: string): boolean {
    const info = this.db.connection
      .prepare("DELETE FROM calendario_editorial_posts WHERE id = ?;")
      .run(id);
    return Number(info.changes ?? 0) > 0;
  }

  public markPublished(id: string, metaMediaId: string): EditorialPostRecord | null {
    const existing = this.getPost(id);
    if (!existing) {
      return null;
    }
    return this.updatePost(id, {
      status: "publicado",
      meta_media_id: metaMediaId,
    });
  }
}
