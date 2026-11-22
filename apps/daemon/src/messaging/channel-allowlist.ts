import type {
  MessagingAllowlistEntry,
  MessagingAllowlistRole,
  MessagingChannelPolicy,
} from "@criativo/contracts";

export interface AllowlistEvaluationInput {
  policy: MessagingChannelPolicy;
  senderId: string;
  channelId?: string;
}

export interface AllowlistEvaluationResult {
  allowed: boolean;
  role: MessagingAllowlistRole | null;
  reason: string;
}

function normalizeId(raw: string | undefined | null): string {
  return String(raw ?? "").trim().toLowerCase();
}

function findMatchingEntry(
  entries: readonly MessagingAllowlistEntry[],
  senderId: string,
): MessagingAllowlistEntry | undefined {
  const normSender = normalizeId(senderId);
  if (!normSender) return undefined;
  return entries.find((entry) => {
    const id = normalizeId(entry.senderId);
    return id === "*" || id === normSender;
  });
}

/**
 * Avalia se um remetente e canal têm permissão de acesso segundo a política
 * configurada em `projecao_messaging_policies`.
 */
export function evaluateMessagingAccess(
  input: AllowlistEvaluationInput,
): AllowlistEvaluationResult {
  const { policy, senderId, channelId } = input;
  if (!policy.enabled) {
    return { allowed: false, role: null, reason: "Canal desativado na política." };
  }

  const normSender = normalizeId(senderId);
  if (!normSender) {
    return { allowed: false, role: null, reason: "Remetente sem identificador." };
  }

  if (policy.allowedChannelIds.length > 0 && channelId) {
    const normChannel = normalizeId(channelId);
    const channelAllowed = policy.allowedChannelIds.some((c) => {
      const nc = normalizeId(c);
      return nc === "*" || nc === normChannel;
    });
    if (!channelAllowed) {
      return {
        allowed: false,
        role: null,
        reason: "Canal/chat não incluído na lista de canais permitidos.",
      };
    }
  }

  if (policy.allowlist.length === 0) {
    return {
      allowed: true,
      role: "operator",
      reason: "Allowlist vazia: acesso padrão como operador permitido.",
    };
  }

  const entry = findMatchingEntry(policy.allowlist, senderId);
  if (!entry) {
    return {
      allowed: false,
      role: null,
      reason: "Remetente não autorizado na allowlist do canal.",
    };
  }

  if (entry.role === "viewer") {
    return {
      allowed: false,
      role: "viewer",
      reason: "Remetente possui papel viewer (somente leitura).",
    };
  }

  return {
    allowed: true,
    role: entry.role,
    reason: `Remetente autorizado com papel ${entry.role}.`,
  };
}
