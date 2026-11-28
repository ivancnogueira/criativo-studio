import React, { useState } from "react";
import type {
  AgenteRegistro,
  CommentDmFlowNode,
  CommentDmRule,
  CommentRuleScope,
  CommentTriggerMatchMode,
  CreateCommentDmRuleInput,
  PublicDeliverableRecord,
  WorkflowVisual,
} from "@criativo/contracts";
import { X } from "lucide-react";
import { CommentDmFlowBuilder } from "./CommentDmFlowBuilder";
import { CommentDmSelect } from "./CommentDmSelect";

export interface CommentDmRuleEditorModalProps {
  initialRule: CommentDmRule | null;
  deliverables: PublicDeliverableRecord[];
  agentes: AgenteRegistro[];
  workflows: WorkflowVisual[];
  onClose: () => void;
  onSave: (payload: CreateCommentDmRuleInput, ruleId?: string) => Promise<void>;
}

export const CommentDmRuleEditorModal: React.FC<CommentDmRuleEditorModalProps> = ({
  initialRule,
  deliverables,
  agentes,
  workflows,
  onClose,
  onSave,
}) => {
  const [nome, setNome] = useState(initialRule?.nome ?? "Nova Automação Instagram");
  const [ativo, setAtivo] = useState(initialRule?.ativo ?? false);
  const [matchMode, setMatchMode] = useState<CommentTriggerMatchMode>(initialRule?.match_mode ?? "contains");
  const [keywordsText, setKeywordsText] = useState((initialRule?.keywords ?? ["quero"]).join(", "));
  const [negativeText, setNegativeText] = useState((initialRule?.negative_keywords ?? []).join(", "));
  const [postScope, setPostScope] = useState<CommentRuleScope>(initialRule?.post_scope ?? "all_posts");
  const [mediaIdsText, setMediaIdsText] = useState((initialRule?.target_media_ids ?? []).join(", "));
  const [includeReplies, setIncludeReplies] = useState(initialRule?.include_comment_replies ?? false);
  const [allowLive, setAllowLive] = useState(initialRule?.allow_live_comments ?? false);
  const [oncePerPost, setOncePerPost] = useState(initialRule?.reply_once_per_user_per_post ?? true);
  const [requireApproval, setRequireApproval] = useState(initialRule?.require_human_approval ?? false);
  const [publicRepliesText, setPublicRepliesText] = useState(
    (initialRule?.public_replies ?? ["Acabei de te enviar no Direct! ✨", "Confira seu Direct! 📩"]).join("\n")
  );
  const [crmTagsText, setCrmTagsText] = useState((initialRule?.crm_tags ?? ["instagram_comentario"]).join(", "));
  const [openingText, setOpeningText] = useState(
    initialRule?.opening_message.text ?? "Oi! Vi seu comentário. Toque no botão abaixo para eu liberar seu material:"
  );
  const [buttonLabel, setButtonLabel] = useState(
    initialRule?.opening_message.button_label ?? "Quero receber agora"
  );
  const [flowNodes, setFlowNodes] = useState<CommentDmFlowNode[]>(initialRule?.flow_nodes ?? []);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (evt: React.FormEvent) => {
    evt.preventDefault();
    setSaving(true);
    try {
      const splitComma = (raw: string) =>
        raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

      await onSave(
        {
          conta_id: initialRule?.conta_id ?? "principal",
          nome: nome.trim(),
          ativo,
          match_mode: matchMode,
          keywords: splitComma(keywordsText),
          negative_keywords: splitComma(negativeText),
          post_scope: postScope,
          target_media_ids: splitComma(mediaIdsText),
          include_comment_replies: includeReplies,
          allow_live_comments: allowLive,
          reply_once_per_user_per_post: oncePerPost,
          require_human_approval: requireApproval,
          public_replies: publicRepliesText
            .split(/\r?\n/)
            .map((s: string) => s.trim())
            .filter(Boolean),
          crm_tags: splitComma(crmTagsText),
          opening_message: {
            text: openingText.trim(),
            button_label: buttonLabel.trim(),
            next_node_id: flowNodes[0]?.node_id ?? null,
          },
          flow_nodes: flowNodes,
        },
        initialRule?.rule_id
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border border-white/15 bg-[#161616] text-white shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08]">
          <h2 className="text-sm font-semibold">
            {initialRule ? `Editar Regra: ${initialRule.nome}` : "Nova Regra & Fluxo DM [BETA]"}
          </h2>
          <button type="button" onClick={onClose} className="p-1 text-neutral-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="text-neutral-300">Nome da automação</span>
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                className="w-full rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-white"
              />
            </label>

            <div className="space-y-1">
              <span className="text-neutral-300">Modo de gatilho</span>
              <CommentDmSelect
                value={matchMode}
                onChange={(v) => setMatchMode(v as CommentTriggerMatchMode)}
                options={[
                  { value: "contains", label: "Contém palavra-chave" },
                  { value: "exact", label: "Palavra exata" },
                  { value: "any", label: "Qualquer comentário" },
                ]}
              />
            </div>

            {matchMode !== "any" && (
              <label className="space-y-1">
                <span className="text-neutral-300">Palavras-chave (separadas por vírgula)</span>
                <input
                  value={keywordsText}
                  onChange={(e) => setKeywordsText(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-white"
                />
              </label>
            )}

            <label className="space-y-1">
              <span className="text-neutral-300">Palavras negativas / exclusão</span>
              <input
                value={negativeText}
                onChange={(e) => setNegativeText(e.target.value)}
                placeholder="ex.: erro, reclamacao"
                className="w-full rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-white"
              />
            </label>

            <div className="space-y-1">
              <span className="text-neutral-300">Escopo de posts</span>
              <CommentDmSelect
                value={postScope}
                onChange={(v) => setPostScope(v as CommentRuleScope)}
                options={[
                  { value: "all_posts", label: "Qualquer post / Reel" },
                  { value: "specific_posts", label: "Posts / Reels específicos" },
                  { value: "future_posts_only", label: "Apenas posts futuros" },
                ]}
              />
            </div>

            {postScope === "specific_posts" && (
              <label className="space-y-1">
                <span className="text-neutral-300">IDs das mídias (separados por vírgula)</span>
                <input
                  value={mediaIdsText}
                  onChange={(e) => setMediaIdsText(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-white"
                />
              </label>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
            {[
              { checked: ativo, set: setAtivo, label: "Regra ativa" },
              { checked: oncePerPost, set: setOncePerPost, label: "1x por usuário/post" },
              { checked: includeReplies, set: setIncludeReplies, label: "Responder réplicas" },
              { checked: allowLive, set: setAllowLive, label: "Permitir Live (DM only)" },
              { checked: requireApproval, set: setRequireApproval, label: "Exigir aprovação humana" },
            ].map((item) => (
              <label
                key={item.label}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#121212] px-3 py-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={(e) => item.set(e.target.checked)}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="text-neutral-300">Respostas públicas aleatórias (1 por linha · opcional)</span>
              <textarea
                rows={3}
                value={publicRepliesText}
                onChange={(e) => setPublicRepliesText(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-neutral-300">Tags CRM aplicadas ao contato</span>
              <input
                value={crmTagsText}
                onChange={(e) => setCrmTagsText(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-white"
              />
            </label>
          </div>

          <div className="rounded-xl border border-[#42A0FF]/25 bg-[#42A0FF]/[0.05] p-4 space-y-3">
            <div className="text-xs font-semibold text-[#42A0FF]">
              Etapa 1 · Private Reply (Âncora comment_id · Janela 7 dias)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-neutral-300">Mensagem inicial no Direct</span>
                <textarea
                  rows={2}
                  required
                  value={openingText}
                  onChange={(e) => setOpeningText(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-white"
                />
              </label>
              <label className="space-y-1">
                <span className="text-neutral-300">Texto do botão CTA (abre janela 24h)</span>
                <input
                  required
                  value={buttonLabel}
                  onChange={(e) => setButtonLabel(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-white"
                />
              </label>
            </div>
          </div>

          <CommentDmFlowBuilder
            nodes={flowNodes}
            onChange={setFlowNodes}
            deliverables={deliverables}
            agentes={agentes}
            workflows={workflows}
          />
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/[0.08] bg-[#141414]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/15 px-4 py-2 text-xs text-neutral-300"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-[#31CF76] px-4 py-2 text-xs font-semibold text-[#08120C]"
          >
            {saving ? "Salvando..." : "Salvar Regra & Fluxo"}
          </button>
        </div>
      </form>
    </div>
  );
};
