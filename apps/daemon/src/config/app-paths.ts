import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Diretórios e arquivos pertencentes exclusivamente aos dados da instância do usuário,
 * que nunca devem ser sobrescritos durante atualizações do aplicativo desktop ou VPS.
 */
export const DADOS_DA_INSTANCIA_ITEMS = [
  ".env",
  "dados",
  "conteudos",
  "recursos",
  "saidas",
  "previas",
  "logs",
  "servidores",
  "updates",
] as const;

export interface StudioResolvedPaths {
  productRoot: string;
  userDataRoot: string;
  dbPath: string;
  envPath: string;
  webDistDir: string;
  templatesDir: string;
  nativeSkillsDir: string;
  servidoresDir: string;
  updatesDir: string;
  isPackaged: boolean;
  separatedRoots: boolean;
}

export interface StudioPathsBootstrapResult {
  createdDirs: string[];
  createdFiles: string[];
  createdEnv: boolean;
}

function hasProductMarkers(dir: string): boolean {
  return (
    existsSync(join(dir, "produto.json")) ||
    existsSync(join(dir, "templates", "marca")) ||
    (existsSync(join(dir, ".agents", "skills")) && existsSync(join(dir, "apps", "daemon"))) ||
    existsSync(join(dir, "apps", "web", "dist", "index.html"))
  );
}

/**
 * Resolve o diretório padrão multi-plataforma para armazenar dados graváveis do usuário
 * quando o app roda em modo desktop empacotado (`AppData` / `Application Support` / `.config`).
 */
export function resolveDefaultUserDataDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  if (platform === "win32") {
    const base = env.APPDATA || join(home, "AppData", "Roaming");
    return resolve(base, "CriativoAIStudio");
  }
  if (platform === "darwin") {
    return resolve(home, "Library", "Application Support", "CriativoAIStudio");
  }
  const xdgConfig = env.XDG_CONFIG_HOME || join(home, ".config");
  return resolve(xdgConfig, "CriativoAIStudio");
}

/**
 * Resolve a raiz somente-leitura dos artefatos do produto (`apps/web/dist`, `templates`, `.agents/skills`, `produto.json`).
 */
export function resolveProductRoot(explicitProductRoot?: string, env: NodeJS.ProcessEnv = process.env): string {
  if (explicitProductRoot && explicitProductRoot.trim().length > 0) {
    return resolve(explicitProductRoot);
  }
  if (env.CRIATIVO_PRODUCT_ROOT && env.CRIATIVO_PRODUCT_ROOT.trim().length > 0) {
    return resolve(env.CRIATIVO_PRODUCT_ROOT);
  }

  let cursor = resolve(process.cwd());
  for (let i = 0; i < 6; i += 1) {
    if (hasProductMarkers(cursor)) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  let modCursor = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (hasProductMarkers(modCursor)) return modCursor;
    const parent = dirname(modCursor);
    if (parent === modCursor) break;
    modCursor = parent;
  }

  return resolve(process.cwd());
}

/**
 * Resolve de forma determinística `productRoot` (binários/templates) e `userDataRoot` (dados da instância),
 * mantendo compatibilidade total com execuções em modo dev/testes.
 */
export function resolveStudioPaths(options?: {
  workspaceRoot?: string;
  productRoot?: string;
  dbPath?: string;
  env?: NodeJS.ProcessEnv;
  isPackaged?: boolean;
  platform?: NodeJS.Platform;
  home?: string;
}): StudioResolvedPaths {
  const env = options?.env ?? process.env;
  const productRoot = resolveProductRoot(options?.productRoot, env);
  const envPackaged = options?.isPackaged ?? env.CRIATIVO_PACKAGED === "1";

  let userDataRoot: string;
  if (options?.workspaceRoot && options.workspaceRoot.trim().length > 0) {
    userDataRoot = resolve(options.workspaceRoot);
  } else if (env.CRIATIVO_USER_DATA_DIR && env.CRIATIVO_USER_DATA_DIR.trim().length > 0) {
    userDataRoot = resolve(env.CRIATIVO_USER_DATA_DIR);
  } else if (envPackaged) {
    userDataRoot = resolveDefaultUserDataDir(options?.platform, env, options?.home);
  } else {
    userDataRoot = productRoot;
  }

  const separatedRoots = resolve(userDataRoot) !== resolve(productRoot);

  let dbPath: string;
  if (options?.dbPath && options.dbPath.trim().length > 0) {
    dbPath = resolve(options.dbPath);
  } else if (separatedRoots || envPackaged) {
    dbPath = join(userDataRoot, "dados", "criativo.db");
  } else if (existsSync(join(userDataRoot, "apps", "daemon"))) {
    dbPath = join(userDataRoot, "apps", "daemon", "dados", "criativo.db");
  } else {
    dbPath = join(userDataRoot, "dados", "criativo.db");
  }

  const webDistCandidates = [
    join(productRoot, "apps", "web", "dist"),
    join(productRoot, "web-dist"),
    join(productRoot, "dist"),
  ];
  const webDistDir =
    webDistCandidates.find((dir) => existsSync(join(dir, "index.html"))) ?? webDistCandidates[0];

  return {
    productRoot,
    userDataRoot,
    dbPath,
    envPath: join(userDataRoot, ".env"),
    webDistDir,
    templatesDir: join(productRoot, "templates", "marca"),
    nativeSkillsDir: join(productRoot, ".agents", "skills"),
    servidoresDir: join(userDataRoot, "servidores"),
    updatesDir: join(userDataRoot, "updates"),
    isPackaged: envPackaged,
    separatedRoots,
  };
}

/**
 * Prepara silenciosamente (sem terminal) o diretório de dados da instância do usuário
 * na primeira execução empacotada, preservando qualquer arquivo já existente.
 */
export function bootstrapUserDataDirectory(paths: StudioResolvedPaths): StudioPathsBootstrapResult {
  const createdDirs: string[] = [];
  const createdFiles: string[] = [];
  let createdEnv = false;

  const instanceDirs = [
    "dados",
    "conteudos",
    "conteudos/relatorios",
    "recursos/brand",
    "recursos/fotos",
    "recursos/logos",
    "recursos/referencias",
    "recursos/referencias/carrosseis",
    "recursos/referencias/individual",
    "recursos/referencias/anuncios",
    "recursos/referencias/stories",
    "recursos/personagens",
    "recursos/uploads",
    "recursos/avatares",
    "saidas/artes",
    "saidas/carrosseis",
    "saidas/posts-individuais",
    "saidas/stories",
    "previas",
    "logs",
    "servidores",
    "updates",
  ];

  for (const rel of instanceDirs) {
    const abs = join(paths.userDataRoot, rel);
    if (!existsSync(abs)) {
      mkdirSync(abs, { recursive: true });
      createdDirs.push(rel);
    }
  }

  const templateMappings: Array<[string, string]> = [
    ["perfil-da-marca.md", "conteudos/perfil-da-marca.md"],
    ["identidade-visual.yml", "conteudos/identidade-visual.yml"],
    ["estado-do-studio.yml", "conteudos/estado-do-studio.yml"],
    ["brandbook.md", "recursos/brand/brandbook.md"],
    ["design-system.md", "recursos/brand/design-system.md"],
    ["tokens.css", "recursos/brand/tokens.css"],
  ];

  for (const [srcFile, dstRel] of templateMappings) {
    const srcAbs = join(paths.templatesDir, srcFile);
    const dstAbs = join(paths.userDataRoot, dstRel);
    if (existsSync(srcAbs) && !existsSync(dstAbs)) {
      mkdirSync(dirname(dstAbs), { recursive: true });
      copyFileSync(srcAbs, dstAbs);
      createdFiles.push(dstRel);
    }
  }

  if (!existsSync(paths.envPath)) {
    const envExamplePath = join(paths.productRoot, ".env.example");
    const baseContent = existsSync(envExamplePath)
      ? readFileSync(envExamplePath, "utf8")
      : "# Criativo AI Studio Online - Configuracao da Instancia\nPORT=3000\n";
    const randomVaultKey = randomBytes(32).toString("hex");
    const finalEnv = /^CRIATIVO_VAULT_KEY=.*$/m.test(baseContent)
      ? baseContent.replace(/^CRIATIVO_VAULT_KEY=.*$/m, `CRIATIVO_VAULT_KEY=${randomVaultKey}`)
      : `${baseContent.trimEnd()}\nCRIATIVO_VAULT_KEY=${randomVaultKey}\n`;

    mkdirSync(dirname(paths.envPath), { recursive: true });
    writeFileSync(paths.envPath, finalEnv, "utf8");
    if (process.platform !== "win32") {
      try {
        chmodSync(paths.envPath, 0o600);
      } catch {
        // ignora sistemas de arquivo sem chmod POSIX
      }
    }
    createdEnv = true;
    createdFiles.push(".env");
  }

  return {
    createdDirs,
    createdFiles,
    createdEnv,
  };
}
