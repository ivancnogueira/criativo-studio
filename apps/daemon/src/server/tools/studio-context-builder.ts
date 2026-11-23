import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CriativoDatabase } from "../../database/client.ts";
import { MemoryManager } from "../../engine/runner/memory-manager.ts";
import { resolveMetaCredentials } from "../../engine/tools/meta-insights.ts";
import type { ProviderConnectionService } from "../../providers/provider-connection-service.ts";
import type { VaultService } from "../../vault/vault-service.ts";
import { listAgentsWithAliases } from "../agent-resolver.ts";
import { readAgentGovernance } from "./phase15-governance.ts";
import { syncWorkspaceFilesToDatabase } from "./studio-media-scanner.ts";
function readBrandSnippetIfRich(filePath: string, maxChars: number): string {
  if (!existsSync(filePath)) return "";
  try {
    const raw = readFileSync(filePath, "utf8").trim();
    if (!raw) return "";
    const onlyTemplates =
      raw.includes("[A PREENCHER]") && raw.includes("[NOME_DA_MARCA]") && raw.length < 300;
    return onlyTemplates ? "" : raw.slice(0, maxChars);
  } catch {
    return "";
  }
}

/**
 * Monta o Contexto Vivo seguro do Studio para injetar no systemPrompt de qualquer agente no Chat.
 */
export function buildStudioLiveContext(deps: {
  db: CriativoDatabase;
  vault?: VaultService;
  providerConnection: ProviderConnectionService;
  workspaceRoot: string;
  agenteId?: string | null;
  memoryManager?: MemoryManager;
  userPrompt?: string;
  compact?: boolean;
}): string {
  if (deps.compact) {
    const onboarding = deps.providerConnection.getOnboardingState();
    const marcaConfig = deps.providerConnection.getStudioConfig<Record<string, unknown>>(
      "identidade_marca",
      {}
    );
    const metaCreds = resolveMetaCredentials(deps.vault);
    const compactLines: string[] = [
      "## Contexto Enxuto do CriativoOS",
      `- Marca: ${String(marcaConfig.marca_nome ?? onboarding.marca_nome)} (${String(
        marcaConfig.perfil_handle ?? onboarding.perfil_handle
      )})`,
      ...(typeof marcaConfig.nicho === "string" && marcaConfig.nicho
        ? [`- Nicho: ${marcaConfig.nicho}`]
        : []),
      `- Meta/Instagram: ${metaCreds.configured ? "Conectado no Cofre" : "Não configurado"}`,
      "- Recursos sob demanda: use `load_skill` quando precisar do guia completo de execução e `list_agents` para consultar especialistas/@apelidos.",
    ];
    if (deps.agenteId) {
      const gov = readAgentGovernance(deps.db, deps.agenteId);
      if (gov.allowedFolders.length > 0) {
        const listText = gov.allowedFolders
          .map((f) => `${f.path} (${f.mode === "read" ? "leitura" : "leitura e escrita"})`)
          .join("; ");
        compactLines.push(`- Pastas Autorizadas do Agente: ${listText}`);
      }
    }
    return compactLines.join("\n");
  }

  syncWorkspaceFilesToDatabase(deps.db, deps.workspaceRoot);

  const onboarding = deps.providerConnection.getOnboardingState();
  const marcaConfig = deps.providerConnection.getStudioConfig<Record<string, unknown>>(
    "identidade_marca",
    {}
  );
  const metaCreds = resolveMetaCredentials(deps.vault);

  const secretsMeta = deps.vault ? deps.vault.listSecretsMetadata() : [];
  const secretNames = new Set(secretsMeta.map((s) => s.chave_nome));
  const hasEleven = secretNames.has("elevenlabs_api_key") || secretNames.has("ELEVENLABS_API_KEY");
  const hasTelegram = secretNames.has("telegram_bot_token") || secretNames.has("TELEGRAM_BOT_TOKEN");

  const files = deps.db.connection
    .prepare(
      `SELECT nome_original, caminho_relativo, tipo_uso FROM projecao_arquivos ORDER BY criado_em DESC LIMIT 20;`
    )
    .all() as Array<{ nome_original: string; caminho_relativo: string; tipo_uso: string }>;

  const canReadDisk = process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1";
  const perfilFileSnippet = canReadDisk
    ? readBrandSnippetIfRich(resolve(deps.workspaceRoot, "conteudos", "perfil-da-marca.md"), 1200)
    : "";
  const idVisualSnippet = canReadDisk
    ? readBrandSnippetIfRich(resolve(deps.workspaceRoot, "conteudos", "identidade-visual.yml"), 800)
    : "";
  const brandbookSnippet = canReadDisk
    ? readBrandSnippetIfRich(resolve(deps.workspaceRoot, "recursos", "brand", "brandbook.md"), 800)
    : "";
  const designSystemSnippet = canReadDisk
    ? readBrandSnippetIfRich(resolve(deps.workspaceRoot, "recursos", "brand", "design-system.md"), 600)
    : "";

  const lines: string[] = [
    "## Contexto Vivo do CriativoOS",
    `- Marca configurada: ${String(marcaConfig.marca_nome ?? onboarding.marca_nome)} (${String(
      marcaConfig.perfil_handle ?? onboarding.perfil_handle
    )})`,
    ...(typeof marcaConfig.nicho === "string" && marcaConfig.nicho
      ? [`- Nicho/Segmento: ${marcaConfig.nicho}`]
      : []),
    ...(typeof marcaConfig.tom_voz === "string" && marcaConfig.tom_voz
      ? [`- Tom de Voz: ${marcaConfig.tom_voz}`]
      : []),
    `- Cofre AES-256-GCM (SQLite) — Meta/Instagram: ${
      metaCreds.configured
        ? "CONFIGURADO (token e account ID salvos no Cofre; nunca peça token no chat)"
        : "NÃO CONFIGURADO (oriente salvar em Conexões -> Apps & Canais -> Instagram)"
    }`,
    `- Cofre — ElevenLabs TTS: ${hasEleven ? "Configurado" : "Não configurado (fallback edge-tts)"}`,
    `- Cofre — Telegram Bot: ${hasTelegram ? "Configurado" : "Não configurado"}`,
    `- Regra de Ouro do Studio Online: As credenciais NÃO ficam em .env visível; ficam cifradas no Cofre SQLite e validadas pela ferramenta nativa 'validar_integracao_meta' (ou via 'npm run validar:integracoes').`,
  ];

  if (deps.agenteId) {
    const gov = readAgentGovernance(deps.db, deps.agenteId);
    if (gov.allowedFolders.length > 0) {
      const folderDesc = gov.allowedFolders
        .map((f) => `\`${f.path}\` (${f.mode === "read" ? "somente leitura" : "leitura e escrita"})`)
        .join(", ");
      lines.push(`- Pastas Autorizadas do Agente fora do workspace: ${folderDesc}.`);
    }
  }

  if (files.length > 0) {
    const fotosReais = files.filter(
      (f) =>
        f.caminho_relativo.startsWith("recursos/fotos/") ||
        f.caminho_relativo.startsWith("recursos/personagens/") ||
        f.tipo_uso === "personagem"
    );
    const refsEstilo = files.filter(
      (f) => f.caminho_relativo.startsWith("recursos/referencias/") && !fotosReais.includes(f)
    );
    const logosMarca = files.filter(
      (f) => (f.caminho_relativo.startsWith("recursos/logos/") || f.tipo_uso === "logo") && !fotosReais.includes(f)
    );
    const outrosArqs = files.filter(
      (f) => !fotosReais.includes(f) && !refsEstilo.includes(f) && !logosMarca.includes(f)
    );
    lines.push(
      `- Fotos reais do usuário (${fotosReais.length}): ${
        fotosReais.length > 0
          ? fotosReais.map((f) => `${f.nome_original} (${f.caminho_relativo})`).join("; ")
          : "nenhuma em recursos/fotos/"
      }`,
      `- Referências de estilo (${refsEstilo.length}): ${
        refsEstilo.length > 0
          ? refsEstilo.map((f) => `${f.nome_original} (${f.caminho_relativo})`).join("; ")
          : "nenhuma em recursos/referencias/"
      }`,
      ...(logosMarca.length > 0
        ? [`- Logos da marca (${logosMarca.length}): ${logosMarca.map((f) => f.caminho_relativo).join("; ")}`]
        : []),
      ...(outrosArqs.length > 0
        ? [`- Outras mídias/entregáveis (${outrosArqs.length}): ${outrosArqs.slice(0, 6).map((f) => f.caminho_relativo).join("; ")}`]
        : [])
    );
  } else {
    lines.push(
      "- Arquivos/Referências/ImagePaths disponíveis: nenhuma mídia salva ainda em recursos/fotos/, recursos/referencias/ ou recursos/logos/."
    );
  }

  if (perfilFileSnippet) {
    lines.push("", "### Memória Estratégica (conteudos/perfil-da-marca.md)", perfilFileSnippet);
  }
  if (idVisualSnippet) {
    lines.push("", "### Identidade Visual (conteudos/identidade-visual.yml)", idVisualSnippet);
  }
  if (brandbookSnippet) {
    lines.push("", "### Brandbook da Marca (recursos/brand/brandbook.md)", brandbookSnippet);
  }
  if (designSystemSnippet) {
    lines.push("", "### Design System (recursos/brand/design-system.md)", designSystemSnippet);
  }

  const includeFullRoster =
    !deps.agenteId ||
    deps.agenteId === "orquestrador" ||
    Boolean(deps.userPrompt && /(@|handoff|equipe|time|especialista|delegar|quem faz)/i.test(deps.userPrompt));

  const rosterWithAliases = listAgentsWithAliases(deps.db);
  lines.push(
    "",
    "### Equipe de Colegas para Handoff",
    ...(includeFullRoster
      ? [
          rosterWithAliases
            .map((a) =>
              a.apelido === a.agente_id
                ? `- \`@${a.agente_id}\`: ${a.nome} — ${a.papel}`
                : `- \`@${a.apelido}\` (ID \`${a.agente_id}\`): ${a.nome} — ${a.papel}`
            )
            .join("\n"),
        ]
      : [
          `- Especialistas disponíveis: ${rosterWithAliases.map((a) => `@${a.apelido}`).join(", ")}.`,
        ]),
    "IMPORTANTE SOBRE HANDOFF: Só emita `[HANDOFF:agente_id]` sob pedido prático explícito que exija outro especialista. Nunca emita handoff ao se apresentar ou tirar dúvidas simples."
  );

  try {
    if (deps.db.hasTable("projecao_agente_rotinas")) {
      const rotinasRows = deps.db.connection
        .prepare(
          `SELECT nome, owner_id, trigger_kind, ativa FROM projecao_agente_rotinas ORDER BY atualizado_em DESC LIMIT 15;`
        )
        .all() as Array<{ nome: string; owner_id: string; trigger_kind: string; ativa: number }>;
      const ativasCount = rotinasRows.filter((r) => r.ativa === 1).length;
      lines.push(
        "",
        "### Rotinas, Webhooks e Agenda",
        `- Rotinas registradas no estúdio: ${rotinasRows.length} (${ativasCount} ativas).`,
        "- Use `create_routine`, `update_routine`, `delete_routine`, `list_routines` ou `test_routine` para gerenciar rotinas agendadas; `create_webhook_routine`/`update_webhook_routine` apenas mediante pedido explícito humano no chat; e `routine_no_update`/`routine_report_failure` quando rodando em turno automático."
      );
    }
  } catch {
    // Tabela opcional em contextos legados
  }

  try {
    if (deps.agenteId) {
      const memMgr = deps.memoryManager ?? new MemoryManager(deps.db);
      const snap = memMgr.getEssentialContextSnapshot(deps.agenteId);
      const xmlBlock =
        snap.contextBlock || `<agent_memories count="${snap.memorias.length}"></agent_memories>`;
      lines.push(
        "",
        "### Memórias Essenciais, Shared Tables e Generative UI",
        xmlBlock,
        "- Use `remember` / `forget_memory` para gravar decisões duráveis, `memory_recall` para buscar memórias `searchable` via FTS5, `list_tables` / `query_data` / `execute_data` para o banco SQL compartilhado entre agentes, `html_render` para painéis interativos em sandbox e `ask_user` / `ask_ui` / `acknowledge_request` / `request_api_key` para cards bloqueantes.",
      );
    }
  } catch {
    // Ignora caso tabela de memórias não esteja pronta em ambiente mínimo
  }

  lines.push(
    "",
    "### Navegador CDP, Mídia, Geração de Imagens/Vídeos, Sidebar & Showcase",
    "- Use `criativo_browser` (action: open, list_tabs, navigate, snapshot, click, type, fill_fields, press, scroll, screenshot, request_takeover, submit_secret, close_tab) para operar o Chromium real.",
    "- Use `generate_image` para artes reais (Gemini Nano Banana 2.1 até 14 referências, GPT Image 2.6/2.5 até 16 referências via API Key ou Antigravity); você decide quantas e quais referências enviar via `imagens_referencia`.",
    "- Use `generate_video` para gerar vídeos MP4 com áudio nativo sincronizado via Gemini Omni 1.2 Flash (3 a 15s, até 6 imagens de referência via `imagens_referencia`).",
    "- Use `read_video(url, frames?)`, `read_image(path)` e `capture_screen(purpose)` para inspeção visual; `list_sections`/`assign_agent_section` para Sidebar e `list_sites`/`publish_site` para Showcase.",
  );

  return lines.join("\n");
}
