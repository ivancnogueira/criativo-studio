import type { AgenteRegistro, AvatarShape, AvatarStyle } from "@criativo/contracts";

export type { AvatarStyle };

/**
 * 16 expressões cartoon inspiradas na referência visual + modo "talking" com sílabas articuladas.
 */
export type AvatarExpression =
  | "wink"
  | "cheeky"
  | "bored"
  | "cash"
  | "fierce"
  | "cute"
  | "sleep"
  | "sweet"
  | "cool"
  | "bleh"
  | "smug"
  | "dizzy"
  | "shock"
  | "cry"
  | "wow"
  | "love"
  | "talking";

/**
 * Contexto semântico de tarefa que governa a playlist de expressões do avatar.
 */
export type AvatarTaskContext =
  | "idle"
  | "sleeping"
  | "research"
  | "writing"
  | "talking"
  | "media"
  | "ads"
  | "approval"
  | "completed"
  | "error";

export interface AgentAvatarVisual {
  style: AvatarStyle;
  shape: AvatarShape;
  variant: string;
  color: string;
  imageUrl?: string | null;
}

export interface AvatarVariantSpec {
  id: string;
  label: string;
  badge?: string;
}

export interface AvatarStyleMeta {
  id: AvatarStyle;
  label: string;
  shortLabel: string;
  description: string;
}

/**
 * Playlists orgânicas por tipo de tarefa: variam continuamente em sessões longas.
 */
export const TASK_EXPRESSION_PLAYLISTS: Record<AvatarTaskContext, readonly AvatarExpression[]> = {
  idle: ["cute", "sweet", "wink", "cool", "cheeky"],
  sleeping: ["sleep", "bored", "cute"],
  research: ["cool", "wow", "dizzy", "smug", "wink"],
  writing: ["smug", "wink", "cheeky", "cute", "sweet"],
  talking: ["talking", "sweet", "wink", "smug"],
  media: ["fierce", "wow", "love", "cool", "cheeky"],
  ads: ["cash", "smug", "cool", "wink", "fierce"],
  approval: ["wow", "cute", "dizzy", "sweet"],
  completed: ["love", "sweet", "cool", "wink", "cheeky"],
  error: ["shock", "cry", "fierce", "bleh", "dizzy"],
};

const EXPLICIT_TASK_CONTEXTS = new Set<AvatarTaskContext>([
  "idle",
  "sleeping",
  "research",
  "writing",
  "talking",
  "media",
  "ads",
  "approval",
  "completed",
  "error",
]);

/**
 * Mapeia o estado real do agente/ferramenta/tarefa para um contexto de emoção do avatar.
 */
export function inferTaskContextFromActivity(input: {
  mood?: "idle" | "working" | "waiting" | "failed" | "responded" | "completed";
  activity?: AvatarTaskContext | string | null;
  toolName?: string | null;
  statusText?: string | null;
  isStreaming?: boolean;
  awaitingApproval?: boolean;
  agentStatus?: AgenteRegistro["status"] | string | null;
}): AvatarTaskContext {
  const combined = `${input.activity ?? ""} ${input.toolName ?? ""} ${input.statusText ?? ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (
    input.mood === "failed" ||
    input.activity === "error" ||
    /\b(erro|err|fail|falha|timeout|exception|bloquead|denied|rejeitad|travou)\b/.test(combined)
  ) {
    return "error";
  }

  if (
    input.awaitingApproval ||
    input.mood === "waiting" ||
    input.activity === "approval" ||
    /\b(aprov|aguardando|takeover|ask_user|ask_ui|confirm|revisao)\b/.test(combined)
  ) {
    return "approval";
  }

  const normalizedActivity =
    typeof input.activity === "string" ? (input.activity.trim().toLowerCase() as AvatarTaskContext) : null;
  if (normalizedActivity && EXPLICIT_TASK_CONTEXTS.has(normalizedActivity) && normalizedActivity !== "idle") {
    return normalizedActivity;
  }

  if (input.isStreaming || input.activity === "talking") {
    return "talking";
  }

  if (
    /\b(anunc|meta_ads|ads|roi|campanha|venda|vendas|lucro|metrica|analytics|convers|orcamento|faturamento|roas|ctr|cpm)\b/.test(
      combined
    )
  ) {
    return "ads";
  }

  if (
    /\b(generate_image|imagem|imagens|arte|artes|carrossel|carrosseis|storie|stories|video|videos|reel|reels|remotion|design|render|midia|foto|fotos|criativo|capa)\b/.test(
      combined
    )
  ) {
    return "media";
  }

  if (
    /\b(browser|pesquis|search|web|naveg|scrape|ler|read|inspec|analis|concorrent|benchmark|fetch|instagram|perfil)\b/.test(
      combined
    )
  ) {
    return "research";
  }

  if (
    /\b(copy|roteiro|escrev|redig|legend|post|texto|doc|markdown|edit|write|planej|pauta|calendario)\b/.test(
      combined
    )
  ) {
    return "writing";
  }

  if (input.mood === "completed" || input.mood === "responded") {
    return "completed";
  }

  if (input.mood === "working" || input.agentStatus === "trabalhando") {
    return "writing";
  }

  if (input.agentStatus === "pausado" || /\b(pausa|dorm|sleep|standby)\b/.test(combined)) {
    return "sleeping";
  }

  return "idle";
}
