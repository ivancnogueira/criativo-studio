import React, { useEffect, useMemo, useState } from "react";
import type {
  AgenteRegistro,
  MediaProviderDescriptor,
  ProviderName,
  WorkflowAnswerField,
  WorkflowConditionMode,
  WorkflowDeterministicRule,
  WorkflowOutputTarget,
} from "@criativo/contracts";
import { daemonApi } from "../../services/websocket-client";
import {
  Check,
  ChevronDown,
} from "lucide-react";
import {
  MascoteAvatar,
  resolveAgentAvatarConfig,
} from "../../components/MascoteAvatar";
import { ProviderLogo } from "../../components/ProviderLogo";
import { WORKFLOW_PORT_META } from "./workflow-canvas-helpers";
import { collectAvailableNodeTokens } from "./workflow-variable-catalog";
import { WorkflowAnswerFieldsEditor } from "./WorkflowAnswerFieldsEditor";
import { WorkflowBatchGallery } from "./WorkflowBatchGallery";
import { WorkflowConditionEditor } from "./WorkflowConditionEditor";
import { WorkflowTokenTextarea } from "./WorkflowTokenTextarea";
import {
  CarbonMenuPicker,
  EFFORT_OPTIONS,
  OUTPUT_TARGET_OPTIONS,
  type PopoverOption,
} from "./workflow-node-helpers";
import type { WorkflowNodeCardProps } from "./WorkflowNodes";

export interface WorkflowNodeActionFieldsProps {
  props: WorkflowNodeCardProps;
  kind: string;
  cfg: Record<string, unknown>;
  modelOptions: Array<PopoverOption<string>>;
  chosenAgentId: string;
  chosenAgent: AgenteRegistro | undefined;
  isApprovalPaused: boolean;
  agentMenuOpen: boolean;
  setAgentMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  systemPromptOpen: boolean;
  setSystemPromptOpen: React.Dispatch<React.SetStateAction<boolean>>;
  outputTarget: WorkflowOutputTarget;
  outputTargetRef: string;
}

export function WorkflowNodeActionFields(ctx: WorkflowNodeActionFieldsProps) {
  const [mediaCatalog, setMediaCatalog] = useState<MediaProviderDescriptor[]>([]);

  useEffect(() => {
    if (ctx.kind !== "gerar_imagem" && ctx.kind !== "render_video") return;
    let active = true;
    daemonApi
      .listWorkflowMediaProviders()
      .then((list) => {
        if (active && Array.isArray(list)) {
          setMediaCatalog(list);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [ctx.kind]);

  const mediaOptions = useMemo(() => {
    const desiredKind = ctx.kind === "render_video" ? "video" : "image";
    const matching = mediaCatalog.filter((m) => m.kind === desiredKind);
    const defaults: Array<PopoverOption<string>> =
      desiredKind === "video"
        ? [
            { value: "", label: "Padrão (Remotion)" },
            { value: "native:remotion", label: "Remotion Cinematográfico (Nativo)" },
            { value: "native:gemini-video", label: "Gemini Video Interactions (Nativo)" },
          ]
        : [
            { value: "", label: "Padrão (Automático)" },
            { value: "native:gemini", label: "Gemini Imagen / Nano (Nativo)" },
            { value: "native:openai", label: "OpenAI GPT Image (Nativo)" },
            { value: "native:flux", label: "Flux / Fal.ai (Nativo)" },
          ];
    if (matching.length === 0) return defaults;
    return [
      { value: "", label: "Padrão (Automático)" },
      ...matching.map((m) => ({
        value: m.id,
        label: m.label,
        hint: m.models[0],
      })),
    ];
  }, [ctx.kind, mediaCatalog]);

  const {
    node,
    readOnly = false,
    agentes,
    canais,
    nodeRunView,
    connectingFrom,
    onPatchNode,
    onStartConnect,
    onDecideStep,
  } = ctx.props;
  const {
    kind,
    cfg,
    modelOptions,
    chosenAgentId,
    chosenAgent,
    isApprovalPaused,
    agentMenuOpen,
    setAgentMenuOpen,
    systemPromptOpen,
    setSystemPromptOpen,
    outputTarget,
    outputTargetRef,
  } = ctx;

  return (
    <>
      {kind === "agente" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <div className="relative">
            <button
              type="button"
              disabled={readOnly}
              aria-expanded={agentMenuOpen}
              aria-haspopup="listbox"
              aria-label="Selecionar especialista do fluxo"
              onClick={() => !readOnly && setAgentMenuOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/[0.12] bg-[#242424] px-2 py-1 text-left text-[12px] font-semibold text-white hover:bg-[#2A2A2A]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <MascoteAvatar
                  avatar={resolveAgentAvatarConfig(chosenAgent, chosenAgentId)}
                  agentKey={chosenAgentId}
                  size={20}
                />
                <span className="truncate">{chosenAgent?.nome ?? chosenAgentId}</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-[#979797]" />
            </button>
            {agentMenuOpen && (
              <div
                role="listbox"
                className="absolute left-0 top-full z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-white/[0.12] bg-[#212121] p-1 shadow-2xl"
              >
                {agentes.map((ag) => {
                  return (
                    <button
                      key={ag.agente_id}
                      type="button"
                      role="option"
                      aria-selected={ag.agente_id === chosenAgentId}
                      onClick={() => {
                        onPatchNode(node.id, {
                          agenteId: ag.agente_id,
                          config: { ...cfg, agenteId: ag.agente_id },
                        });
                        setAgentMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12px] text-[#DCDCDC] hover:bg-[#2A2A2A]"
                    >
                      <MascoteAvatar
                        avatar={resolveAgentAvatarConfig(ag)}
                        agentKey={ag.agente_id}
                        size={18}
                      />
                      <span className="truncate">{ag.nome}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <WorkflowTokenTextarea
            nodeId={node.id}
            allNodes={ctx.props.allNodes}
            allEdges={ctx.props.allEdges}
            readOnly={readOnly}
            rows={2}
            value={node.prompt ?? (typeof cfg.prompt === "string" ? cfg.prompt : "")}
            onChange={(nextPrompt) =>
              onPatchNode(node.id, {
                prompt: nextPrompt,
                config: { ...cfg, prompt: nextPrompt },
              })
            }
            placeholder="Briefing do especialista (digite {{ para campos)..."
          />
          <WorkflowAnswerFieldsEditor
            fields={
              Array.isArray(node.answerFields)
                ? node.answerFields
                : Array.isArray(cfg.answerFields)
                  ? (cfg.answerFields as WorkflowAnswerField[])
                  : []
            }
            disabled={readOnly}
            onChange={(nextFields) =>
              onPatchNode(node.id, {
                answerFields: nextFields,
                config: { ...cfg, answerFields: nextFields },
              })
            }
          />
        </div>
      )}

      {(kind === "gerar_imagem" || kind === "render_video") && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <CarbonMenuPicker
            value={
              node.mediaProviderId ??
              (typeof cfg.mediaProviderId === "string" ? cfg.mediaProviderId : "")
            }
            disabled={readOnly}
            options={mediaOptions}
            ariaLabel={
              kind === "gerar_imagem"
                ? "Selecionar provedor de imagem"
                : "Selecionar provedor de vídeo"
            }
            onChange={(provId) =>
              onPatchNode(node.id, {
                mediaProviderId: provId || undefined,
                config: { ...cfg, mediaProviderId: provId || undefined },
              })
            }
          />
          <WorkflowTokenTextarea
            nodeId={node.id}
            allNodes={ctx.props.allNodes}
            allEdges={ctx.props.allEdges}
            readOnly={readOnly}
            rows={2}
            value={node.prompt ?? (typeof cfg.prompt === "string" ? cfg.prompt : "")}
            onChange={(nextPrompt) =>
              onPatchNode(node.id, {
                prompt: nextPrompt,
                config: { ...cfg, prompt: nextPrompt },
              })
            }
            placeholder={
              kind === "gerar_imagem"
                ? "Direção visual / composição (use {{campo}})..."
                : "Instrução / estilo do vídeo Reels MP4..."
            }
          />
          <WorkflowBatchGallery
            kind={kind === "render_video" ? "render_video" : "gerar_imagem"}
            stepId={nodeRunView?.stepId}
            batchCount={
              node.batchCount === 2 || node.batchCount === 3 || node.batchCount === 4
                ? node.batchCount
                : 1
            }
            selectedVariantIndex={node.selectedVariantIndex ?? 0}
            variants={nodeRunView?.variants}
            readOnly={readOnly}
            onChangeBatchCount={(count) =>
              onPatchNode(node.id, {
                batchCount: count,
                config: { ...cfg, batchCount: count },
              })
            }
            onSelectPrimaryVariant={(slotIndex) =>
              onPatchNode(node.id, {
                selectedVariantIndex: slotIndex,
                config: { ...cfg, selectedVariantIndex: slotIndex },
              })
            }
            onVariantRetried={() => {
              void ctx.props.onRefreshRunData?.();
            }}
          />
        </div>
      )}

      {kind === "condition" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <WorkflowConditionEditor
            mode={
              node.conditionMode ??
              (cfg.conditionMode === "deterministic" ? "deterministic" : "ai")
            }
            ruleText={node.rule ?? (typeof cfg.rule === "string" ? cfg.rule : "")}
            deterministicRule={
              node.deterministicRule ??
              (cfg.deterministicRule as WorkflowDeterministicRule | undefined)
            }
            modelValue={node.model ?? ""}
            modelOptions={modelOptions}
            availableTokens={collectAvailableNodeTokens(
              node.id,
              ctx.props.allNodes ?? [],
              ctx.props.allEdges ?? []
            )}
            readOnly={readOnly}
            onChangeMode={(nextMode: WorkflowConditionMode) =>
              onPatchNode(node.id, {
                conditionMode: nextMode,
                config: { ...cfg, conditionMode: nextMode },
              })
            }
            onChangeRuleText={(nextRuleText) =>
              onPatchNode(node.id, {
                rule: nextRuleText,
                config: { ...cfg, rule: nextRuleText },
              })
            }
            onChangeDeterministicRule={(nextDetRule) =>
              onPatchNode(node.id, {
                deterministicRule: nextDetRule,
                config: { ...cfg, deterministicRule: nextDetRule },
              })
            }
            onChangeModel={(m) =>
              onPatchNode(node.id, { model: m || undefined, config: { ...cfg, model: m } })
            }
          />
          {/* Duas linhas dedicadas de saída Sim / Não à direita */}
          <div className="space-y-1 pt-1">
            {(["yes", "no"] as const).map((branchVal) => {
              const isYes = branchVal === "yes";
              const chosen = nodeRunView?.branch === branchVal;
              return (
                <div
                  key={branchVal}
                  className={`relative flex items-center justify-between rounded-lg border px-2 py-1 text-[12px] ${
                    chosen
                      ? isYes
                        ? "border-[#31CF76]/50 bg-[#31CF76]/15 font-semibold text-[#31CF76]"
                        : "border-[#FD2F3B]/50 bg-[#FD2F3B]/15 font-semibold text-[#FD2F3B]"
                      : "border-white/[0.06] bg-[#242424] text-[#DCDCDC]"
                  }`}
                >
                  <span className="flex items-center gap-1">
                    {chosen && <Check className="h-3 w-3" />}
                    <span>{isYes ? "Sim" : "Não"}</span>
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!readOnly) onStartConnect(node.id, branchVal, "text");
                    }}
                    title={`Saída ${isYes ? "Sim" : "Não"} (Texto)`}
                    aria-label={`Conectar saída ${isYes ? "Sim" : "Não"} de ${node.titulo}`}
                    className={`-mr-4 flex h-4 w-4 items-center justify-center rounded-full border bg-[#141414] ${
                      connectingFrom?.nodeId === node.id && connectingFrom?.branch === branchVal
                        ? "border-[#007CF7] ring-2 ring-[#007CF7]"
                        : isYes
                          ? "border-[#31CF76]"
                          : "border-[#FD2F3B]"
                    }`}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: isYes ? "#31CF76" : "#FD2F3B" }}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {kind === "approval" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <textarea
            readOnly={readOnly}
            rows={2}
            value={node.question ?? (typeof cfg.question === "string" ? cfg.question : "")}
            onChange={(e) =>
              onPatchNode(node.id, {
                question: e.target.value,
                config: { ...cfg, question: e.target.value },
              })
            }
            placeholder="Revisar criativo antes da publicação oficial?"
            className="w-full resize-none rounded-lg border border-white/[0.06] bg-[#242424] p-2 text-[14px] text-[#DCDCDC] placeholder:text-[#6A6A6A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
          />
          {isApprovalPaused && nodeRunView && onDecideStep && (
            <div className="space-y-2 rounded-lg border border-[#FF9412]/50 bg-[#FF9412]/10 p-2">
              <p className="text-[12px] font-semibold text-[#FF9412]">
                Aguardando decisão humana
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onDecideStep(nodeRunView.stepId, true)}
                  className="flex-1 rounded-lg bg-[#F0F0F0] px-2 py-1 text-[12px] font-semibold text-[#141414] hover:bg-white"
                >
                  Aprovar etapa
                </button>
                <button
                  type="button"
                  onClick={() => onDecideStep(nodeRunView.stepId, false)}
                  className="flex-1 rounded-lg bg-[#2A2A2A] px-2 py-1 text-[12px] font-semibold text-white hover:bg-[#FD2F3B]/30"
                >
                  Rejeitar etapa
                </button>
              </div>
            </div>
          )}
          {nodeRunView?.status === "done" && nodeRunView.encerradoEm && (
            <p className="text-[12px] font-semibold text-[#31CF76]">
              Aprovado às{" "}
              {new Date(nodeRunView.encerradoEm).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
          {nodeRunView?.status === "stopped" && (
            <p className="text-[12px] font-semibold text-[#FD2F3B]">Rejeitado</p>
          )}
        </div>
      )}

      {kind === "output" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <CarbonMenuPicker
            value={outputTarget}
            disabled={readOnly}
            options={OUTPUT_TARGET_OPTIONS}
            ariaLabel="Selecionar destino de saída"
            onChange={(nextTarget) =>
              onPatchNode(node.id, {
                target: nextTarget,
                config: { ...cfg, target: nextTarget },
              })
            }
          />
          {outputTarget === "canal" && (
            <CarbonMenuPicker
              value={outputTargetRef || (canais[0]?.canal_id ?? "")}
              disabled={readOnly}
              options={
                canais.length > 0
                  ? canais.map((c) => ({ value: c.canal_id, label: c.nome }))
                  : [{ value: "canal-geral", label: "Canal Geral" }]
              }
              ariaLabel="Selecionar canal de destino"
              onChange={(refVal) =>
                onPatchNode(node.id, {
                  targetRef: refVal,
                  config: { ...cfg, targetRef: refVal },
                })
              }
            />
          )}
          {(outputTarget === "whatsapp" ||
            outputTarget === "telegram" ||
            outputTarget === "slack" ||
            outputTarget === "discord" ||
            outputTarget === "github" ||
            outputTarget === "arquivo") && (
            <input
              type="text"
              readOnly={readOnly}
              value={outputTargetRef}
              onChange={(e) =>
                onPatchNode(node.id, {
                  targetRef: e.target.value,
                  config: { ...cfg, targetRef: e.target.value },
                })
              }
              placeholder={
                outputTarget === "whatsapp"
                  ? "Número ou JID de destino..."
                  : outputTarget === "telegram"
                    ? "Chat ID Telegram (ou padrão do Cofre)"
                    : outputTarget === "slack"
                      ? "#canal ou Channel ID no Slack..."
                      : outputTarget === "discord"
                        ? "Channel ID ou Webhook Discord..."
                        : outputTarget === "github"
                          ? "owner/repositorio (ex: org/repo)..."
                          : "Nome em saidas/workflows/..."
              }
              className="w-full rounded-lg border border-white/[0.06] bg-[#242424] px-2 py-1 text-[12px] text-[#DCDCDC] placeholder:text-[#6A6A6A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
            />
          )}
          {outputTarget === "instagram" && (
            <p className="rounded-lg border border-[#FF9412]/30 bg-[#FF9412]/10 p-2 text-[12px] text-[#FF9412]">
              Exige nó de aprovação humana aprovado a montante antes de publicar na Meta API.
            </p>
          )}
        </div>
      )}
    </>
  );
}
