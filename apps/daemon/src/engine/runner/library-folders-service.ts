/**
 * Árvore hierárquica de pastas da Biblioteca (`LibraryFoldersService` — CHAT-03).
 * Impõe até 4 níveis de profundidade, 60 chars por nome, 200 pastas no estúdio,
 * prevenção de ciclos parent-child e proteção anti-path-traversal no workspace.
 */
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import type {
  ArquivoStudio,
  BibliotecaPasta,
  BibliotecasPastasSnapshot,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import type { WebSocketHub } from "../../server/websocket-hub.ts";

export const LIBRARY_FOLDER_LIMITS = {
  maxLevels: 4,
  maxNameChars: 60,
  maxFolders: 200,
  maxFilesPerFolderList: 200,
} as const;

const ALLOWED_WORKSPACE_ROOT_PREFIXES = ["recursos", "conteudos", "saidas", "previas"];

const EXT_TO_MIME: Record<string, string> = {
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
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".html": "text/html",
  ".ts": "text/plain",
  ".tsx": "text/plain",
  ".js": "text/javascript",
  ".css": "text/css",
  ".sql": "text/plain",
};

interface PastaRow {
  pasta_id: string;
  agente_id: string;
  parent_id: string | null;
  nome: string;
  caminho_completo: string;
  nivel: number;
  criado_em: string;
  atualizado_em: string;
}

export interface LibraryFoldersServiceDeps {
  db: CriativoDatabase;
  workspaceRoot: string;
  wsHub?: WebSocketHub;
}

function validateFolderSegmentName(raw: string): string {
  const clean = raw.trim();
  if (!clean) {
    throw new Error("O nome da pasta não pode ser vazio.");
  }
  if (clean.length > LIBRARY_FOLDER_LIMITS.maxNameChars) {
    throw new Error(
      `O nome da pasta deve ter no máximo ${LIBRARY_FOLDER_LIMITS.maxNameChars} caracteres.`,
    );
  }
  if (/[\\/:*?"<>|]/.test(clean) || clean === "." || clean === "..") {
    throw new Error("O nome da pasta contém caracteres inválidos ('/', '\\', '..', etc.).");
  }
  return clean;
}

export class LibraryFoldersService {
  private readonly db: CriativoDatabase;
  private readonly workspaceRoot: string;
  private readonly wsHub?: WebSocketHub;
  private revision = 1;

  constructor(deps: LibraryFoldersServiceDeps) {
    this.db = deps.db;
    this.workspaceRoot = resolve(deps.workspaceRoot);
    this.wsHub = deps.wsHub;
  }

  private emitChanged(agenteId?: string): void {
    this.revision += 1;
    this.wsHub?.broadcast("library:folders_changed", {
      agente_id: agenteId,
      revisao: this.revision,
    });
  }

  private mapRow(row: PastaRow): BibliotecaPasta {
    return {
      pasta_id: row.pasta_id,
      agente_id: row.agente_id,
      parent_id: row.parent_id,
      nome: row.nome,
      caminho_completo: row.caminho_completo,
      nivel: row.nivel,
      criado_em: row.criado_em,
      atualizado_em: row.atualizado_em,
    };
  }

  public getFolderById(pastaId: string): BibliotecaPasta | null {
    const row = this.db.connection
      .prepare("SELECT * FROM projecao_biblioteca_pastas WHERE pasta_id = ? LIMIT 1;")
      .get(pastaId) as PastaRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  public getSnapshot(): BibliotecasPastasSnapshot {
    const folderRows = this.db.connection
      .prepare(
        `SELECT * FROM projecao_biblioteca_pastas
         ORDER BY agente_id ASC, nivel ASC, nome COLLATE NOCASE ASC;`,
      )
      .all() as unknown as PastaRow[];

    const fileRows = this.db.connection
      .prepare("SELECT arquivo_id, agente_id, pasta_id FROM projecao_arquivos;")
      .all() as Array<{ arquivo_id: string; agente_id: string | null; pasta_id: string | null }>;

    const placement: Record<string, string> = {};
    const unfiledByAgent: Record<string, number> = {};

    for (const f of fileRows) {
      if (f.pasta_id) {
        placement[f.arquivo_id] = f.pasta_id;
      } else {
        const key = f.agente_id ?? "geral";
        unfiledByAgent[key] = (unfiledByAgent[key] ?? 0) + 1;
      }
    }

    return {
      folders: folderRows.map((r) => this.mapRow(r)),
      placement,
      unfiledByAgent,
    };
  }

  public createFolder(input: {
    agenteId: string;
    nome: string;
    parentId?: string | null;
  }): BibliotecaPasta {
    const cleanName = validateFolderSegmentName(input.nome);
    const parentId = input.parentId?.trim() || null;

    const created = this.db.runInTransaction(() => {
      const totalRow = this.db.connection
        .prepare("SELECT COUNT(*) AS total FROM projecao_biblioteca_pastas;")
        .get() as { total: number };
      if (totalRow.total >= LIBRARY_FOLDER_LIMITS.maxFolders) {
        throw new Error(
          `Limite máximo de ${LIBRARY_FOLDER_LIMITS.maxFolders} pastas na Biblioteca atingido.`,
        );
      }

      let nivel = 1;
      let caminhoCompleto = cleanName;

      if (parentId) {
        const parent = this.getFolderById(parentId);
        if (!parent) {
          throw new Error("Pasta superior (pai) não encontrada.");
        }
        if (parent.agente_id !== input.agenteId) {
          throw new Error("A subpasta deve pertencer ao mesmo agente da pasta superior.");
        }
        nivel = parent.nivel + 1;
        if (nivel > LIBRARY_FOLDER_LIMITS.maxLevels) {
          throw new Error(
            `Profundidade máxima de ${LIBRARY_FOLDER_LIMITS.maxLevels} níveis atingida na Biblioteca.`,
          );
        }
        caminhoCompleto = `${parent.caminho_completo}/${cleanName}`;
      }

      const duplicate = this.db.connection
        .prepare(
          `SELECT pasta_id FROM projecao_biblioteca_pastas
           WHERE agente_id = ?
             AND COALESCE(parent_id, '') = COALESCE(?, '')
             AND lower(nome) = lower(?)
           LIMIT 1;`,
        )
        .get(input.agenteId, parentId, cleanName) as { pasta_id?: string } | undefined;

      if (duplicate?.pasta_id) {
        throw new Error(`Já existe uma pasta chamada '${cleanName}' neste nível.`);
      }

      const pastaId = `fld-${randomUUID().slice(0, 10)}`;
      const agora = new Date().toISOString();

      this.db.connection
        .prepare(
          `INSERT INTO projecao_biblioteca_pastas (
            pasta_id, agente_id, parent_id, nome, caminho_completo, nivel, criado_em, atualizado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        )
        .run(pastaId, input.agenteId, parentId, cleanName, caminhoCompleto, nivel, agora, agora);

      return this.getFolderById(pastaId)!;
    });

    this.emitChanged(input.agenteId);
    return created;
  }

  /**
   * Cria ou reutiliza recursivamente um caminho como `"Campanha Outono/Carrossel"` (até 4 níveis).
   */
  public ensureFolderPath(agenteId: string, folderPath: string): BibliotecaPasta {
    const segments = folderPath
      .split("/")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (segments.length === 0) {
      throw new Error("Caminho de pasta inválido.");
    }
    if (segments.length > LIBRARY_FOLDER_LIMITS.maxLevels) {
      throw new Error(
        `O caminho '${folderPath}' possui ${segments.length} níveis (máximo permitido: ${LIBRARY_FOLDER_LIMITS.maxLevels}).`,
      );
    }
    for (const seg of segments) {
      validateFolderSegmentName(seg);
    }

    let createdAny = false;
    const leaf = this.db.runInTransaction(() => {
      let currentParentId: string | null = null;
      let currentFolder: BibliotecaPasta | null = null;

      for (const seg of segments) {
        const existing = this.db.connection
          .prepare(
            `SELECT * FROM projecao_biblioteca_pastas
             WHERE agente_id = ?
               AND COALESCE(parent_id, '') = COALESCE(?, '')
               AND lower(nome) = lower(?)
             LIMIT 1;`,
          )
          .get(agenteId, currentParentId, seg) as PastaRow | undefined;

        if (existing) {
          currentFolder = this.mapRow(existing);
          currentParentId = currentFolder.pasta_id;
        } else {
          createdAny = true;
          const totalRow = this.db.connection
            .prepare("SELECT COUNT(*) AS total FROM projecao_biblioteca_pastas;")
            .get() as { total: number };
          if (totalRow.total >= LIBRARY_FOLDER_LIMITS.maxFolders) {
            throw new Error(
              `Limite máximo de ${LIBRARY_FOLDER_LIMITS.maxFolders} pastas na Biblioteca atingido.`,
            );
          }

          const nivel: number = currentFolder ? currentFolder.nivel + 1 : 1;
          const caminho: string = currentFolder ? `${currentFolder.caminho_completo}/${seg}` : seg;
          const newId = `fld-${randomUUID().slice(0, 10)}`;
          const agora = new Date().toISOString();

          this.db.connection
            .prepare(
              `INSERT INTO projecao_biblioteca_pastas (
                pasta_id, agente_id, parent_id, nome, caminho_completo, nivel, criado_em, atualizado_em
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
            )
            .run(newId, agenteId, currentParentId, seg, caminho, nivel, agora, agora);

          currentFolder = this.getFolderById(newId)!;
          currentParentId = newId;
        }
      }

      return currentFolder!;
    });

    if (createdAny) {
      this.emitChanged(agenteId);
    }
    return leaf;
  }

  private getSubtreeMaxRelativeDepth(pastaId: string): number {
    const children = this.db.connection
      .prepare("SELECT pasta_id FROM projecao_biblioteca_pastas WHERE parent_id = ?;")
      .all(pastaId) as Array<{ pasta_id: string }>;
    if (children.length === 0) return 0;
    let maxChild = 0;
    for (const ch of children) {
      maxChild = Math.max(maxChild, 1 + this.getSubtreeMaxRelativeDepth(ch.pasta_id));
    }
    return maxChild;
  }

  private isDescendantOf(candidateId: string, ancestorId: string): boolean {
    let cur: string | null = candidateId;
    const visited = new Set<string>();
    while (cur) {
      if (cur === ancestorId) return true;
      if (visited.has(cur)) break;
      visited.add(cur);
      const row = this.db.connection
        .prepare("SELECT parent_id FROM projecao_biblioteca_pastas WHERE pasta_id = ? LIMIT 1;")
        .get(cur) as { parent_id: string | null } | undefined;
      cur = row?.parent_id ?? null;
    }
    return false;
  }

  private cascadeSubtreePaths(pastaId: string, caminhoCompleto: string, nivel: number, agora: string): void {
    this.db.connection
      .prepare("UPDATE projecao_arquivos SET folder_path = ? WHERE pasta_id = ?;")
      .run(caminhoCompleto, pastaId);

    const children = this.db.connection
      .prepare("SELECT pasta_id, nome FROM projecao_biblioteca_pastas WHERE parent_id = ?;")
      .all(pastaId) as Array<{ pasta_id: string; nome: string }>;

    for (const child of children) {
      const childPath = `${caminhoCompleto}/${child.nome}`;
      const childLevel = nivel + 1;
      this.db.connection
        .prepare(
          "UPDATE projecao_biblioteca_pastas SET caminho_completo = ?, nivel = ?, atualizado_em = ? WHERE pasta_id = ?;",
        )
        .run(childPath, childLevel, agora, child.pasta_id);
      this.cascadeSubtreePaths(child.pasta_id, childPath, childLevel, agora);
    }
  }

  public renameOrMoveFolder(
    pastaId: string,
    patch: { nome?: string; parentId?: string | null },
  ): BibliotecaPasta {
    const target = this.getFolderById(pastaId);
    if (!target) {
      throw new Error("Pasta não encontrada.");
    }

    const nextName = patch.nome !== undefined ? validateFolderSegmentName(patch.nome) : target.nome;
    const nextParentId =
      patch.parentId !== undefined ? (patch.parentId?.trim() || null) : target.parent_id;

    const updated = this.db.runInTransaction(() => {
      if (nextParentId === pastaId) {
        throw new Error("Uma pasta não pode ser movida para dentro de si mesma.");
      }
      if (nextParentId && this.isDescendantOf(nextParentId, pastaId)) {
        throw new Error("Movimento bloqueado: não é permitido criar ciclo movendo pasta para uma subpasta sua.");
      }

      let nextLevel = 1;
      let nextPath = nextName;
      if (nextParentId) {
        const parent = this.getFolderById(nextParentId);
        if (!parent) {
          throw new Error("Pasta de destino não encontrada.");
        }
        if (parent.agente_id !== target.agente_id) {
          throw new Error("Não é permitido mover pastas entre agentes diferentes.");
        }
        nextLevel = parent.nivel + 1;
        nextPath = `${parent.caminho_completo}/${nextName}`;
      }

      const subtreeDepth = this.getSubtreeMaxRelativeDepth(pastaId);
      if (nextLevel + subtreeDepth > LIBRARY_FOLDER_LIMITS.maxLevels) {
        throw new Error(
          `Movimento excederia a profundidade máxima de ${LIBRARY_FOLDER_LIMITS.maxLevels} níveis.`,
        );
      }

      const siblingConflict = this.db.connection
        .prepare(
          `SELECT pasta_id FROM projecao_biblioteca_pastas
           WHERE agente_id = ?
             AND COALESCE(parent_id, '') = COALESCE(?, '')
             AND lower(nome) = lower(?)
             AND pasta_id != ?
           LIMIT 1;`,
        )
        .get(target.agente_id, nextParentId, nextName, pastaId) as { pasta_id?: string } | undefined;

      if (siblingConflict?.pasta_id) {
        throw new Error(`Já existe outra pasta chamada '${nextName}' neste destino.`);
      }

      const agora = new Date().toISOString();
      this.db.connection
        .prepare(
          `UPDATE projecao_biblioteca_pastas
           SET nome = ?, parent_id = ?, caminho_completo = ?, nivel = ?, atualizado_em = ?
           WHERE pasta_id = ?;`,
        )
        .run(nextName, nextParentId, nextPath, nextLevel, agora, pastaId);

      this.cascadeSubtreePaths(pastaId, nextPath, nextLevel, agora);
      return this.getFolderById(pastaId)!;
    });

    this.emitChanged(target.agente_id);
    return updated;
  }

  private collectSubtreeFolderIds(pastaId: string): string[] {
    const ids = [pastaId];
    const children = this.db.connection
      .prepare("SELECT pasta_id FROM projecao_biblioteca_pastas WHERE parent_id = ?;")
      .all(pastaId) as Array<{ pasta_id: string }>;
    for (const ch of children) {
      ids.push(...this.collectSubtreeFolderIds(ch.pasta_id));
    }
    return ids;
  }

  /**
   * Remove pasta e suas subpastas desvinculando arquivos para a raiz ("Sem pasta") sem apagar arquivos do disco.
   */
  public deleteFolder(pastaId: string): { deletedIds: string[] } {
    const target = this.getFolderById(pastaId);
    if (!target) {
      throw new Error("Pasta não encontrada.");
    }

    const subtreeIds = this.collectSubtreeFolderIds(pastaId);
    this.db.runInTransaction(() => {
      const unlinkStmt = this.db.connection.prepare(
        "UPDATE projecao_arquivos SET pasta_id = NULL, folder_path = NULL WHERE pasta_id = ?;",
      );
      for (const id of subtreeIds) {
        unlinkStmt.run(id);
      }
      this.db.connection
        .prepare("DELETE FROM projecao_biblioteca_pastas WHERE pasta_id = ?;")
        .run(pastaId);
    });

    this.emitChanged(target.agente_id);
    return { deletedIds: subtreeIds };
  }

  public moveFilesToFolder(arquivoIds: string[], pastaId: string | null): { moved: number } {
    if (arquivoIds.length === 0) return { moved: 0 };

    let targetFolder: BibliotecaPasta | null = null;
    if (pastaId) {
      targetFolder = this.getFolderById(pastaId);
      if (!targetFolder) {
        throw new Error("Pasta de destino não encontrada.");
      }
    }

    let moved = 0;
    this.db.runInTransaction(() => {
      const stmt = this.db.connection.prepare(
        "UPDATE projecao_arquivos SET pasta_id = ?, folder_path = ? WHERE arquivo_id = ?;",
      );
      for (const id of arquivoIds) {
        const info = stmt.run(
          targetFolder ? targetFolder.pasta_id : null,
          targetFolder ? targetFolder.caminho_completo : null,
          id,
        );
        if (Number(info.changes) > 0) moved += 1;
      }
    });

    this.emitChanged(targetFolder?.agente_id);
    return { moved };
  }

  public listLibraryFoldersForAgent(
    agenteId: string,
    folderFilter?: string,
  ): {
    folders: BibliotecaPasta[];
    files: Array<Pick<ArquivoStudio, "arquivo_id" | "nome_original" | "caminho_relativo" | "mime_type" | "pasta_id" | "folder_path" | "criado_em">>;
    unfiledCount: number;
  } {
    const folders = (
      this.db.connection
        .prepare(
          `SELECT * FROM projecao_biblioteca_pastas
           WHERE agente_id = ?
           ORDER BY nivel ASC, caminho_completo COLLATE NOCASE ASC;`,
        )
        .all(agenteId) as unknown as PastaRow[]
    ).map((r) => this.mapRow(r));

    const unfiledRow = this.db.connection
      .prepare(
        "SELECT COUNT(*) AS total FROM projecao_arquivos WHERE agente_id = ? AND pasta_id IS NULL;",
      )
      .get(agenteId) as { total: number };

    let filesQuery = `
      SELECT arquivo_id, nome_original, caminho_relativo, mime_type, pasta_id, folder_path, criado_em
      FROM projecao_arquivos
      WHERE agente_id = ?
    `;
    const qParams: Array<string | number> = [agenteId];

    if (folderFilter && folderFilter.trim()) {
      const clean = folderFilter.trim();
      filesQuery += " AND (lower(folder_path) = lower(?) OR pasta_id = ?)";
      qParams.push(clean, clean);
    }

    filesQuery += " ORDER BY criado_em DESC LIMIT ?;";
    qParams.push(LIBRARY_FOLDER_LIMITS.maxFilesPerFolderList);

    const files = this.db.connection.prepare(filesQuery).all(...qParams) as Array<
      Pick<
        ArquivoStudio,
        | "arquivo_id"
        | "nome_original"
        | "caminho_relativo"
        | "mime_type"
        | "pasta_id"
        | "folder_path"
        | "criado_em"
      >
    >;

    return {
      folders,
      files,
      unfiledCount: unfiledRow.total,
    };
  }

  /**
   * Valida e indexa arquivos locais dentro de `recursos/`, `conteudos/`, `saidas/` ou `previas/`
   * impedindo path traversal fora do `workspaceRoot`.
   */
  public resolveSafeWorkspaceFiles(
    paths: string[],
    opts: { agenteId: string; tarefaId?: string | null; folderPath?: string | null },
  ): ArquivoStudio[] {
    if (paths.length > 20) {
      throw new Error("Máximo de 20 arquivos por chamada em attach_files_to_response.");
    }

    const folderObj = opts.folderPath?.trim()
      ? this.ensureFolderPath(opts.agenteId, opts.folderPath.trim())
      : null;

    const resolvedItems: ArquivoStudio[] = [];

    for (const rawPath of paths) {
      const cleanRaw = rawPath.trim();
      if (!cleanRaw || cleanRaw.includes("\0")) {
        throw new Error("Caminho de arquivo vazio ou inválido.");
      }

      const absCandidate = isAbsolute(cleanRaw)
        ? resolve(cleanRaw)
        : resolve(this.workspaceRoot, cleanRaw);

      const rel = relative(this.workspaceRoot, absCandidate).replace(/\\/g, "/");
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error(`Caminho bloqueado fora do workspace permitido: '${cleanRaw}'.`);
      }

      const topSegment = rel.split("/")[0]?.toLowerCase() ?? "";
      if (!ALLOWED_WORKSPACE_ROOT_PREFIXES.includes(topSegment)) {
        throw new Error(
          `Apenas arquivos em recursos/, conteudos/, saidas/ ou previas/ podem ser anexados ('${rel}').`,
        );
      }

      if (!existsSync(absCandidate)) {
        throw new Error(`Arquivo não encontrado no workspace: '${rel}'.`);
      }
      const st = statSync(absCandidate);
      if (!st.isFile()) {
        throw new Error(`O caminho '${rel}' não é um arquivo regular.`);
      }

      const ext = extname(absCandidate).toLowerCase();
      const mime = EXT_TO_MIME[ext] ?? "application/octet-stream";
      const nomeOriginal = basename(absCandidate);
      const url = `/api/arquivos/raw/${encodeURIComponent(rel)}`;
      const agora = new Date().toISOString();

      let existing = this.db.connection
        .prepare("SELECT * FROM projecao_arquivos WHERE caminho_relativo = ? LIMIT 1;")
        .get(rel) as ArquivoStudio | undefined;

      if (existing) {
        if (folderObj) {
          this.db.connection
            .prepare("UPDATE projecao_arquivos SET pasta_id = ?, folder_path = ? WHERE arquivo_id = ?;")
            .run(folderObj.pasta_id, folderObj.caminho_completo, existing.arquivo_id);
          existing = {
            ...existing,
            pasta_id: folderObj.pasta_id,
            folder_path: folderObj.caminho_completo,
          };
        }
        resolvedItems.push(existing);
      } else {
        const arquivoId = `arq-${randomUUID().slice(0, 10)}`;
        const tipoUso: ArquivoStudio["tipo_uso"] = mime.startsWith("video/")
          ? "video"
          : topSegment === "saidas" || topSegment === "previas"
            ? "gerado"
            : "documento";

        this.db.connection
          .prepare(
            `INSERT INTO projecao_arquivos (
              arquivo_id, nome_original, caminho_relativo, url, mime_type,
              tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em, pasta_id, folder_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          )
          .run(
            arquivoId,
            nomeOriginal,
            rel,
            url,
            mime,
            st.size,
            tipoUso,
            opts.agenteId,
            opts.tarefaId ?? null,
            agora,
            folderObj?.pasta_id ?? null,
            folderObj?.caminho_completo ?? null,
          );

        resolvedItems.push({
          arquivo_id: arquivoId,
          nome_original: nomeOriginal,
          caminho_relativo: rel,
          url,
          mime_type: mime,
          tamanho_bytes: st.size,
          tipo_uso: tipoUso,
          agente_id: opts.agenteId,
          tarefa_id: opts.tarefaId ?? null,
          pasta_id: folderObj?.pasta_id ?? null,
          folder_path: folderObj?.caminho_completo ?? null,
          criado_em: agora,
        });
      }
    }

    if (folderObj) {
      this.emitChanged(opts.agenteId);
    }
    return resolvedItems;
  }
}
