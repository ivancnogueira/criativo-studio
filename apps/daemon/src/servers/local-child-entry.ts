import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDaemonServer } from "../server/daemon-server.ts";

export const LOCAL_SERVER_READY_PREFIX = "CRIATIVO_LOCAL_SERVER_READY ";

function ensureChildWorkspaceScaffold(childRootDir: string): void {
  const dirs = [
    "dados",
    "conteudos",
    "conteudos/relatorios",
    "recursos/brand",
    "recursos/fotos",
    "recursos/logos",
    "recursos/referencias",
    "recursos/uploads",
    "saidas/artes",
    "saidas/carrosseis",
    "saidas/posts-individuais",
    "saidas/stories",
    "previas",
    "logs",
  ];
  for (const rel of dirs) {
    mkdirSync(join(childRootDir, rel), { recursive: true });
  }

  const perfilPath = join(childRootDir, "conteudos", "perfil-da-marca.md");
  if (!existsSync(perfilPath)) {
    writeFileSync(
      perfilPath,
      "# Perfil da Marca\n\n- **Nome Comercial:** [NOME_DA_MARCA]\n- **Instagram Handle:** [@SEU_PERFIL]\n- **Segmento / Nicho:** [A PREENCHER]\n",
      "utf8",
    );
  }
}

async function bootLocalChild(): Promise<void> {
  const serverId = process.env.CRIATIVO_CHILD_SERVER_ID || `srv-${Date.now()}`;
  const childRoot = process.env.CRIATIVO_CHILD_ROOT_DIR;
  if (!childRoot) {
    throw new Error("CRIATIVO_CHILD_ROOT_DIR obrigatório para servidor filho local.");
  }

  const resolvedRoot = resolve(childRoot);
  ensureChildWorkspaceScaffold(resolvedRoot);

  const accessToken = process.env.CRIATIVO_SERVER_ACCESS_TOKEN || "";
  const sharedAuthDir = process.env.CRIATIVO_SHARED_AUTH_DIR || null;
  const vaultMasterKey = process.env.CRIATIVO_VAULT_KEY;

  // Limpa o token do ambiente após leitura antes que agentes ou subprocessos iniciem
  delete process.env.CRIATIVO_SERVER_ACCESS_TOKEN;

  const runtime = await createDaemonServer({
    port: 0,
    host: "127.0.0.1",
    dbPath: join(resolvedRoot, "dados", "criativo.db"),
    workspaceRoot: resolvedRoot,
    vaultMasterKey,
    accessToken,
    isChildServer: true,
    sharedAuthDir,
    autoStartLoops: process.env.CRIATIVO_CHILD_AUTO_LOOPS === "1",
    autoBootWhatsApp: false,
    controlSocketPath: null,
    bypassLicenseForTests: process.env.CRIATIVO_CHILD_BYPASS_LICENSE === "1",
    enforceLicense: process.env.CRIATIVO_CHILD_ENFORCE_LICENSE === "1",
    licenseHubUrl: process.env.CRIATIVO_LICENSE_HUB_URL,
    licensePublicKeyPem: process.env.CRIATIVO_LICENSE_PUBLIC_KEY_PEM,
  });

  // Copia chaves compartilhadas de provedores de IA (se fornecidas apenas via startup JSON seguro)
  const sharedAiRaw = process.env.CRIATIVO_CHILD_SHARED_AI_KEYS;
  delete process.env.CRIATIVO_CHILD_SHARED_AI_KEYS;
  if (sharedAiRaw) {
    try {
      const pairs = JSON.parse(sharedAiRaw) as Record<string, string>;
      for (const [k, v] of Object.entries(pairs)) {
        if (typeof v === "string" && v && !runtime.vault.getSecret(k)) {
          runtime.vault.setSecret(k, v);
        }
      }
    } catch {
      // ignora payload inválido
    }
  }

  const readyPayload = {
    serverId,
    port: runtime.port,
    baseUrl: `http://127.0.0.1:${runtime.port}`,
  };
  process.stdout.write(`${LOCAL_SERVER_READY_PREFIX}${JSON.stringify(readyPayload)}\n`);

  const shutdown = async () => {
    try {
      await runtime.close();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  if (process.stdin && !process.stdin.destroyed) {
    process.stdin.resume();
    process.stdin.on("end", () => void shutdown());
    process.stdin.on("close", () => void shutdown());
  }
}

const isEntryPoint =
  Boolean(process.argv[1]) &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]) &&
  /local-child-entry\.(ts|js)$/i.test(process.argv[1]);

if (isEntryPoint) {
  bootLocalChild().catch((err) => {
    console.error("[Criativo Local Child] Falha fatal:", err);
    process.exit(1);
  });
}
