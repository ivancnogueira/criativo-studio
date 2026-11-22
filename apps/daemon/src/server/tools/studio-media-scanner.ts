import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import type { AnexoChat, ArquivoStudio } from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import type { LabeledImageInput } from "../../providers/antigravity-acp-service.ts";
const STUDIO_MEDIA_MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export interface ScannedWorkspaceFile {
  nome_original: string;
  caminho_relativo: string;
  mime_type: string;
  tamanho_bytes: number;
  tipo_uso: ArquivoStudio["tipo_uso"];
  criado_em: string;
  diskPath: string;
}

/**
 * Escaneia arquivos reais presentes nas pastas do workspace (`recursos/` e `saidas/`)
 * para exibição no Cockpit Web e injeção no contexto/ImagePaths dos agentes.
 */
export function scanWorkspaceMediaFiles(workspaceRoot: string, limit = 120): ScannedWorkspaceFile[] {
  const roots: Array<{ dir: string; tipoUso: ArquivoStudio["tipo_uso"] }> = [
    { dir: resolve(workspaceRoot, "recursos", "referencias"), tipoUso: "referencia" },
    { dir: resolve(workspaceRoot, "recursos", "fotos"), tipoUso: "referencia" },
    { dir: resolve(workspaceRoot, "recursos", "logos"), tipoUso: "logo" },
    { dir: resolve(workspaceRoot, "recursos", "personagens"), tipoUso: "personagem" },
    { dir: resolve(workspaceRoot, "recursos", "uploads"), tipoUso: "referencia" },
    { dir: resolve(workspaceRoot, "saidas"), tipoUso: "gerado" },
  ];

  const found: ScannedWorkspaceFile[] = [];

  const walk = (dir: string, defaultUso: ArquivoStudio["tipo_uso"]): void => {
    if (found.length >= limit || !existsSync(dir)) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= limit) break;
      if (entry.name.startsWith(".")) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, defaultUso);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = extname(entry.name).toLowerCase();
      const mime = STUDIO_MEDIA_MIME_MAP[ext];
      if (!mime) continue;
      try {
        const st = statSync(fullPath);
        if (st.size <= 0) continue;
        const rel = relative(workspaceRoot, fullPath).replaceAll("\\", "/");
        const tipoUso: ArquivoStudio["tipo_uso"] =
          mime.startsWith("video/") && defaultUso === "gerado" ? "video" : defaultUso;
        found.push({
          nome_original: basename(entry.name),
          caminho_relativo: rel,
          mime_type: mime,
          tamanho_bytes: st.size,
          tipo_uso: tipoUso,
          criado_em: st.mtime.toISOString(),
          diskPath: fullPath,
        });
      } catch {
        // ignora arquivo inacessível
      }
    }
  };

  for (const r of roots) {
    walk(r.dir, r.tipoUso);
  }

  return found.sort((a, b) => b.criado_em.localeCompare(a.criado_em));
}

/**
 * Sincroniza de forma idempotente arquivos do disco para `projecao_arquivos` no SQLite.
 */
export function syncWorkspaceFilesToDatabase(db: CriativoDatabase, workspaceRoot: string): number {
  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") return 0;

  const existingRows = db.connection
    .prepare(`SELECT caminho_relativo FROM projecao_arquivos;`)
    .all() as Array<{ caminho_relativo: string }>;
  const known = new Set(existingRows.map((r) => r.caminho_relativo.replaceAll("\\", "/")));

  const scanned = scanWorkspaceMediaFiles(workspaceRoot);
  const insertStmt = db.connection.prepare(
    `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?);`
  );

  let added = 0;
  for (const item of scanned) {
    if (known.has(item.caminho_relativo)) continue;
    insertStmt.run(
      `arq-${randomUUID().slice(0, 8)}`,
      item.nome_original,
      item.caminho_relativo,
      item.mime_type,
      item.tamanho_bytes,
      item.tipo_uso,
      item.criado_em
    );
    known.add(item.caminho_relativo);
    added += 1;
  }
  return added;
}

export interface LabeledVisualAsset extends LabeledImageInput {
  relPath: string;
}

/**
 * Seleciona ativos visuais para geração de imagem/vídeo.
 * Quando o agente informa listas explícitas (`specificImages`, `specificFotos` ou `specificReferencias`),
 * respeita exatamente a quantidade escolhida até `maxTotal` sem corte artificial em 3 fotos.
 */
export function selectBalancedVisualAssets(
  db: CriativoDatabase,
  workspaceRoot: string,
  options: {
    explicitAttachments?: AnexoChat[];
    usarFotosReais?: boolean;
    specificImages?: string[];
    specificFotos?: string[];
    specificReferencias?: string[];
    maxFotos?: number;
    maxReferencias?: number;
    maxLogos?: number;
    maxTotal?: number;
  } = {}
): LabeledVisualAsset[] {
  const maxFotos = options.maxFotos ?? 3;
  const maxReferencias = options.maxReferencias ?? 2;
  const maxLogos = options.maxLogos ?? 1;
  const maxTotal =
    typeof options.maxTotal === "number" && Number.isFinite(options.maxTotal)
      ? Math.max(0, Math.trunc(options.maxTotal))
      : 14;
  const usarFotosReais = options.usarFotosReais !== false;

  const picked: LabeledVisualAsset[] = [];
  const seenAbs = new Set<string>();

  const inferRoleFromRelPath = (relPath: string): LabeledImageInput["role"] => {
    const lower = relPath.toLowerCase();
    if (lower.includes("/fotos/") || lower.startsWith("recursos/fotos/") || lower.includes("/personagens/") || lower.startsWith("recursos/personagens/")) {
      return "foto_real";
    }
    if (lower.includes("/logos/") || lower.startsWith("recursos/logos/")) {
      return "logo";
    }
    return "referencia_estilo";
  };

  const pushAsset = (relRaw: string, role: LabeledImageInput["role"]) => {
    if (picked.length >= maxTotal) return;
    const cleanRel = relRaw.replaceAll("\\", "/").replace(/^\/+/, "");
    if (!cleanRel || cleanRel.includes("..")) return;
    const abs = resolve(workspaceRoot, cleanRel);
    if (seenAbs.has(abs) || !existsSync(abs)) return;
    seenAbs.add(abs);
    picked.push({
      path: abs,
      relPath: cleanRel,
      role,
      label: cleanRel,
    });
  };

  for (const att of options.explicitAttachments ?? []) {
    if (att?.caminho_relativo) {
      pushAsset(att.caminho_relativo, "anexo_usuario");
    }
  }

  for (const rel of options.specificImages ?? []) {
    pushAsset(rel, inferRoleFromRelPath(rel));
  }
  for (const rel of options.specificFotos ?? []) {
    pushAsset(rel, "foto_real");
  }
  for (const rel of options.specificReferencias ?? []) {
    pushAsset(rel, "referencia_estilo");
  }

  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
    return picked;
  }

  if (usarFotosReais && maxFotos > 0) {
    const fotoRows = db.connection
      .prepare(
        `SELECT caminho_relativo FROM projecao_arquivos
         WHERE (caminho_relativo LIKE 'recursos/fotos/%'
                OR caminho_relativo LIKE 'recursos/personagens/%'
                OR tipo_uso = 'personagem')
           AND mime_type LIKE 'image/%'
           AND mime_type NOT LIKE '%svg%'
         ORDER BY CASE
           WHEN caminho_relativo LIKE 'recursos/fotos/%' THEN 0
           WHEN caminho_relativo LIKE 'recursos/personagens/%' THEN 1
           ELSE 2
         END, criado_em DESC
         LIMIT 24;`
      )
      .all() as Array<{ caminho_relativo: string }>;
    for (const row of fotoRows) {
      if (picked.length >= maxTotal) break;
      if (picked.filter((p) => p.role === "foto_real").length >= maxFotos) break;
      pushAsset(row.caminho_relativo, "foto_real");
    }
  }

  if (maxReferencias > 0) {
    const refRows = db.connection
      .prepare(
        `SELECT caminho_relativo FROM projecao_arquivos
         WHERE (caminho_relativo LIKE 'recursos/referencias/%' OR tipo_uso = 'referencia')
           AND caminho_relativo NOT LIKE 'recursos/fotos/%'
           AND mime_type LIKE 'image/%'
           AND mime_type NOT LIKE '%svg%'
         ORDER BY criado_em DESC
         LIMIT 24;`
      )
      .all() as Array<{ caminho_relativo: string }>;
    for (const row of refRows) {
      if (picked.length >= maxTotal) break;
      if (picked.filter((p) => p.role === "referencia_estilo").length >= maxReferencias) break;
      pushAsset(row.caminho_relativo, "referencia_estilo");
    }
  }

  if (maxLogos > 0) {
    const logoRows = db.connection
      .prepare(
        `SELECT caminho_relativo FROM projecao_arquivos
         WHERE (caminho_relativo LIKE 'recursos/logos/%' OR tipo_uso = 'logo')
           AND mime_type LIKE 'image/%'
           AND mime_type NOT LIKE '%svg%'
         ORDER BY criado_em DESC
         LIMIT 6;`
      )
      .all() as Array<{ caminho_relativo: string }>;
    for (const row of logoRows) {
      if (picked.length >= maxTotal) break;
      if (picked.filter((p) => p.role === "logo").length >= maxLogos) break;
      pushAsset(row.caminho_relativo, "logo");
    }
  }

  return picked;
}
