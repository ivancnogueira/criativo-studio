import type { ApiKeyMetadata } from "@criativo/contracts";
import type { VaultService } from "./vault-service.ts";

export const API_KEY_NAME_REGEX = /^[A-Z][A-Z0-9_]{0,63}$/;

export type OrigemTurnoApiKey =
  | "usuario_local"
  | "rotina"
  | "webhook"
  | "inter_agente";

export interface SaveApiKeyInput {
  name: string;
  value: string;
  scope: "todos_agentes" | "agente_especifico";
  agenteId?: string | null;
  origemTurno: OrigemTurnoApiKey;
}

export interface SaveApiKeyResult {
  status: "saved";
  name: string;
  scope: "todos_agentes" | "agente_especifico";
  agente_id: string | null;
}

export interface RemoveApiKeyInput {
  name: string;
  scope?: "todos_agentes" | "agente_especifico";
  agenteId?: string | null;
  byUser?: boolean;
}

const AGENT_SCOPED_PREFIX = "agente:";

/**
 * Ponte segura de chaves de API no Cofre AES-256-GCM (Fase 14 - CHAT-02).
 * Garante validacao estrita de nomes, isolamento de escopo (global vs agente),
 * bloqueio de escrita fora de turnos humanos locais e redacao central de segredos.
 */
export class ApiKeysBridge {
  private readonly vault: VaultService;
  #runtimeSecrets = new Set<string>();

  constructor(vault: VaultService) {
    this.vault = vault;
  }

  public validateKeyName(rawName: string): string {
    const normalized = String(rawName ?? "").trim();
    if (!API_KEY_NAME_REGEX.test(normalized)) {
      throw new Error(
        `Nome de chave invalido '${normalized}'. Use apenas letras maiusculas, digitos e underscore (/^[A-Z][A-Z0-9_]{0,63}$/).`,
      );
    }
    return normalized;
  }

  public observeRuntimeSecret(secretValue: string | null | undefined): void {
    if (typeof secretValue !== "string") return;
    const trimmed = secretValue.trim();
    if (trimmed.length >= 6) {
      this.#runtimeSecrets.add(trimmed);
    }
  }

  private collectKnownSecrets(): string[] {
    const secrets = new Set<string>(this.#runtimeSecrets);
    try {
      const metadata = this.vault.listSecretsMetadata();
      for (const item of metadata) {
        try {
          const val = this.vault.getSecret(item.chave_nome);
          if (val && val.trim().length >= 6) {
            secrets.add(val.trim());
          }
        } catch {
          // Ignora chaves corrompidas ou de outra master key
        }
      }
    } catch {
      // Ignora caso o banco esteja encerrando
    }
    return Array.from(secrets).sort((a, b) => b.length - a.length);
  }

  /**
   * Redige qualquer segredo conhecido (>= 6 caracteres) em logs, prompts de revisao ou historico.
   */
  public redactSecretValues(text: string): string {
    if (!text || typeof text !== "string") return text;
    const secrets = this.collectKnownSecrets();
    if (secrets.length === 0) return text;

    let output = text;
    for (const secret of secrets) {
      if (output.includes(secret)) {
        output = output.split(secret).join("[SEGREDO_REDIGIDO]");
      }
    }
    return output;
  }

  private parseVaultKeyName(
    chaveNome: string,
  ): { scope: "todos_agentes" | "agente_especifico"; agenteId: string | null; name: string } | null {
    if (chaveNome.startsWith(AGENT_SCOPED_PREFIX)) {
      const rest = chaveNome.slice(AGENT_SCOPED_PREFIX.length);
      const sepIndex = rest.indexOf(":");
      if (sepIndex <= 0) return null;
      const agenteId = rest.slice(0, sepIndex).trim();
      const keyName = rest.slice(sepIndex + 1).trim();
      if (!agenteId || !API_KEY_NAME_REGEX.test(keyName)) return null;
      return {
        scope: "agente_especifico",
        agenteId,
        name: keyName,
      };
    }

    if (API_KEY_NAME_REGEX.test(chaveNome)) {
      return {
        scope: "todos_agentes",
        agenteId: null,
        name: chaveNome,
      };
    }

    return null;
  }

  /**
   * Lista exclusivamente metadados seguros das API keys (jamais valores descriptografados).
   * Quando `agenteId` e informado, retorna chaves globais (`todos_agentes`) + exclusivas daquele agente.
   */
  public listApiKeys(agenteId?: string | null): ApiKeyMetadata[] {
    const rawList = this.vault.listSecretsMetadata();
    const normalizedAgent = agenteId?.trim() || null;
    const result: ApiKeyMetadata[] = [];

    for (const row of rawList) {
      const parsed = this.parseVaultKeyName(row.chave_nome);
      if (!parsed) continue;
      if (
        normalizedAgent &&
        parsed.scope === "agente_especifico" &&
        parsed.agenteId !== normalizedAgent
      ) {
        continue;
      }
      result.push({
        name: parsed.name,
        scope: parsed.scope,
        agente_id: parsed.agenteId,
        source: "vault",
        configured: true,
        updated_at: row.atualizado_em,
      });
    }

    return result;
  }

  /**
   * Uso interno do Daemon para resolver uma chave em runtime (especifica do agente -> fallback global).
   */
  public resolveSecretForAgent(name: string, agenteId?: string | null): string | null {
    const validName = this.validateKeyName(name);
    if (agenteId && agenteId.trim()) {
      const scoped = this.vault.getSecret(`${AGENT_SCOPED_PREFIX}${agenteId.trim()}:${validName}`);
      if (scoped !== null) {
        this.observeRuntimeSecret(scoped);
        return scoped;
      }
    }
    const globalVal = this.vault.getSecret(validName);
    if (globalVal !== null) {
      this.observeRuntimeSecret(globalVal);
    }
    return globalVal;
  }

  public saveApiKey(input: SaveApiKeyInput): SaveApiKeyResult {
    const validName = this.validateKeyName(input.name);
    const trimmedValue = String(input.value ?? "").trim();
    if (!trimmedValue) {
      throw new Error("O valor da chave de API nao pode ser vazio.");
    }

    if (input.origemTurno !== "usuario_local") {
      throw new Error(
        "Operacao bloqueada por seguranca: gravacao de chaves de API e permitida apenas em turnos iniciados diretamente pelo usuario humano local.",
      );
    }

    const scope: "todos_agentes" | "agente_especifico" =
      input.scope === "agente_especifico" ? "agente_especifico" : "todos_agentes";
    const normalizedAgent = input.agenteId?.trim() || null;

    if (scope === "agente_especifico" && !normalizedAgent) {
      throw new Error("agenteId e obrigatorio quando o escopo da chave for 'agente_especifico'.");
    }

    // Registra no redator antes mesmo de persistir em disco
    this.observeRuntimeSecret(trimmedValue);

    const storageKey =
      scope === "agente_especifico"
        ? `${AGENT_SCOPED_PREFIX}${normalizedAgent}:${validName}`
        : validName;

    this.vault.setSecret(storageKey, trimmedValue);

    return {
      status: "saved",
      name: validName,
      scope,
      agente_id: scope === "agente_especifico" ? normalizedAgent : null,
    };
  }

  public removeApiKey(input: RemoveApiKeyInput): {
    removed: boolean;
    name: string;
    scope: "todos_agentes" | "agente_especifico";
  } {
    const validName = this.validateKeyName(input.name);
    const normalizedAgent = input.agenteId?.trim() || null;
    const byUser = input.byUser === true;

    if (!byUser) {
      if (input.scope === "todos_agentes") {
        throw new Error(
          `Permissao negada: agentes nao podem remover chaves globais compartilhadas ('${validName}'). Solicite ao usuario a exclusao pelo Cofre.`,
        );
      }
      if (!normalizedAgent) {
        throw new Error("Contexto de agente ausente para remocao de chave exclusiva.");
      }

      const scopedKey = `${AGENT_SCOPED_PREFIX}${normalizedAgent}:${validName}`;
      const hasScoped = this.vault.getSecret(scopedKey) !== null;
      if (!hasScoped) {
        const hasGlobal = this.vault.getSecret(validName) !== null;
        if (hasGlobal) {
          throw new Error(
            `A chave '${validName}' pertence ao escopo global ('todos_agentes') e so pode ser removida pelo usuario na tela do Cofre.`,
          );
        }
        return { removed: false, name: validName, scope: "agente_especifico" };
      }

      const removed = this.vault.deleteSecret(scopedKey);
      return { removed, name: validName, scope: "agente_especifico" };
    }

    if (input.scope === "agente_especifico" && normalizedAgent) {
      const removed = this.vault.deleteSecret(
        `${AGENT_SCOPED_PREFIX}${normalizedAgent}:${validName}`,
      );
      return { removed, name: validName, scope: "agente_especifico" };
    }

    if (!input.scope && normalizedAgent) {
      const scopedRemoved = this.vault.deleteSecret(
        `${AGENT_SCOPED_PREFIX}${normalizedAgent}:${validName}`,
      );
      if (scopedRemoved) {
        return { removed: true, name: validName, scope: "agente_especifico" };
      }
    }

    const removed = this.vault.deleteSecret(validName);
    return { removed, name: validName, scope: "todos_agentes" };
  }
}
