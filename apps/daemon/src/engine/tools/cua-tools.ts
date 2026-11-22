import type { CuaActionRequest, CuaActionType, ToolDefinition } from "@criativo/contracts";
import type { CuaDriverClient } from "./cua-driver-client.ts";

export const CUA_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "cua_execute",
    description:
      "Executa ação opcional de Computer Use Nativo (G-21) em janela desktop do sistema operacional (ex.: click, double_click, type_text, hotkey, scroll, focus_window, screenshot_region). Exige cua_enabled=true no agente e consentimento humano.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "click",
            "double_click",
            "type_text",
            "hotkey",
            "scroll",
            "focus_window",
            "screenshot_region",
          ],
          description: "Ação nativa de mouse/teclado/janela a executar.",
        },
        x: { type: "number", description: "Coordenada X na tela em pixels." },
        y: { type: "number", description: "Coordenada Y na tela em pixels." },
        text: { type: "string", description: "Texto a digitar em type_text." },
        keys: {
          type: "array",
          items: { type: "string" },
          description: "Combinação de teclas para hotkey (ex.: ['Ctrl', 'C']).",
        },
        delta_x: { type: "number", description: "Deslocamento horizontal de scroll." },
        delta_y: { type: "number", description: "Deslocamento vertical de scroll." },
        window_title: { type: "string", description: "Título da janela alvo para foco/destaque." },
        aprovadoPorHumano: {
          type: "boolean",
          description: "Confirmação explícita do usuário para controlar aplicativos nativos fora do navegador.",
        },
      },
      required: ["action"],
    },
  },
];

export const CUA_TOOL_NAMES: ReadonlySet<string> = new Set(
  CUA_TOOL_DEFINITIONS.map((t) => t.name),
);

export async function executeCuaTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: { agenteId: string; aprovadoPorHumano?: boolean },
  cuaClient: CuaDriverClient,
): Promise<unknown> {
  if (toolName !== "cua_execute") {
    throw new Error(`Ferramenta CUA desconhecida: ${toolName}`);
  }

  const approved = Boolean(ctx.aprovadoPorHumano ?? args.aprovadoPorHumano ?? args.aprovado_por_humano);
  if (!approved) {
    return {
      ok: false,
      requiresHumanConsent: true,
      erro: "Computer Use Nativo exige aprovação humana explícita antes de interagir com aplicativos desktop.",
    };
  }

  const req: CuaActionRequest = {
    action: String(args.action ?? "") as CuaActionType,
    agente_id: ctx.agenteId,
    x: typeof args.x === "number" ? args.x : undefined,
    y: typeof args.y === "number" ? args.y : undefined,
    text: typeof args.text === "string" ? args.text : undefined,
    keys: Array.isArray(args.keys) ? args.keys.map((k) => String(k)) : undefined,
    delta_x: typeof args.delta_x === "number" ? args.delta_x : undefined,
    delta_y: typeof args.delta_y === "number" ? args.delta_y : undefined,
    window_title: typeof args.window_title === "string" ? args.window_title : undefined,
    aprovado_por_humano: true,
  };

  return await cuaClient.executeAction(req);
}
