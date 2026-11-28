import React from "react";
import type {
  AgenteRegistro,
  CommentDmFlowNode,
  DmFlowNodeType,
  PublicDeliverableRecord,
  WorkflowVisual,
} from "@criativo/contracts";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { CommentDmSelect } from "./CommentDmSelect";

export interface CommentDmFlowBuilderProps {
  nodes: CommentDmFlowNode[];
  onChange: (next: CommentDmFlowNode[]) => void;
  deliverables: PublicDeliverableRecord[];
  agentes: AgenteRegistro[];
  workflows: WorkflowVisual[];
}

const NODE_TYPE_OPTIONS: Array<{ value: DmFlowNodeType; label: string }> = [
  { value: "send_message", label: "Enviar Mensagem" },
  { value: "delay", label: "Aguardar (Delay)" },
  { value: "collect_input", label: "Coletar E-mail / WhatsApp (CRM)" },
  { value: "branch_buttons", label: "Ramificar por Botões" },
  { value: "send_deliverable_card", label: "Enviar Cartão de Entregável HTTPS" },
  { value: "trigger_workflow", label: "Disparar Fluxo Criativo" },
  { value: "handoff_agent", label: "Transferir para Criativo IA (24h)" },
];

export const CommentDmFlowBuilder: React.FC<CommentDmFlowBuilderProps> = ({
  nodes,
  onChange,
  deliverables,
  agentes,
  workflows,
}) => {
  const addNode = (type: DmFlowNodeType) => {
    const id = `node_${Date.now().toString(36)}_${nodes.length + 1}`;
    const base: CommentDmFlowNode = {
      node_id: id,
      type,
      label: NODE_TYPE_OPTIONS.find((o) => o.value === type)?.label,
      ...(type === "send_message" ? { messages: ["Aqui está o que combinamos!"] } : {}),
      ...(type === "delay" ? { delay_seconds: 5 } : {}),
      ...(type === "collect_input"
        ? { input_kind: "email", prompt_text: "Qual o seu melhor e-mail?", crm_tags: ["captura_dm"] }
        : {}),
      ...(type === "branch_buttons"
        ? {
            branch_prompt: "Escolha uma opção abaixo:",
            buttons: [
              { id: "b1", label: "Quero o material", kind: "postback" },
              { id: "b2", label: "Falar com consultor", kind: "postback" },
            ],
          }
        : {}),
      ...(type === "send_deliverable_card"
        ? {
            deliverable_id: deliverables[0]?.deliverable_id ?? null,
            card_title: deliverables[0]?.titulo ?? "Material liberado",
            button_text: "Acessar Material",
          }
        : {}),
      ...(type === "trigger_workflow" ? { workflow_id: workflows[0]?.workflow_id ?? null } : {}),
      ...(type === "handoff_agent"
        ? { handoff_agent_id: agentes[0]?.agente_id ?? "estrategista", handoff_greeting: "Oi! Como posso ajudar?" }
        : {}),
    };
    onChange([...nodes, base]);
  };

  const updateAt = (idx: number, patch: Partial<CommentDmFlowNode>) => {
    onChange(nodes.map((n, i) => (i === idx ? { ...n, ...patch } : n)));
  };

  const moveAt = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= nodes.length) return;
    const copy = [...nodes];
    const [removed] = copy.splice(idx, 1);
    copy.splice(target, 0, removed!);
    onChange(copy);
  };

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#131313] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[#31CF76]">
          Etapas 2+ · Sequência Multi-Etapa na DM (somente após janela 24h abrir)
        </span>
        <div className="flex flex-wrap gap-1.5">
          {NODE_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => addNode(opt.value)}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-neutral-200 hover:bg-white/[0.08]"
            >
              <Plus className="h-3 w-3 text-[#31CF76]" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {nodes.length === 0 ? (
        <p className="text-[11px] text-neutral-500">
          Nenhum bloco adicionado ainda. Adicione mensagens, delays, coleta CRM ou entregáveis públicos acima.
        </p>
      ) : (
        <div className="space-y-2.5">
          {nodes.map((node, idx) => (
            <div key={node.node_id} className="rounded-lg border border-white/10 bg-[#191919] p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono">#{idx + 1}</span>
                  <span className="font-semibold text-xs text-white">
                    {NODE_TYPE_OPTIONS.find((o) => o.value === node.type)?.label}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => moveAt(idx, -1)} className="p-1 text-neutral-400 hover:text-white">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => moveAt(idx, 1)} className="p-1 text-neutral-400 hover:text-white">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(nodes.filter((_, i) => i !== idx))}
                    className="p-1 text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {node.type === "send_message" && (
                <textarea
                  rows={2}
                  value={(node.messages ?? []).join("\n")}
                  onChange={(e) => updateAt(idx, { messages: e.target.value.split(/\r?\n/).filter(Boolean) })}
                  placeholder="Variações de mensagem (1 por linha)"
                  className="w-full rounded border border-white/10 bg-[#111] px-2.5 py-1.5 text-xs text-white"
                />
              )}

              {node.type === "delay" && (
                <input
                  type="number"
                  min={1}
                  max={3600}
                  value={node.delay_seconds ?? 5}
                  onChange={(e) => updateAt(idx, { delay_seconds: Number(e.target.value) || 5 })}
                  className="w-36 rounded border border-white/10 bg-[#111] px-2.5 py-1.5 text-xs text-white"
                />
              )}

              {node.type === "collect_input" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <CommentDmSelect
                    value={node.input_kind ?? "email"}
                    onChange={(v) => updateAt(idx, { input_kind: v as CommentDmFlowNode["input_kind"] })}
                    options={[
                      { value: "email", label: "Capturar E-mail -> CRM" },
                      { value: "phone_whatsapp", label: "Capturar WhatsApp -> CRM" },
                      { value: "text", label: "Texto Livre -> CRM" },
                    ]}
                  />
                  <input
                    value={node.prompt_text ?? ""}
                    onChange={(e) => updateAt(idx, { prompt_text: e.target.value })}
                    placeholder="Pergunta enviada ao seguidor"
                    className="rounded border border-white/10 bg-[#111] px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
              )}

              {node.type === "send_deliverable_card" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <CommentDmSelect
                    value={node.deliverable_id ?? ""}
                    onChange={(v) => updateAt(idx, { deliverable_id: v || null })}
                    placeholder="Escolher Entregável Publicado"
                    options={deliverables.map((d) => ({
                      value: d.deliverable_id,
                      label: d.titulo,
                      hint: d.public_https_url,
                    }))}
                  />
                  <input
                    value={node.deliverable_url ?? ""}
                    onChange={(e) => updateAt(idx, { deliverable_url: e.target.value || null })}
                    placeholder="Ou URL HTTPS externa (nunca IP bruto)"
                    className="rounded border border-white/10 bg-[#111] px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
              )}

              {node.type === "trigger_workflow" && (
                <CommentDmSelect
                  value={node.workflow_id ?? ""}
                  onChange={(v) => updateAt(idx, { workflow_id: v || null })}
                  placeholder="Escolher Fluxo Criativo"
                  options={workflows.map((w) => ({ value: w.workflow_id, label: w.nome }))}
                />
              )}

              {node.type === "handoff_agent" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <CommentDmSelect
                    value={node.handoff_agent_id ?? ""}
                    onChange={(v) => updateAt(idx, { handoff_agent_id: v || null })}
                    placeholder="Escolher Criativo IA"
                    options={agentes.map((a) => ({ value: a.agente_id, label: a.nome }))}
                  />
                  <input
                    value={node.handoff_greeting ?? ""}
                    onChange={(e) => updateAt(idx, { handoff_greeting: e.target.value })}
                    placeholder="Saudação de entrada do Criativo"
                    className="rounded border border-white/10 bg-[#111] px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
