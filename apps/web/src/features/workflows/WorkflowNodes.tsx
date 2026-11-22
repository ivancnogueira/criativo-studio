import React, { useRef, useState } from "react";
import {
  WORKFLOW_PORTS,
  normalizeNodeKind,
  type AgenteRegistro,
  type ArquivoStudio,
  type CanalEquipe,
  type ProvedorStatusInfo,
  type WorkflowBranch,
  type WorkflowNo,
  type WorkflowOutputTarget,
  type WorkflowPortType,
  type WorkflowShapeKind,
  type WorkflowTriggerKind,
  type WorkflowTriggerState,
} from "@criativo/contracts";
import {
  Copy,
  Lock,
  Play,
  RotateCcw,
  SkipForward,
  StickyNote,
  Trash2,
  Unlock,
} from "lucide-react";
import {
  WORKFLOW_PORT_META,
  WORKFLOW_STATUS_META,
  getWorkflowNodeWidth,
  type WorkflowNodeRunView,
} from "./workflow-canvas-helpers";
import {
  CarbonMenuPicker,
  NOTE_PALETTE,
  NodeHeaderIcon,
  SHAPE_OPTIONS,
  renderShapeSvg,
  type PopoverOption,
} from "./workflow-node-helpers";
import { WorkflowNodeBasicFields } from "./WorkflowNodeBasicFields";
import { WorkflowNodeActionFields } from "./WorkflowNodeActionFields";

export interface WorkflowNodeCardProps {
  node: WorkflowNo;
  selected: boolean;
  readOnly?: boolean;
  agentes: AgenteRegistro[];
  canais: CanalEquipe[];
  arquivos: ArquivoStudio[];
  provedores: ProvedorStatusInfo[];
  nodeRunView?: WorkflowNodeRunView;
  triggerState?: WorkflowTriggerState | null;
  connectingFrom?: { nodeId: string; branch?: WorkflowBranch | null } | null;
  onPointerDownNode: (e: React.PointerEvent, node: WorkflowNo) => void;
  onSelectNode: (nodeId: string) => void;
  onPatchNode: (nodeId: string, patch: Partial<WorkflowNo>) => void;
  onDeleteNode: (nodeId: string) => void;
  onDuplicateNode: (node: WorkflowNo) => void;
  onToggleLockNode: (node: WorkflowNo) => void;
  onStartConnect: (nodeId: string, branch?: WorkflowBranch | null, portType?: WorkflowPortType) => void;
  onFinishConnect: (targetNodeId: string) => void;
  onExecuteStep?: (nodeId: string) => void;
  onStartFromNode?: (nodeId: string) => void;
  onRetryStep?: (stepId: string) => void;
  onDecideStep?: (stepId: string, approved: boolean) => void;
  onOpenTriggerModal?: (node: WorkflowNo) => void;
  onUploadFile?: (file: File) => Promise<void>;
}

export const WorkflowNodeCard: React.FC<WorkflowNodeCardProps> = ({
  node,
  selected,
  readOnly = false,
  agentes,
  canais,
  arquivos,
  provedores,
  nodeRunView,
  triggerState,
  connectingFrom,
  onPointerDownNode,
  onSelectNode,
  onPatchNode,
  onDeleteNode,
  onDuplicateNode,
  onToggleLockNode,
  onStartConnect,
  onFinishConnect,
  onExecuteStep,
  onStartFromNode,
  onRetryStep,
  onDecideStep,
  onOpenTriggerModal,
  onUploadFile,
}) => {
  const kind = normalizeNodeKind(node.tipo);
  const cfg = node.config ?? {};
  const width = getWorkflowNodeWidth(node);
  const ports = WORKFLOW_PORTS[kind];
  const [assetMenuOpen, setAssetMenuOpen] = useState(false);
  const [assetTab, setAssetTab] = useState<"recentes" | "imagens" | "arquivos">("recentes");
  const [assetSearch, setAssetSearch] = useState("");
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [systemPromptOpen, setSystemPromptOpen] = useState(Boolean(node.systemPrompt));
  const [copiedNotice, setCopiedNotice] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const statusMeta = nodeRunView ? WORKFLOW_STATUS_META[nodeRunView.status] : null;
  const isRunning = nodeRunView?.status === "running";
  const isApprovalPaused = nodeRunView?.status === "approval";

  const borderClass = selected
    ? "border-[#007CF7] ring-1 ring-[#007CF7]/60"
    : isApprovalPaused
      ? "border-[#FF9412]"
      : isRunning
        ? "border-[#007CF7] animate-pulse"
        : "border-white/[0.06] hover:border-white/[0.12]";

  // Nós de anotação puros (`text`, `shape`, `nota`)
  if (kind === "nota") {
    const toneId = typeof cfg.tone === "string" ? cfg.tone : "amber";
    const toneObj = NOTE_PALETTE.find((t) => t.id === toneId) ?? NOTE_PALETTE[0];
    return (
      <div
        style={{ left: node.x, top: node.y, width }}
        onPointerDown={(e) => onPointerDownNode(e, node)}
        onClick={(e) => {
          e.stopPropagation();
          onSelectNode(node.id);
        }}
        className={`absolute rounded-xl border p-4 shadow-lg select-none ${toneObj.bg} ${
          selected ? "ring-2 ring-[#007CF7]" : ""
        }`}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-[12px] font-semibold">
            <StickyNote className="h-3.5 w-3.5" />
            <span>Nota</span>
          </div>
          {!readOnly && (
            <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
              {NOTE_PALETTE.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-label={`Aplicar cor ${t.id}`}
                  onClick={() => onPatchNode(node.id, { config: { ...cfg, tone: t.id } })}
                  className={`h-3 w-3 rounded-full border border-white/20 ${
                    t.id === toneId ? "ring-1 ring-[#007CF7]" : ""
                  }`}
                />
              ))}
              <button
                type="button"
                aria-label="Remover nó"
                onClick={() => onDeleteNode(node.id)}
                className="ml-1 rounded p-1 text-[#979797] hover:text-[#FD2F3B]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
        <textarea
          readOnly={readOnly}
          value={node.subtitulo ?? (typeof cfg.texto === "string" ? cfg.texto : node.titulo)}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) =>
            onPatchNode(node.id, {
              subtitulo: e.target.value,
              config: { ...cfg, texto: e.target.value },
            })
          }
          rows={4}
          placeholder="Escreva uma nota visual no fluxo..."
          className="w-full resize-none rounded-lg bg-black/20 p-2 text-[14px] font-normal text-current placeholder:text-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
        />
      </div>
    );
  }

  if (kind === "text") {
    return (
      <div
        style={{ left: node.x, top: node.y, width }}
        onPointerDown={(e) => onPointerDownNode(e, node)}
        onClick={(e) => {
          e.stopPropagation();
          onSelectNode(node.id);
        }}
        className={`absolute rounded-xl border p-2 select-none ${
          selected ? "border-[#007CF7] bg-[#212121]/70" : "border-transparent hover:border-white/[0.06]"
        }`}
      >
        <input
          type="text"
          readOnly={readOnly}
          value={node.titulo}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => onPatchNode(node.id, { titulo: e.target.value })}
          placeholder="Título da seção..."
          className="w-full bg-transparent text-[28px] font-semibold text-white placeholder:text-[#6A6A6A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
        />
      </div>
    );
  }

  if (kind === "shape") {
    const shapeKind: WorkflowShapeKind = node.shape ?? "rectangle";
    const shapeColor = node.color ?? "#42A0FF";
    return (
      <div
        style={{ left: node.x, top: node.y, width }}
        onPointerDown={(e) => onPointerDownNode(e, node)}
        onClick={(e) => {
          e.stopPropagation();
          onSelectNode(node.id);
        }}
        className={`absolute rounded-xl border bg-[#212121]/85 p-2 shadow-lg select-none ${borderClass}`}
      >
        {selected && !readOnly && (
          <div className="mb-2 flex items-center justify-between gap-2" onPointerDown={(e) => e.stopPropagation()}>
            <CarbonMenuPicker
              value={shapeKind}
              options={SHAPE_OPTIONS}
              ariaLabel="Alterar forma"
              onChange={(nextShape) => onPatchNode(node.id, { shape: nextShape })}
            />
            <button
              type="button"
              aria-label="Remover nó"
              onClick={() => onDeleteNode(node.id)}
              className="rounded-lg p-1 text-[#979797] hover:bg-[#2A2A2A] hover:text-[#FD2F3B]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="relative flex h-28 w-full items-center justify-center">
          <svg viewBox="0 0 100 100" className="h-24 w-24">
            {renderShapeSvg(shapeKind, shapeColor)}
          </svg>
          <input
            type="text"
            readOnly={readOnly}
            value={node.titulo}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => onPatchNode(node.id, { titulo: e.target.value })}
            className="absolute inset-x-4 bg-transparent text-center text-[14px] font-semibold text-white focus-visible:outline-none"
          />
        </div>
      </div>
    );
  }

  // Nós executáveis
  const triggerKind: WorkflowTriggerKind =
    node.triggerKind ??
    node.trigger?.kind ??
    (typeof cfg.triggerKind === "string" ? (cfg.triggerKind as WorkflowTriggerKind) : "manual");
  const modelOptions: Array<PopoverOption<string>> = [
    { value: "", label: "Automático (Padrão do Estúdio)" },
    ...provedores
      .filter((p) => p.conectado)
      .flatMap((p) =>
        p.modelos.map((m) => ({
          value: m.id,
          label: `${p.rotulo} · ${m.rotulo}`,
          subtitle: p.provedor,
        }))
      ),
  ];

  const selectedFileId =
    node.fileId ?? (typeof cfg.fileId === "string" ? cfg.fileId : undefined);
  const selectedAsset = arquivos.find(
    (a) => a.arquivo_id === selectedFileId || a.caminho_relativo === selectedFileId
  );
  const filteredAssets = arquivos.filter((a) => {
    if (assetTab === "imagens" && !a.mime_type.startsWith("image/")) return false;
    if (assetTab === "arquivos" && a.mime_type.startsWith("image/")) return false;
    if (assetSearch.trim()) {
      return a.nome_original.toLowerCase().includes(assetSearch.trim().toLowerCase());
    }
    return true;
  });

  const chosenAgentId =
    node.agenteId ??
    (typeof cfg.agenteId === "string" ? cfg.agenteId : undefined) ??
    agentes[0]?.agente_id ??
    "estrategista";
  const chosenAgent = agentes.find((a) => a.agente_id === chosenAgentId) ?? agentes[0];

  const outputTarget: WorkflowOutputTarget =
    node.target ??
    (typeof cfg.target === "string" ? (cfg.target as WorkflowOutputTarget) : "notificacao");
  const outputTargetRef =
    node.targetRef ?? (typeof cfg.targetRef === "string" ? cfg.targetRef : "");

  return (
    <div
      style={{ left: node.x, top: node.y, width }}
      onPointerDown={(e) => onPointerDownNode(e, node)}
      onClick={(e) => {
        e.stopPropagation();
        onSelectNode(node.id);
      }}
      className={`absolute rounded-xl border bg-[#212121] p-2 shadow-2xl transition-colors select-none ${borderClass}`}
    >
      {/* Barra contextual superior do nó selecionado */}
      {selected && !readOnly && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute -top-11 left-0 z-30 flex items-center gap-1 rounded-xl border border-white/[0.12] bg-[#212121] p-1 shadow-2xl whitespace-nowrap"
        >
          {onExecuteStep && (
            <button
              type="button"
              onClick={() => onExecuteStep(node.id)}
              className="flex items-center gap-1 rounded-lg bg-[#2A2A2A] px-2 py-1 text-[12px] font-semibold text-white hover:bg-[#F0F0F0] hover:text-[#141414]"
            >
              <Play className="h-3 w-3" />
              <span>Executar etapa</span>
            </button>
          )}
          {onStartFromNode && (
            <button
              type="button"
              onClick={() => onStartFromNode(node.id)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-normal text-[#DCDCDC] hover:bg-[#2A2A2A]"
            >
              <SkipForward className="h-3 w-3 text-[#42A0FF]" />
              <span>Executar a partir daqui</span>
            </button>
          )}
          {onRetryStep &&
            nodeRunView &&
            (nodeRunView.status === "failed" || nodeRunView.status === "stopped") && (
              <button
                type="button"
                onClick={() => onRetryStep(nodeRunView.stepId)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold text-[#FF9412] hover:bg-[#2A2A2A]"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Retentar etapa</span>
              </button>
            )}
          <button
            type="button"
            aria-label={node.locked ? "Desbloquear nó" : "Bloquear nó"}
            onClick={() => onToggleLockNode(node)}
            className="rounded-lg p-1 text-[#979797] hover:bg-[#2A2A2A] hover:text-white"
            title={node.locked ? "Desbloquear nó" : "Bloquear nó"}
          >
            {node.locked ? <Lock className="h-3.5 w-3.5 text-[#FF9412]" /> : <Unlock className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            aria-label="Duplicar nó"
            onClick={() => onDuplicateNode(node)}
            className="rounded-lg p-1 text-[#979797] hover:bg-[#2A2A2A] hover:text-white"
            title="Duplicar nó"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Remover nó"
            onClick={() => onDeleteNode(node.id)}
            className="rounded-lg p-1 text-[#979797] hover:bg-[#2A2A2A] hover:text-[#FD2F3B]"
            title="Remover nó"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Portas de entrada à esquerda */}
      {ports.in.length > 0 && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (connectingFrom) onFinishConnect(node.id);
          }}
          title={`Entrada: ${ports.in.map((p) => WORKFLOW_PORT_META[p].label).join(", ")}`}
          aria-label={`Conectar entrada de ${node.titulo}`}
          className={`absolute -left-2.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border bg-[#141414] transition-transform hover:scale-110 ${
            connectingFrom && connectingFrom.nodeId !== node.id
              ? "border-[#007CF7] ring-2 ring-[#007CF7]/50"
              : "border-white/[0.12]"
          }`}
        >
          <span
            className={`h-2.5 w-2.5 ${WORKFLOW_PORT_META[ports.in[0]].shapeClass}`}
            style={{ backgroundColor: WORKFLOW_PORT_META[ports.in[0]].color }}
          />
        </button>
      )}

      {/* Portas de saída à direita (exceto condition que tem ramos próprios) */}
      {ports.out.length > 0 && kind !== "condition" && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (!readOnly) onStartConnect(node.id, null, ports.out[0]);
          }}
          title={`Saída: ${ports.out.map((p) => WORKFLOW_PORT_META[p].label).join(", ")}`}
          aria-label={`Conectar saída de ${node.titulo}`}
          className={`absolute -right-2.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border bg-[#141414] transition-transform hover:scale-110 ${
            connectingFrom?.nodeId === node.id
              ? "border-[#007CF7] ring-2 ring-[#007CF7]/50"
              : "border-white/[0.12]"
          }`}
        >
          <span
            className={`h-2.5 w-2.5 ${WORKFLOW_PORT_META[ports.out[0]].shapeClass}`}
            style={{ backgroundColor: WORKFLOW_PORT_META[ports.out[0]].color }}
          />
        </button>
      )}

      {/* Cabeçalho do card */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <NodeHeaderIcon tipo={node.tipo} />
          <input
            type="text"
            readOnly={readOnly}
            value={node.titulo}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => onPatchNode(node.id, { titulo: e.target.value })}
            className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#007CF7]"
          />
        </div>
        {statusMeta && (
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[12px] font-semibold ${statusMeta.badgeBgClass} ${statusMeta.badgeTextClass}`}
          >
            {statusMeta.label}
          </span>
        )}
      </div>

      {/* Corpo especializado por tipo de nó */}

      <WorkflowNodeBasicFields
        props={{
          node,
          selected,
          readOnly,
          agentes,
          canais,
          arquivos,
          provedores,
          nodeRunView,
          triggerState,
          connectingFrom,
          onPointerDownNode,
          onSelectNode,
          onPatchNode,
          onDeleteNode,
          onDuplicateNode,
          onToggleLockNode,
          onStartConnect,
          onFinishConnect,
          onExecuteStep,
          onStartFromNode,
          onRetryStep,
          onDecideStep,
          onOpenTriggerModal,
          onUploadFile,
        }}
        kind={kind}
        cfg={cfg}
        triggerKind={triggerKind}
        modelOptions={modelOptions}
        selectedAsset={selectedAsset}
        filteredAssets={filteredAssets}
        assetMenuOpen={assetMenuOpen}
        setAssetMenuOpen={setAssetMenuOpen}
        assetTab={assetTab}
        setAssetTab={setAssetTab}
        assetSearch={assetSearch}
        setAssetSearch={setAssetSearch}
        copiedNotice={copiedNotice}
        setCopiedNotice={setCopiedNotice}
        fileInputRef={fileInputRef}
        systemPromptOpen={systemPromptOpen}
        setSystemPromptOpen={setSystemPromptOpen}
      />

      <WorkflowNodeActionFields
        props={{
          node,
          selected,
          readOnly,
          agentes,
          canais,
          arquivos,
          provedores,
          nodeRunView,
          triggerState,
          connectingFrom,
          onPointerDownNode,
          onSelectNode,
          onPatchNode,
          onDeleteNode,
          onDuplicateNode,
          onToggleLockNode,
          onStartConnect,
          onFinishConnect,
          onExecuteStep,
          onStartFromNode,
          onRetryStep,
          onDecideStep,
          onOpenTriggerModal,
          onUploadFile,
        }}
        kind={kind}
        cfg={cfg}
        modelOptions={modelOptions}
        chosenAgentId={chosenAgentId}
        chosenAgent={chosenAgent}
        isApprovalPaused={isApprovalPaused}
        agentMenuOpen={agentMenuOpen}
        setAgentMenuOpen={setAgentMenuOpen}
        systemPromptOpen={systemPromptOpen}
        setSystemPromptOpen={setSystemPromptOpen}
        outputTarget={outputTarget}
        outputTargetRef={outputTargetRef}
      />

      {/* Resumo compacto da última execução do nó (para llm/agente/prompt/output/etc) */}
      {nodeRunView && (nodeRunView.output || nodeRunView.erro) && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className={`mt-2 rounded-lg border px-2 py-1 text-[12px] ${
            nodeRunView.erro
              ? "border-[#FD2F3B]/40 bg-[#FD2F3B]/10 text-[#FD2F3B]"
              : "border-white/[0.06] bg-[#101010] text-[#979797]"
          }`}
        >
          <p className="line-clamp-2 break-words">
            {nodeRunView.erro ? nodeRunView.erro : nodeRunView.output}
          </p>
        </div>
      )}
    </div>
  );
};
