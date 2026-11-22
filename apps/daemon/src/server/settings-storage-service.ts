/**
 * Serviço unificado de Configurações de Usuário (`StudioUserSettings`),
 * Uso Real de Armazenamento (`StorageUsageSnapshot`) e Novidades (`WhatsNewReleaseInfo`) (UX-03 / D-06).
 */
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import {
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type {
  StorageUsageItem,
  StorageUsageSnapshot,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import { VIDEO_EXTS } from "./settings-prefs-service.ts";

export * from "./settings-prefs-service.ts";

interface ScannedFileEntry {
  absPath: string;
  relPath: string;
  nome: string;
  bytes: number;
  mtimeIso: string;
}

function walkDirectorySafe(rootDir: string, currentDir: string, out: ScannedFileEntry[]): void {
  if (!existsSync(currentDir)) return;
  let entries: string[] = [];
  try {
    entries = readdirSync(currentDir);
  } catch {
    return;
  }

  for (const name of entries) {
    if (name === ".gitkeep" || name === ".DS_Store") continue;
    const full = join(currentDir, name);
    let stat;
    try {
      stat = lstatSync(full);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      walkDirectorySafe(rootDir, full, out);
    } else if (stat.isFile()) {
      const rel = relative(rootDir, full).split(sep).join("/");
      if (rel.startsWith("..")) continue;
      out.push({
        absPath: full,
        relPath: rel,
        nome: name,
        bytes: stat.size,
        mtimeIso: stat.mtime.toISOString(),
      });
    }
  }
}

export function computeStorageUsage(
  db: CriativoDatabase,
  workspaceRoot: string,
): StorageUsageSnapshot {
  const safeRoot = resolve(workspaceRoot);

  const uploadsEntries: ScannedFileEntry[] = [];
  walkDirectorySafe(safeRoot, join(safeRoot, "recursos"), uploadsEntries);

  const saidasEntries: ScannedFileEntry[] = [];
  walkDirectorySafe(safeRoot, join(safeRoot, "saidas"), saidasEntries);
  walkDirectorySafe(safeRoot, join(safeRoot, "previas"), saidasEntries);

  const artesEntries: ScannedFileEntry[] = [];
  const videosEntries: ScannedFileEntry[] = [];
  for (const entry of saidasEntries) {
    const ext = extname(entry.nome).toLowerCase();
    if (entry.relPath.startsWith("saidas/videos/") || VIDEO_EXTS.has(ext)) {
      videosEntries.push(entry);
    } else {
      artesEntries.push(entry);
    }
  }

  const browserEntries: ScannedFileEntry[] = [];
  walkDirectorySafe(safeRoot, join(safeRoot, "dados", "browser-profiles"), browserEntries);

  let dbBytes = 0;
  let dbFilesCount = 0;
  if (db.dbPath && db.dbPath !== ":memory:") {
    for (const suffix of ["", "-wal", "-shm"]) {
      const candidate = `${db.dbPath}${suffix}`;
      if (existsSync(candidate)) {
        try {
          const st = statSync(candidate);
          if (st.isFile()) {
            dbBytes += st.size;
            dbFilesCount += 1;
          }
        } catch {
          // ignore
        }
      }
    }
  } else {
    // Em banco :memory:, estima páginas SQLite via PRAGMA
    try {
      const pc = db.connection.prepare("PRAGMA page_count").get() as { page_count?: number } | undefined;
      const ps = db.connection.prepare("PRAGMA page_size").get() as { page_size?: number } | undefined;
      dbBytes = Number(pc?.page_count ?? 0) * Number(ps?.page_size ?? 4096);
      dbFilesCount = 1;
    } catch {
      dbBytes = 0;
    }
  }

  const sumBytes = (list: ScannedFileEntry[]) => list.reduce((acc, item) => acc + item.bytes, 0);

  const categorias: StorageUsageItem[] = [
    {
      categoria: "uploads",
      rotulo: "Uploads & Referências",
      cor_hex: "#42A0FF",
      bytes: sumBytes(uploadsEntries),
      arquivos_count: uploadsEntries.length,
    },
    {
      categoria: "artes_geradas",
      rotulo: "Artes & Prévias",
      cor_hex: "#10B981",
      bytes: sumBytes(artesEntries),
      arquivos_count: artesEntries.length,
    },
    {
      categoria: "videos",
      rotulo: "Vídeos & Reels",
      cor_hex: "#A855F7",
      bytes: sumBytes(videosEntries),
      arquivos_count: videosEntries.length,
    },
    {
      categoria: "perfis_navegador",
      rotulo: "Perfis de Navegador",
      cor_hex: "#F59E0B",
      bytes: sumBytes(browserEntries),
      arquivos_count: browserEntries.length,
    },
    {
      categoria: "banco_dados",
      rotulo: "Banco de Dados SQLite",
      cor_hex: "#64748B",
      bytes: dbBytes,
      arquivos_count: dbFilesCount,
    },
  ];

  // Mapeia arquivos registrados no SQLite para vincular arquivo_id e agente_id
  const dbFiles = db.connection
    .prepare(
      "SELECT arquivo_id, nome_original, caminho_relativo, tamanho_bytes, agente_id, criado_em FROM projecao_arquivos",
    )
    .all() as Array<{
    arquivo_id: string;
    nome_original: string;
    caminho_relativo: string;
    tamanho_bytes: number;
    agente_id: string | null;
    criado_em: string;
  }>;

  const byRelPath = new Map<
    string,
    { arquivo_id: string; nome_original: string; agente_id: string | null; criado_em: string }
  >();
  const porAgente: Record<string, number> = {};

  for (const row of dbFiles) {
    const normalizedRel = row.caminho_relativo.replace(/\\/g, "/").replace(/^\/+/, "");
    byRelPath.set(normalizedRel, {
      arquivo_id: row.arquivo_id,
      nome_original: row.nome_original,
      agente_id: row.agente_id,
      criado_em: row.criado_em,
    });
    if (row.agente_id) {
      porAgente[row.agente_id] = (porAgente[row.agente_id] ?? 0) + Number(row.tamanho_bytes ?? 0);
    }
  }

  const userDeletableCandidates = [...uploadsEntries, ...artesEntries, ...videosEntries];
  userDeletableCandidates.sort((a, b) => b.bytes - a.bytes);

  const topFiles = userDeletableCandidates.slice(0, 25).map((entry) => {
    const meta = byRelPath.get(entry.relPath);
    return {
      arquivo_id: meta?.arquivo_id ?? `path:${entry.relPath}`,
      nome: meta?.nome_original ?? entry.nome,
      caminho_relativo: entry.relPath,
      bytes: entry.bytes,
      agente_id: meta?.agente_id ?? null,
      criado_em: meta?.criado_em ?? entry.mtimeIso,
    };
  });

  const totalBytes = categorias.reduce((acc, item) => acc + item.bytes, 0);

  return {
    totalBytes,
    categorias,
    topFiles,
    porAgente,
    atualizado_em: new Date().toISOString(),
  };
}

export function clearStorageCategory(
  _db: CriativoDatabase,
  workspaceRoot: string,
  category: "browser_cache" | "temp_previews",
): { ok: boolean; category: string; freedBytes: number; removedCount: number } {
  const safeRoot = resolve(workspaceRoot);
  let freedBytes = 0;
  let removedCount = 0;

  if (category === "temp_previews") {
    const previasDir = join(safeRoot, "previas");
    const entries: ScannedFileEntry[] = [];
    walkDirectorySafe(safeRoot, previasDir, entries);
    for (const entry of entries) {
      const rel = relative(previasDir, entry.absPath);
      if (rel.startsWith("..")) continue;
      try {
        unlinkSync(entry.absPath);
        freedBytes += entry.bytes;
        removedCount += 1;
      } catch {
        // ignore locked files
      }
    }
    return { ok: true, category, freedBytes, removedCount };
  }

  if (category === "browser_cache") {
    const profilesRoot = join(safeRoot, "dados", "browser-profiles");
    if (!existsSync(profilesRoot)) {
      return { ok: true, category, freedBytes: 0, removedCount: 0 };
    }
    const cacheDirNames = ["Cache", "Code Cache", "GPUCache", "GrShaderCache", "ShaderCache"];
    for (const profileDirName of readdirSync(profilesRoot)) {
      const profileDir = join(profilesRoot, profileDirName);
      let st;
      try {
        st = lstatSync(profileDir);
      } catch {
        continue;
      }
      if (!st.isDirectory() || st.isSymbolicLink()) continue;

      const candidates = [
        ...cacheDirNames.map((c) => join(profileDir, c)),
        ...cacheDirNames.map((c) => join(profileDir, "Default", c)),
      ];
      for (const cacheDir of candidates) {
        if (!existsSync(cacheDir)) continue;
        const rel = relative(profilesRoot, cacheDir);
        if (rel.startsWith("..")) continue;
        const files: ScannedFileEntry[] = [];
        walkDirectorySafe(safeRoot, cacheDir, files);
        for (const f of files) {
          freedBytes += f.bytes;
          removedCount += 1;
        }
        try {
          rmSync(cacheDir, { recursive: true, force: true });
        } catch {
          // ignore em uso
        }
      }
    }
    return { ok: true, category, freedBytes, removedCount };
  }

  throw new Error(`Categoria de limpeza inválida: ${String(category)}`);
}

export function deleteStorageFile(
  db: CriativoDatabase,
  workspaceRoot: string,
  arquivoId: string,
): { ok: boolean; arquivoId: string; freedBytes: number } {
  const safeRoot = resolve(workspaceRoot);
  const allowedRoots = [
    resolve(safeRoot, "recursos"),
    resolve(safeRoot, "saidas"),
    resolve(safeRoot, "previas"),
  ];

  let relPath: string | null = null;
  let dbRecordId: string | null = null;

  const row = db.connection
    .prepare("SELECT arquivo_id, caminho_relativo FROM projecao_arquivos WHERE arquivo_id = ?")
    .get(arquivoId) as { arquivo_id: string; caminho_relativo: string } | undefined;

  if (row) {
    dbRecordId = row.arquivo_id;
    relPath = row.caminho_relativo;
  } else if (arquivoId.startsWith("path:")) {
    relPath = arquivoId.slice("path:".length);
  }

  if (!relPath) {
    throw new Error("Arquivo não encontrado para exclusão.");
  }

  const targetAbs = resolve(safeRoot, relPath);
  const insideAllowed = allowedRoots.some((allowed) => {
    const rel = relative(allowed, targetAbs);
    return rel !== "" && !rel.startsWith("..") && !rel.includes(`..${sep}`);
  });

  if (!insideAllowed) {
    throw new Error("Caminho fora dos diretórios permitidos para exclusão de armazenamento.");
  }

  let freedBytes = 0;
  if (existsSync(targetAbs)) {
    const lst = lstatSync(targetAbs);
    if (lst.isSymbolicLink() || !lst.isFile()) {
      throw new Error("Apenas arquivos regulares podem ser excluídos.");
    }
    freedBytes = lst.size;
    unlinkSync(targetAbs);
  }

  if (dbRecordId) {
    db.connection.prepare("DELETE FROM projecao_arquivos WHERE arquivo_id = ?").run(dbRecordId);
  } else {
    const normalizedRel = relative(safeRoot, targetAbs).split(sep).join("/");
    db.connection
      .prepare("DELETE FROM projecao_arquivos WHERE caminho_relativo = ?")
      .run(normalizedRel);
  }

  return { ok: true, arquivoId, freedBytes };
}

