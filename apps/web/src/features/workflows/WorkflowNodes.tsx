import React, { useEffect, useRef, useState } from "react";
import {
  WORKFLOW_PORTS,
  normalizeNodeKind,
  type AgenteRegistro,
  type ArquivoStudio,
  type CanalEquipe,
  type ProvedorStatusInfo,
  type ProviderName,
  type WorkflowBranch,
  type WorkflowNo,
  type WorkflowOutputTarget,
  type WorkflowPortType,
  type WorkflowShapeKind,
  type WorkflowTriggerKind,
  type WorkflowTriggerState,
} from "@criativo/contracts";
import {
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  FileText,
  Film,
  GitBranch,
  Image as ImageIcon,
  Lock,
  Play,
  RotateCcw,
  Send,
  Settings2,
  SkipForward,
  Sparkles,
  StickyNote,
  Trash2,
  Type,
  Unlock,
  Upload,
  Zap,
} from "lucide-react";
import {
  MascoteAvatar,
  resolveAgentAvatarConfig,
} from "../../components/MascoteAvatar";
import { ProviderLogo } from "../../components/ProviderLogo";
import {
  WORKFLOW_PORT_META,
  WORKFLOW_STATUS_META,
  getWorkflowNodeWidth,
  type WorkflowNodeRunView,
} from "./workflow-canvas-helpers";

interface PopoverOption<T extends string> {
  value: T;
  label: string;
  subtitle?: string;
}

interface CarbonMenuPickerProps<T extends string> {
  value: T;
  options: Array<PopoverOption<T>>;
  onChange: (next: T) => void;
  disabled?: boolean;
  ariaLabel: string;
  renderTrigger?: (selected: PopoverOption<T> | undefined) => React.ReactNode;
}

function CarbonMenuPicker<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  renderTrigger,
}: CarbonMenuPickerProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDocDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDocDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => !disabled && setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/[0.12] bg-[#242424] px-2 py-1 text-left text-[12px] font-normal text-[#DCDCDC] hover:bg-[#2A2A2A] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
      >
        <span className="truncate">
          {renderTrigger ? renderTrigger(selected) : (selected?.label ?? String(value))}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#979797]" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 top-full z-50 mt-1 max-h-60 w-full min-w-[210px] overflow-y-auto rounded-xl border border-white/[0.12] bg-[#212121] p-1 shadow-2xl"
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-[12px] ${
                  active
                    ? "bg-[#2A2A2A] font-semibold text-white"
                    : "font-normal text-[#DCDCDC] hover:bg-[#2A2A2A]/70"
                }`}
              >
                <span className="min-w-0 truncate">
                  <span className="block truncate">{opt.label}</span>
                  {opt.subtitle && (
                    <span className="block truncate text-[12px] text-[#979797]">
                      {opt.subtitle}
                    </span>
                  )}
                </span>
                {active && <Check className="h-3.5 w-3.5 shrink-0 text-[#42A0FF]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const TRIGGER_KIND_OPTIONS: Array<PopoverOption<WorkflowTriggerKind>> = [
  { value: "schedule", label: "Agendado", subtitle: "Frequência IANA" },
  { value: "manual", label: "Manual", subtitle: "Disparo sob demanda" },
  { value: "webhook", label: "Webhook HTTP", subtitle: "Assinado por HMAC-SHA256" },
  { value: "whatsapp", label: "WhatsApp", subtitle: "Mensagem recebida" },
  { value: "telegram", label: "Telegram", subtitle: "Bot / comando" },
  { value: "conector", label: "Conector externo", subtitle: "Eventos integrados" },
];

const OUTPUT_TARGET_OPTIONS: Array<PopoverOption<WorkflowOutputTarget>> = [
  { value: "canal", label: "Canal em Equipe" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "telegram", label: "Telegram" },
  { value: "slack", label: "Slack" },
  { value: "discord", label: "Discord" },
  { value: "github", label: "GitHub" },
  { value: "arquivo", label: "Arquivo no Workspace" },
  { value: "instagram", label: "Instagram Meta" },
  { value: "notificacao", label: "Notificação Cockpit" },
];

const EFFORT_OPTIONS: Array<PopoverOption<"baixo" | "medio" | "alto">> = [
  { value: "baixo", label: "Baixo" },
  { value: "medio", label: "Médio" },
  { value: "alto", label: "Alto" },
];

const SHAPE_OPTIONS: Array<PopoverOption<WorkflowShapeKind>> = [
  { value: "rectangle", label: "Retângulo" },
  { value: "circle", label: "Círculo" },
  { value: "diamond", label: "Losango" },
  { value: "triangle", label: "Triângulo" },
  { value: "inverted", label: "Triângulo invertido" },
  { value: "oval", label: "Oval" },
  { value: "star", label: "Estrela" },
];

const NOTE_PALETTE = [
  { id: "amber", bg: "bg-[#2A2418] border-[#FF9412]/30 text-[#FDE68A]" },
  { id: "emerald", bg: "bg-[#192822] border-[#31CF76]/30 text-[#BBF7D0]" },
  { id: "blue", bg: "bg-[#19222E] border-[#42A0FF]/30 text-[#BFDBFE]" },
  { id: "neutral", bg: "bg-[#242424] border-white/[0.12] text-[#DCDCDC]" },
];

function renderShapeSvg(shape: WorkflowShapeKind, color: string) {
  switch (shape) {
    case "circle":
      return <circle cx="50" cy="50" r="42" fill={color} fillOpacity={0.22} stroke={color} strokeWidth="3" />;
    case "diamond":
      return <polygon points="50,6 94,50 50,94 6,50" fill={color} fillOpacity={0.22} stroke={color} strokeWidth="3" />;
    case "triangle":
      return <polygon points="50,8 92,88 8,88" fill={color} fillOpacity={0.22} stroke={color} strokeWidth="3" />;
    case "inverted":
      return <polygon points="8,12 92,12 50,92" fill={color} fillOpacity={0.22} stroke={color} strokeWidth="3" />;
    case "oval":
      return <ellipse cx="50" cy="50" rx="44" ry="28" fill={color} fillOpacity={0.22} stroke={color} strokeWidth="3" />;
    case "star":
      return (
        <polygon
          points="50,6 62,36 94,38 69,58 77,90 50,72 23,90 31,58 6,38 38,36"
          fill={color}
          fillOpacity={0.22}
          stroke={color}
          strokeWidth="3"
        />
      );
    case "rectangle":
    default:
      return <rect x="8" y="14" width="84" height="72" rx="10" fill={color} fillOpacity={0.22} stroke={color} strokeWidth="3" />;
  }
}

function NodeHeaderIcon({ tipo }: { tipo: WorkflowNo["tipo"] }) {
  const kind = normalizeNodeKind(tipo);
  switch (kind) {
    case "gatilho":
      return <Zap className="h-4 w-4 text-[#FF9412]" />;
    case "prompt":
      return <FileText className="h-4 w-4 text-[#DCDCDC]" />;
    case "asset":
      return <ImageIcon className="h-4 w-4 text-[#42A0FF]" />;
    case "llm":
      return <Sparkles className="h-4 w-4 text-[#42A0FF]" />;
    case "agente":
      return <Bot className="h-4 w-4 text-[#31CF76]" />;
    case "gerar_imagem":
      return <ImageIcon className="h-4 w-4 text-[#42A0FF]" />;
    case "render_video":
      return <Film className="h-4 w-4 text-[#FF9412]" />;
    case "condition":
      return <GitBranch className="h-4 w-4 text-[#31CF76]" />;
    case "approval":
      return <CheckCircle2 className="h-4 w-4 text-[#FF9412]" />;
    case "output":
      return <Send className="h-4 w-4 text-[#31CF76]" />;
    case "nota":
      return <StickyNote className="h-4 w-4 text-[#FF9412]" />;
    case "text":
      return <Type className="h-4 w-4 text-[#DCDCDC]" />;
    default:
      return <Sparkles className="h-4 w-4 text-[#DCDCDC]" />;
  }
}

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
      {kind === "gatilho" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <CarbonMenuPicker
            value={triggerKind}
            disabled={readOnly}
            options={TRIGGER_KIND_OPTIONS}
            ariaLabel="Selecionar tipo de gatilho"
            onChange={(nextKind) =>
              onPatchNode(node.id, {
                triggerKind: nextKind,
                config: { ...cfg, triggerKind: nextKind },
              })
            }
          />
          {triggerState?.proxima_execucao_em && triggerKind === "schedule" && (
            <p className="text-[12px] text-[#979797]">
              Próxima:{" "}
              <span className="text-[#DCDCDC]">
                {new Date(triggerState.proxima_execucao_em).toLocaleString("pt-BR")}
              </span>
            </p>
          )}
          {triggerKind === "webhook" && triggerState?.webhook_url && (
            <p className="truncate rounded-lg bg-[#242424] px-2 py-1 font-mono text-[12px] text-[#DCDCDC]">
              {triggerState.webhook_url}
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            {onOpenTriggerModal && !readOnly && (
              <button
                type="button"
                onClick={() => onOpenTriggerModal(node)}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-white/[0.12] bg-[#242424] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#2A2A2A]"
              >
                <Settings2 className="h-3.5 w-3.5" />
                <span>Configurar gatilho</span>
              </button>
            )}
            {onExecuteStep && !readOnly && (
              <button
                type="button"
                onClick={() => onExecuteStep(node.id)}
                className="flex items-center gap-1 rounded-lg bg-[#F0F0F0] px-2 py-1 text-[12px] font-semibold text-[#141414] hover:bg-white"
              >
                <Play className="h-3 w-3" />
                <span>Executar etapa</span>
              </button>
            )}
          </div>
        </div>
      )}

      {kind === "prompt" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <textarea
            readOnly={readOnly}
            rows={4}
            value={node.prompt ?? (typeof cfg.prompt === "string" ? cfg.prompt : "")}
            onChange={(e) =>
              onPatchNode(node.id, {
                prompt: e.target.value,
                config: { ...cfg, prompt: e.target.value },
              })
            }
            placeholder="Escreva o texto ou use {{input}} e [NOME_DA_MARCA]"
            className="w-full resize-none rounded-lg border border-white/[0.06] bg-[#242424] p-2 text-[14px] font-normal text-[#DCDCDC] placeholder:text-[#6A6A6A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                const txt = node.prompt ?? (typeof cfg.prompt === "string" ? cfg.prompt : "");
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                  void navigator.clipboard.writeText(txt);
                }
                setCopiedNotice(true);
                setTimeout(() => setCopiedNotice(false), 1500);
              }}
              className="flex items-center gap-1 rounded-lg bg-[#242424] px-2 py-1 text-[12px] text-[#DCDCDC] hover:bg-[#2A2A2A]"
            >
              <Copy className="h-3 w-3" />
              <span>{copiedNotice ? "Conteúdo copiado" : "Copiar conteúdo"}</span>
            </button>
          </div>
        </div>
      )}

      {kind === "asset" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && onUploadFile) void onUploadFile(f);
              e.target.value = "";
            }}
          />
          {selectedAsset ? (
            <div className="overflow-hidden rounded-lg border border-white/[0.06] bg-[#242424]">
              {selectedAsset.mime_type.startsWith("image/") ? (
                <img
                  src={selectedAsset.url}
                  alt={selectedAsset.nome_original}
                  className="aspect-[4/3] w-full object-cover"
                />
              ) : (
                <div className="flex items-center gap-2 p-2 text-[12px] text-[#DCDCDC]">
                  <FileText className="h-4 w-4 text-[#31CF76]" />
                  <span className="truncate">{selectedAsset.nome_original}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center rounded-lg border border-dashed border-white/[0.12] bg-[#242424] p-2 text-center text-[12px] text-[#979797]">
              Nenhum arquivo selecionado
            </div>
          )}

          {!readOnly && (
            <div className="relative flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAssetMenuOpen((v) => !v)}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#242424] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#2A2A2A]"
              >
                <ImageIcon className="h-3.5 w-3.5 text-[#42A0FF]" />
                <span>Selecionar arquivo</span>
              </button>
              {onUploadFile && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1 rounded-lg bg-[#242424] px-2 py-1 text-[12px] text-[#DCDCDC] hover:bg-[#2A2A2A]"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>Carregar arquivo</span>
                </button>
              )}

              {assetMenuOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-white/[0.12] bg-[#212121] p-2 shadow-2xl">
                  <input
                    type="text"
                    value={assetSearch}
                    onChange={(e) => setAssetSearch(e.target.value)}
                    placeholder="Buscar na biblioteca..."
                    className="mb-2 w-full rounded-lg border border-white/[0.06] bg-[#242424] px-2 py-1 text-[12px] text-white placeholder:text-[#6A6A6A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                  />
                  <div className="mb-2 flex gap-1">
                    {(["recentes", "imagens", "arquivos"] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setAssetTab(tab)}
                        className={`flex-1 rounded-lg px-2 py-1 text-[12px] font-semibold ${
                          assetTab === tab
                            ? "border border-[#007CF7] bg-[#007CF7]/15 text-[#42A0FF]"
                            : "bg-[#242424] text-[#979797]"
                        }`}
                      >
                        {tab === "recentes" ? "Recentes" : tab === "imagens" ? "Imagens" : "Arquivos"}
                      </button>
                    ))}
                  </div>
                  <div className="grid max-h-44 grid-cols-3 gap-1 overflow-y-auto">
                    {filteredAssets.slice(0, 12).map((item) => (
                      <button
                        key={item.arquivo_id}
                        type="button"
                        onClick={() => {
                          onPatchNode(node.id, {
                            fileId: item.arquivo_id,
                            config: { ...cfg, fileId: item.arquivo_id },
                          });
                          setAssetMenuOpen(false);
                        }}
                        className="overflow-hidden rounded-lg border border-white/[0.06] bg-[#242424] p-1 text-left hover:border-[#007CF7]"
                      >
                        {item.mime_type.startsWith("image/") ? (
                          <img src={item.url} alt={item.nome_original} className="h-12 w-full rounded object-cover" />
                        ) : (
                          <div className="flex h-12 items-center justify-center">
                            <FileText className="h-4 w-4 text-[#31CF76]" />
                          </div>
                        )}
                        <span className="mt-1 block truncate text-[12px] text-[#DCDCDC]">
                          {item.nome_original}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {kind === "llm" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <textarea
            readOnly={readOnly}
            rows={3}
            value={node.prompt ?? (typeof cfg.prompt === "string" ? cfg.prompt : "")}
            onChange={(e) =>
              onPatchNode(node.id, {
                prompt: e.target.value,
                config: { ...cfg, prompt: e.target.value },
              })
            }
            placeholder="Instrução da etapa (recebe automaticamente entradas conectadas)..."
            className="w-full resize-none rounded-lg border border-white/[0.06] bg-[#242424] p-2 text-[14px] text-[#DCDCDC] placeholder:text-[#6A6A6A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
          />
          <button
            type="button"
            onClick={() => setSystemPromptOpen((v) => !v)}
            className="text-[12px] text-[#42A0FF] hover:underline"
          >
            {systemPromptOpen ? "Ocultar instruções de sistema" : "Definir instruções de sistema"}
          </button>
          {systemPromptOpen && (
            <textarea
              readOnly={readOnly}
              rows={2}
              value={node.systemPrompt ?? (typeof cfg.systemPrompt === "string" ? cfg.systemPrompt : "")}
              onChange={(e) =>
                onPatchNode(node.id, {
                  systemPrompt: e.target.value,
                  config: { ...cfg, systemPrompt: e.target.value },
                })
              }
              placeholder="System prompt opcional..."
              className="w-full resize-none rounded-lg border border-white/[0.06] bg-[#101010] p-2 text-[12px] text-[#DCDCDC] placeholder:text-[#6A6A6A]"
            />
          )}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <CarbonMenuPicker
                value={node.model ?? ""}
                disabled={readOnly}
                options={modelOptions}
                ariaLabel="Selecionar modelo de IA"
                onChange={(m) =>
                  onPatchNode(node.id, { model: m || undefined, config: { ...cfg, model: m } })
                }
                renderTrigger={(sel) => (
                  <span className="flex items-center gap-1.5">
                    <ProviderLogo provider={(sel?.subtitle as ProviderName) ?? "gemini"} size={14} />
                    <span className="truncate">{sel?.label ?? "Modelo"}</span>
                  </span>
                )}
              />
            </div>
            <CarbonMenuPicker
              value={(node.effort === "baixo" || node.effort === "alto" ? node.effort : "medio") as "baixo" | "medio" | "alto"}
              disabled={readOnly}
              options={EFFORT_OPTIONS}
              ariaLabel="Selecionar nível de esforço"
              onChange={(eff) =>
                onPatchNode(node.id, { effort: eff, config: { ...cfg, effort: eff } })
              }
            />
          </div>
        </div>
      )}

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
          <textarea
            readOnly={readOnly}
            rows={2}
            value={node.prompt ?? (typeof cfg.prompt === "string" ? cfg.prompt : "")}
            onChange={(e) =>
              onPatchNode(node.id, {
                prompt: e.target.value,
                config: { ...cfg, prompt: e.target.value },
              })
            }
            placeholder="Briefing ou tarefa do especialista..."
            className="w-full resize-none rounded-lg border border-white/[0.06] bg-[#242424] p-2 text-[14px] text-[#DCDCDC] placeholder:text-[#6A6A6A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
          />
        </div>
      )}

      {(kind === "gerar_imagem" || kind === "render_video") && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <textarea
            readOnly={readOnly}
            rows={2}
            value={node.prompt ?? (typeof cfg.prompt === "string" ? cfg.prompt : "")}
            onChange={(e) =>
              onPatchNode(node.id, {
                prompt: e.target.value,
                config: { ...cfg, prompt: e.target.value },
              })
            }
            placeholder={
              kind === "gerar_imagem"
                ? "Direção visual / composição para gerar imagem..."
                : "Instrução / estilo do vídeo Reels MP4..."
            }
            className="w-full resize-none rounded-lg border border-white/[0.06] bg-[#242424] p-2 text-[14px] text-[#DCDCDC] placeholder:text-[#6A6A6A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
          />
          {nodeRunView?.artifacts[0] && (
            <div className="overflow-hidden rounded-lg border border-white/[0.06] bg-[#101010] p-1">
              {kind === "gerar_imagem" ? (
                <img
                  src={`/api/arquivos/raw?path=${encodeURIComponent(nodeRunView.artifacts[0])}`}
                  alt="Arte gerada"
                  className="max-h-28 w-full rounded object-cover"
                />
              ) : (
                <p className="truncate font-mono text-[12px] text-[#31CF76]">
                  {nodeRunView.artifacts[0]}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {kind === "condition" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <textarea
            readOnly={readOnly}
            rows={2}
            value={node.rule ?? (typeof cfg.rule === "string" ? cfg.rule : "")}
            onChange={(e) =>
              onPatchNode(node.id, {
                rule: e.target.value,
                config: { ...cfg, rule: e.target.value },
              })
            }
            placeholder="Ex.: A legenda tem menos de 2200 caracteres e inclui CTA?"
            className="w-full resize-none rounded-lg border border-white/[0.06] bg-[#242424] p-2 text-[14px] text-[#DCDCDC] placeholder:text-[#6A6A6A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
          />
          <CarbonMenuPicker
            value={node.model ?? ""}
            disabled={readOnly}
            options={modelOptions}
            ariaLabel="Selecionar modelo da condição"
            onChange={(m) =>
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
