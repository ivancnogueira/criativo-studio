import type {
  AgentStepEvent,
  AgentTurnContext,
  AgentTurnResult,
  AIProviderClient,
  ProviderName,
  ToolDefinition,
} from "@criativo/contracts";
import type { VaultService } from "../../vault/vault-service.ts";

export type FetchLike = typeof fetch;

export interface ProviderAdapterOptions {
  vault: VaultService;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  defaultModel?: string;
}

export type {
  AgentStepEvent,
  AgentTurnContext,
  AgentTurnResult,
  AIProviderClient,
  ProviderName,
  ToolDefinition,
};

/**
 * Mascara qualquer token ou chave antes de gravar logs ou emitir mensagens de erro.
 */
export function sanitizeProviderError(message: string, secrets: Array<string | null | undefined>): string {
  let clean = message;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) {
      clean = clean.split(secret).join("[CHAVE_OCULTA]");
    }
  }
  return clean;
}

export function resolveVaultKeyOrThrow(
  vault: VaultService,
  keyNames: string[],
  providerLabel: string
): string {
  for (const keyName of keyNames) {
    const val = vault.getSecret(keyName);
    if (val && val.trim().length > 0) {
      return val.trim();
    }
  }
  throw new Error(
    `Chave de API ausente no Cofre para ${providerLabel}. Configure uma das chaves: ${keyNames.join(", ")}.`
  );
}
