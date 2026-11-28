/**
 * Registro central de guias operacionais sob demanda (`Tool Guidance`).
 * Mantém instruções extensas fora do prompt base, entregando-as apenas quando o agente
 * pesquisa (`tool_search`) ou descreve (`tool_describe`) ferramentas correspondentes.
 */

export interface DomainGuidanceRule {
  id: string;
  matchPrefixes?: readonly string[];
  matchNames?: readonly string[];
  guidance: string;
}

const DOMAIN_GUIDANCE_RULES: readonly DomainGuidanceRule[] = [
  {
    id: "browser",
    matchPrefixes: ["browser_"],
    matchNames: ["criativo_browser", "capture_screen", "get_browsing_log"],
    guidance:
      "[Guia Browser CDP] Reutilize sessões/abas já autenticadas chamando `list_tabs` antes de abrir nova URL. Use `snapshot` para localizar alvos visíveis, `fill_fields`/`type` para preencher e `request_takeover` + `submit_secret` quando houver login humano ou senha do Cofre.",
  },
  {
    id: "media_image",
    matchNames: ["generate_image", "read_image", "crop_margem_segura", "attach_files_to_response"],
    guidance:
      "[Guia Visual & Mídia] Quando precisar criar arte real, invoque `generate_image` informando referências reais disponíveis via `imagens_referencia` e valide dimensões/texto legível com `read_image`. Nunca afirme ter gerado uma imagem sem execução concluída da ferramenta.",
  },
  {
    id: "media_video",
    matchNames: ["generate_video", "read_video", "exec_remotion_render", "video_inspect_and_silences", "video_transcribe_words", "exec_ffmpeg_edit"],
    guidance:
      "[Guia Vídeo & Remotion] Para gerar vídeos MP4 com áudio use `generate_video`; para inspecionar use `read_video(url, frames?)`; para cortes/legendas/composição Remotion use as tools de vídeo e valide o arquivo de saída antes de enviar.",
  },
  {
    id: "meta_instagram",
    matchNames: ["validar_integracao_meta", "consultar_metricas_meta", "meta_publicar", "meta_agendar_primeiro_comentario", "meta_excluir_midia"],
    guidance:
      "[Guia Meta/Instagram Graph API] As credenciais ficam cifradas no Cofre AES-256-GCM; nunca solicite tokens no chat. Use `validar_integracao_meta` para diagnóstico e garanta links públicos HTTPS válidos sem IP bruto ao publicar.",
  },
  {
    id: "workflows",
    matchPrefixes: ["workflow_"],
    matchNames: ["list_workflows", "read_workflow", "edit_workflow", "delete_workflow", "run_workflow", "read_workflow_runs"],
    guidance:
      "[Guia Workflows] Você pode inspecionar, criar, editar e executar fluxos. Regra crítica: jamais execute `delete_workflow` sem confirmação humana explícita (`confirmed_by_human: true`).",
  },
  {
    id: "schedule_routines",
    matchPrefixes: ["routine_"],
    matchNames: ["create_routine", "update_routine", "delete_routine", "list_routines", "test_routine", "create_webhook_routine", "update_webhook_routine", "schedule_wakeup", "start_task", "await_event", "start_background_job"],
    guidance:
      "[Guia Rotinas & Tarefas] Em turnos automáticos de rotina use `routine_no_update` quando nada mudar ou `routine_report_failure` em erro técnico. Só crie `webhook_routine` sob pedido humano explícito.",
  },
  {
    id: "data_tables_ui",
    matchNames: ["list_tables", "query_data", "execute_data", "delete_table", "html_render", "html_preview"],
    guidance:
      "[Guia Shared Tables & UI] Use `list_tables`/`query_data`/`execute_data` para consultar ou persistir dados estruturados no SQLite compartilhado entre agentes, e `html_render` para painéis visuais interativos.",
  },
  {
    id: "vault_keys",
    matchNames: ["request_api_key", "list_api_keys", "save_api_key", "remove_api_key"],
    guidance:
      "[Guia Cofre de Chaves] Nunca exiba valores brutos de chaves ou senhas. Use `request_api_key` para exibir o formulário seguro na UI quando o usuário precisar informar uma credencial.",
  },
  {
    id: "showcase_sites",
    matchNames: ["list_sites", "publish_site", "replace_site", "create_site", "update_site", "delete_site"],
    guidance:
      "[Guia Sites & Showcase] URLs públicas nunca devem apontar para IP bruto ou HTTP inseguro; use domínio HTTPS válido ou publicação no GitHub Pages.",
  },
  {
    id: "whatsapp",
    matchPrefixes: ["messaging_"],
    guidance:
      "[Guia Mensageria WhatsApp] Respeite formato curto de celular, sem tabelas Markdown complexas, confirmando destinatário e contexto antes de disparos.",
  },
];

/**
 * Resolve guias deduplicados (cada bloco de guia aparece uma única vez por resposta)
 * para um conjunto de nomes de ferramentas descobertas.
 */
export function getToolGuidanceForNames(toolNames: readonly string[]): string[] {
  if (!Array.isArray(toolNames) || toolNames.length === 0) {
    return [];
  }

  const matchedIds = new Set<string>();
  const out: string[] = [];

  for (const rawName of toolNames) {
    const name = String(rawName ?? "").trim();
    if (!name) continue;
    for (const rule of DOMAIN_GUIDANCE_RULES) {
      if (matchedIds.has(rule.id)) continue;
      const hitName = rule.matchNames?.includes(name) ?? false;
      const hitPrefix = rule.matchPrefixes?.some((prefix) => name.startsWith(prefix)) ?? false;
      if (hitName || hitPrefix) {
        matchedIds.add(rule.id);
        out.push(rule.guidance);
      }
    }
  }

  return out;
}

/**
 * Calcula o volume total de caracteres/bytes de todos os guias registrados (para budget check).
 */
export function measureTotalGuidanceBytes(): number {
  const joined = DOMAIN_GUIDANCE_RULES.map((r) => `${r.id}:${r.guidance}`).join("\n");
  return Buffer.byteLength(joined, "utf8");
}
