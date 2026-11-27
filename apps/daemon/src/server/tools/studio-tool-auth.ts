import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CriativoDatabase } from "../../database/client.ts";
import type { LicenseClientService } from "../../license/license-service.ts";
import type { CatalogService } from "../../marketplace/catalog-service.ts";
import { NativeAppConnectionsStore } from "../../marketplace/native-app-connections-store.ts";
import type { VaultService } from "../../vault/vault-service.ts";
export const INSTAGRAM_TOOL_NAMES = new Set([
  "validar_integracao_meta",
  "consultar_metricas_meta",
  "meta_publicar",
]);

export const WHATSAPP_TOOL_NAMES = new Set([
  "messaging_list_places",
  "messaging_history",
  "messaging_post",
  "messaging_remember",
  "messaging_forget_memory",
]);

export const VIDEO_UPGRADE_TOOL_NAMES = new Set([
  "exec_remotion_render",
  "video_inspect_and_silences",
  "video_transcribe_words",
  "exec_ffmpeg_edit",
]);

export function resolveNativeAppConnectionsStore(deps: {
  db: CriativoDatabase;
  vault?: VaultService;
  nativeStore?: NativeAppConnectionsStore;
  catalogService?: CatalogService;
}): NativeAppConnectionsStore | null {
  if (deps.nativeStore) return deps.nativeStore;
  if (deps.catalogService?.nativeStore) return deps.catalogService.nativeStore;
  if (deps.vault) {
    return new NativeAppConnectionsStore({ db: deps.db, vault: deps.vault });
  }
  return null;
}

export function isAgentAuthorizedForStudioTool(
  toolName: string,
  agenteId: string | null | undefined,
  deps: {
    db: CriativoDatabase;
    vault?: VaultService;
    nativeStore?: NativeAppConnectionsStore;
    catalogService?: CatalogService;
    licenseService?: LicenseClientService;
    workspaceRoot?: string;
    productRoot?: string;
  }
): boolean {
  if (VIDEO_UPGRADE_TOOL_NAMES.has(toolName)) {
    if (
      !isUpgradeUnlocked(
        deps.db,
        deps.workspaceRoot ?? process.cwd(),
        "video",
        deps.licenseService,
        deps.productRoot
      )
    ) {
      return false;
    }
  }
  const store = resolveNativeAppConnectionsStore(deps);
  if (!store) return true;
  if (INSTAGRAM_TOOL_NAMES.has(toolName)) {
    return store.isAgentAuthorizedForNativeApp("instagram", agenteId);
  }
  if (WHATSAPP_TOOL_NAMES.has(toolName)) {
    return store.isAgentAuthorizedForNativeApp("whatsapp", agenteId);
  }
  return true;
}

export const UPGRADE_PACKAGE_SLUGS = {
  bonus: [
    "gerador-de-entregaveis",
    "engenharia-reversa-concorrentes",
    "consistencia-personagem",
  ],
  video: [
    "criar-video-reels",
    "roteirista-faceless",
    "roteirista-talking-head",
  ],
} as const;

/**
 * Verifica se um pacote modular (`base`, `bonus` ou `video`) está desbloqueado na instalação.
 * Quando o licenciamento está ativo (produção ou enforceLicense), exige entitlement assinado Ed25519.
 */
export function isUpgradeUnlocked(
  db: CriativoDatabase,
  workspaceRoot: string,
  pacote: "base" | "bonus" | "video",
  licenseService?: LicenseClientService,
  productRoot?: string,
): boolean {
  if (pacote === "base") return true;

  if (licenseService && !licenseService.isBypassedForTests()) {
    return licenseService.hasSignedUpgradeEntitlement(pacote);
  }

  try {
    const row = db.connection
      .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'upgrades_instalados';`)
      .get() as { valor_json: string } | undefined;
    if (row) {
      const list = JSON.parse(row.valor_json) as unknown;
      if (Array.isArray(list) && list.includes(pacote)) {
        return true;
      }
    }
  } catch {
    // ignora erro de leitura
  }

  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
    return false;
  }

  const required = UPGRADE_PACKAGE_SLUGS[pacote];
  const candidateRoots = [
    resolve(workspaceRoot, ".agents", "skills"),
    productRoot ? resolve(productRoot, ".agents", "skills") : null,
    process.env.CRIATIVO_PRODUCT_ROOT ? resolve(process.env.CRIATIVO_PRODUCT_ROOT, ".agents", "skills") : null,
  ].filter((d): d is string => Boolean(d));

  return candidateRoots.some((skillsDir) =>
    required.some((slug) => existsSync(join(skillsDir, slug, "SKILL.md"))),
  );
}
