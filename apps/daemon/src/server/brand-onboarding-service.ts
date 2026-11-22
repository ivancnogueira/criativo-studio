import type {
  OnboardingEstado,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import type {
  ProviderConnectionService,
} from "../providers/provider-connection-service.ts";
import {
  type LicenseClientService,
} from "../license/license-service.ts";
import {
  isUpgradeUnlocked,
} from "./studio-tools-bridge.ts";
import { getBrandIdentity } from "./brand-identity-service.ts";
import { isPlaceholderField } from "./brand-upgrade-and-pdf.ts";

export * from "./brand-identity-service.ts";
export * from "./brand-upgrade-and-pdf.ts";

export function computeUnlockedAgentsSummary(
  db: CriativoDatabase,
  workspaceRoot: string,
  licenseService?: LicenseClientService
): {
  unlocked_agents_count: number;
  total_permanent_agents: number;
  base_count: number;
  custom_count: number;
} {
  const rows = db.connection
    .prepare(`SELECT agente_id, config_json FROM projecao_agentes;`)
    .all() as Array<{ agente_id: string; config_json: string }>;

  let unlocked = 0;
  let totalPermanent = 0;
  let baseCount = 0;
  let customCount = 0;

  for (const row of rows) {
    if (row.agente_id === "assistente_setup" || row.agente_id === "assistente_servidor_vps") continue;
    totalPermanent += 1;
    let cfg: Record<string, unknown> = {};
    try {
      cfg = JSON.parse(row.config_json || "{}") as Record<string, unknown>;
    } catch {
      cfg = {};
    }
    const pacote =
      cfg.pacote === "bonus" || cfg.pacote === "video" ? cfg.pacote : "base";
    const isUnlocked = isUpgradeUnlocked(db, workspaceRoot, pacote, licenseService);
    if (isUnlocked) {
      unlocked += 1;
      if (cfg.frente === "custom" || cfg.customizado === true) {
        customCount += 1;
      } else if (pacote === "base") {
        baseCount += 1;
      }
    }
  }

  return {
    unlocked_agents_count: unlocked,
    total_permanent_agents: totalPermanent,
    base_count: baseCount,
    custom_count: customCount,
  };
}

export function isSetupAssistantVisible(
  db: CriativoDatabase,
  providerConnection: ProviderConnectionService
): boolean {
  const onboarding = providerConnection.getOnboardingState();
  if (onboarding.setup_assistant_dismissed === true) {
    return false;
  }
  const reopenedRow = db.connection
    .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'setup_assistant_reopened';`)
    .get() as { valor_json: string } | undefined;
  const reopened = reopenedRow ? reopenedRow.valor_json === "true" : false;
  return Boolean(onboarding.onboarding_concluido || reopened);
}

export function setSetupAssistantState(
  db: CriativoDatabase,
  providerConnection: ProviderConnectionService,
  workspaceRoot: string,
  action: "dismiss" | "reopen"
): { onboarding: OnboardingEstado; setup_assistant_visible: boolean } {
  if (action === "dismiss") {
    providerConnection.setStudioConfig("setup_assistant_reopened", false);
    const updated = providerConnection.updateOnboardingState({
      setup_assistant_dismissed: true,
    });
    return { onboarding: updated, setup_assistant_visible: false };
  }

  providerConnection.setStudioConfig("setup_assistant_reopened", true);
  const updated = providerConnection.updateOnboardingState({
    setup_assistant_dismissed: false,
  });
  const synced = evaluateAndSyncSetupCompletion(db, providerConnection, workspaceRoot);
  return {
    onboarding: synced.onboarding.setup_assistant_dismissed ? updated : synced.onboarding,
    setup_assistant_visible: true,
  };
}

export function evaluateAndSyncSetupCompletion(
  db: CriativoDatabase,
  providerConnection: ProviderConnectionService,
  workspaceRoot: string
): {
  onboarding: OnboardingEstado;
  pendencias_setup: string[];
  setup_assistant_visible: boolean;
} {
  const onboarding = providerConnection.getOnboardingState();
  const identidade = getBrandIdentity(providerConnection);
  const pendencias: string[] = [];

  if (isPlaceholderField(identidade.marca_nome) || isPlaceholderField(identidade.nicho)) {
    pendencias.push("perfil_marca");
  }

  let filesCount = 0;
  try {
    const row = db.connection
      .prepare(`SELECT COUNT(*) AS total FROM projecao_arquivos;`)
      .get() as { total: number } | undefined;
    filesCount = Number(row?.total ?? 0);
  } catch {
    filesCount = 0;
  }
  if (filesCount === 0 && onboarding.marcos?.identidade_visual !== "concluido") {
    pendencias.push("ativos_marca");
  }

  const metaTokenRow = db.connection
    .prepare(
      `SELECT COUNT(*) AS total FROM cofre_segredos WHERE chave_nome IN ('instagram_access_token', 'META_ACCESS_TOKEN', 'IG_ACCESS_TOKEN');`
    )
    .get() as { total: number } | undefined;
  const igNativeRow = db.connection
    .prepare(
      `SELECT COUNT(*) AS total FROM projecao_apps_nativos_contas WHERE app_slug = 'instagram';`
    )
    .get() as { total: number } | undefined;
  const hasInstagram =
    Number(metaTokenRow?.total ?? 0) > 0 || Number(igNativeRow?.total ?? 0) > 0;
  if (!hasInstagram) {
    pendencias.push("instagram_meta");
  }

  const reopened = providerConnection.getStudioConfig<boolean>("setup_assistant_reopened", false);
  const essentialComplete =
    onboarding.marcos?.perfil === "concluido" &&
    onboarding.marcos?.identidade_visual === "concluido" &&
    !pendencias.includes("perfil_marca") &&
    !pendencias.includes("ativos_marca");

  const nextDismissed =
    onboarding.setup_assistant_dismissed === true
      ? true
      : !reopened && onboarding.onboarding_concluido && essentialComplete && pendencias.length === 0;

  const updated = providerConnection.updateOnboardingState({
    pendencias_setup: pendencias,
    setup_assistant_dismissed: nextDismissed,
  });

  // Garante existência da pasta de ficha institucional no workspace se houver arquivos futuros
  void workspaceRoot;

  return {
    onboarding: updated,
    pendencias_setup: pendencias,
    setup_assistant_visible: isSetupAssistantVisible(db, providerConnection),
  };
}

export const VPS_ASSISTANT_VISIBLE_CONFIG_KEY = "vps_assistant_visible";

export function isVpsAssistantVisible(db: CriativoDatabase): boolean {
  try {
    const row = db.connection
      .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = ? LIMIT 1;`)
      .get(VPS_ASSISTANT_VISIBLE_CONFIG_KEY) as { valor_json?: string } | undefined;
    return row?.valor_json === "true";
  } catch {
    return false;
  }
}

export function setVpsAssistantState(
  db: CriativoDatabase,
  providerConnection: ProviderConnectionService,
  action: "dismiss" | "reopen"
): { vps_assistant_visible: boolean } {
  const nextVisible = action === "reopen";
  providerConnection.setStudioConfig(VPS_ASSISTANT_VISIBLE_CONFIG_KEY, nextVisible);
  void db;
  return { vps_assistant_visible: nextVisible };
}

