import React, { useMemo, useState } from "react";
import type {
  AgenteRegistro,
  TipoNoWorkflow,
  UsoProvedoresSnapshot,
  WorkflowAresta,
  WorkflowNo,
  WorkflowVisual,
} from "@criativo/contracts";
import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock,
  Film,
  Hand,
  Image as ImageIcon,
  Maximize2,
  MessageSquare,
  Minus,
  MousePointer,
  Pencil,
  Play,
  Plus,
  Save,
  Search,
  Send,
  StickyNote,
  Trash2,
  Type,
  Webhook,
  Zap,
} from "lucide-react";
import { ProviderLogo } from "../../components/ProviderLogo";

interface WorkflowsCanvasPageProps {
  workflows: WorkflowVisual[];
  agentes: AgenteRegistro[];
  uso: UsoProvedoresSnapshot | null;
  onSaveWorkflow: (wf: {
    workflow_id?: string;
    nome: string;
    descricao?: string;
    nos: WorkflowNo[];
    arestas: WorkflowAresta[];
  }) => Promise<WorkflowVisual>;
  onExecuteWorkflow: (workflowId: string) => Promise<{ tarefas_criadas: string[] }>;
}

const TRIGGER_PRESETS: Array<{ titulo: string; subtitulo: string; canal: string }> = [
  { titulo: "WhatsApp Recebido", subtitulo: "Áudio ou comando de texto", canal: "whatsapp" },
  { titulo: "Agendamento Cron", subtitulo: "Rotina recorrente America/Sao_Paulo", canal: "cron" },
  { titulo: "Webhook Externo", subtitulo: "Evento HTTP autenticado", canal: "webhook" },
  { titulo: "Disparo Manual", subtitulo: "Execução imediata no estúdio", canal: "manual" },
];

const NODE_LIBRARY: Array<{
  tipo: TipoNoWorkflow;
  titulo: string;
  subtitulo: string;
  Icon: React.FC<{ className?: string }>;
  accent: string;
}> = [
  {
    tipo: "agente",
    titulo: "Executar Agente",
    subtitulo: "Estrategista, Copywriter ou outro",
    Icon: Bot,
    accent: "#38bdf8",
  },
  {
    tipo: "gerar_imagem",
    titulo: "Gerar Imagem IA",
    subtitulo: "Nano Banana / GPT Image + ImagePaths",
    Icon: ImageIcon,
    accent: "#d946ef",
  },
  {
    tipo: "render_video",
    titulo: "Renderizar Reels MP4",
    subtitulo: "Remotion 1080x1920 30fps",
    Icon: Film,
    accent: "#ef4444",
  },
  {
    tipo: "aprovacao",
    titulo: "Aprovação Humana",
    subtitulo: "Envia prévia p/ Cockpit e WhatsApp",
    Icon: CheckCircle2,
    accent: "#31cf76",
  },
  {
    tipo: "publicar_meta",
    titulo: "Publicar Instagram",
    subtitulo: "Meta Graph API após autorização",
    Icon: Send,
    accent: "#ff9412",
  },
  {
    tipo: "nota",
    titulo: "Nota Adesiva",
    subtitulo: "Anotação livre no canvas",
    Icon: StickyNote,
    accent: "#eab308",
  },
];

/**
 * Editor visual de Fluxos de Trabalho estilo OpenBot (Screenshot 4): fundo dot-grid #1A1A1A,
 * estado inicial "Comece com um gatilho", widget Uso no canto inferior esquerdo e barra flutuante.
 */
export const WorkflowsCanvasPage: React.FC<WorkflowsCanvasPageProps> = ({
  workflows,
  agentes,
  uso,
  onSaveWorkflow,
  onExecuteWorkflow,
}) => {
  const [activeId, setActiveId] = useState<string | null>(
    workflows[0]?.workflow_id ?? null
  );
  const currentWf = useMemo(
    () => workflows.find((w) => w.workflow_id === activeId) ?? workflows[0] ?? null,
    [workflows, activeId]
  );

  const [nameDraft, setNameDraft] = useState<string>(
    currentWf?.nome ?? "Fluxo de trabalho sem título"
  );
  const [nos, setNos] = useState<WorkflowNo[]>(currentWf?.nos ?? []);
  const [arestas, setArestas] = useState<WorkflowAresta[]>(currentWf?.arestas ?? []);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
  const [triggerMenuOpen, setTriggerMenuOpen] = useState(false);
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [activeTool, setActiveTool] = useState<"pointer" | "hand" | "note" | "text">("pointer");
  const [draggingNode, setDraggingNode] = useState<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const selectWorkflow = (wf: WorkflowVisual) => {
    setActiveId(wf.workflow_id);
    setNameDraft(wf.nome);
    setNos(wf.nos);
    setArestas(wf.arestas);
    setSelectedNodeId(null);
    setFeedback(null);
  };

  const selectedNode = useMemo(
    () => nos.find((n) => n.id === selectedNodeId) ?? null,
    [nos, selectedNodeId]
  );

  const persist = async (nextNos = nos, nextArestas = arestas, nextName = nameDraft) => {
    setSaving(true);
    try {
      const saved = await onSaveWorkflow({
        workflow_id: currentWf?.workflow_id,
        nome: nextName.trim() || "Fluxo de trabalho sem título",
        nos: nextNos,
        arestas: nextArestas,
      });
      setActiveId(saved.workflow_id);
      setFeedback("Fluxo salvo no SQLite.");
    } finally {
      setSaving(false);
    }
  };

  const addTriggerNode = async (preset: (typeof TRIGGER_PRESETS)[number]) => {
    const newNode: WorkflowNo = {
      id: `no-${Date.now()}`,
      tipo: "gatilho",
      titulo: preset.titulo,
      subtitulo: preset.subtitulo,
      x: 210,
      y: 200,
      config: { canal: preset.canal },
    };
    const nextNos = [...nos, newNode];
    setNos(nextNos);
    setTriggerMenuOpen(false);
    setSelectedNodeId(newNode.id);
    await persist(nextNos, arestas);
  };

  const addActionNode = async (item: (typeof NODE_LIBRARY)[number]) => {
    const prevNode = nos[nos.length - 1];
    const newNode: WorkflowNo = {
      id: `no-${Date.now()}`,
      tipo: item.tipo,
      titulo: item.titulo,
      subtitulo: item.subtitulo,
      x: prevNode ? prevNode.x + 280 : 220,
      y: prevNode ? prevNode.y : 200,
      config:
        item.tipo === "agente"
          ? { agente_id: agentes[0]?.agente_id ?? "estrategista" }
          : {},
    };
    const nextNos = [...nos, newNode];
    const nextArestas =
      prevNode && item.tipo !== "nota"
        ? [
            ...arestas,
            {
              id: `ar-${Date.now()}`,
              origem: prevNode.id,
              destino: newNode.id,
            },
          ]
        : arestas;
    setNos(nextNos);
    setArestas(nextArestas);
    setNodeMenuOpen(false);
    setSelectedNodeId(newNode.id);
    await persist(nextNos, nextArestas);
  };

  const handleRun = async () => {
    await persist();
    const targetId = currentWf?.workflow_id;
    if (!targetId) return;
    const res = await onExecuteWorkflow(targetId);
    setFeedback(`Executado: ${res.tarefas_criadas.length} tarefa(s) enviada(s) à Fila FIFO.`);
  };

  const primaryUsageProvider = uso?.provedores?.[0] ?? null;

  return (
    <div
      className="relative flex-1 h-full openbot-dot-grid overflow-hidden select-none"
      onPointerMove={(e) => {
        if (!draggingNode) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const scale = zoom / 100;
        const nextX = Math.max(40, Math.round((e.clientX - rect.left) / scale - draggingNode.offsetX));
        const nextY = Math.max(60, Math.round((e.clientY - rect.top) / scale - draggingNode.offsetY));
        setNos((prev) =>
          prev.map((n) => (n.id === draggingNode.id ? { ...n, x: nextX, y: nextY } : n))
        );
      }}
      onPointerUp={() => setDraggingNode(null)}
    >
      {/* Topo esquerdo discreto com seletor/título + ações rápidas */}
      <div className="absolute top-3 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          <div className="relative">
            <select
              id="workflow-selector"
              name="workflow_selector"
              aria-label="Selecionar fluxo de trabalho"
              value={currentWf?.workflow_id ?? ""}
              onChange={(e) => {
                const found = workflows.find((w) => w.workflow_id === e.target.value);
                if (found) selectWorkflow(found);
              }}
              className="appearance-none rounded-xl bg-[#212121]/90 border border-white/10 pl-3 pr-8 py-1.5 text-[12.5px] font-medium text-white focus:outline-none cursor-pointer"
            >
              {workflows.map((wf) => (
                <option key={wf.workflow_id} value={wf.workflow_id}>
                  {wf.nome}
                </option>
              ))}
            </select>
            <ChevronDown className="h-3.5 w-3.5 text-[#979797] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <input
            id="workflow-title-input"
            name="workflow_title"
            aria-label="Título do fluxo de trabalho"
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            className="hidden sm:block rounded-xl bg-[#212121]/80 border border-white/10 px-3 py-1.5 text-[12px] text-[#DCDCDC] focus:outline-none focus:border-white/25 w-52"
          />

          <button
            type="button"
            onClick={() => {
              void onSaveWorkflow({
                nome: "Novo fluxo criativo",
                nos: [],
                arestas: [],
              }).then(selectWorkflow);
            }}
            className="rounded-xl bg-[#212121]/90 hover:bg-[#2A2A2A] border border-white/10 px-2.5 py-1.5 text-[12px] text-[#DCDCDC] inline-flex items-center gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            Novo
          </button>
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          {feedback && (
            <span className="rounded-full bg-[#31CF76]/15 border border-[#31CF76]/30 px-3 py-1 text-[11px] text-[#31CF76]">
              {feedback}
            </span>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => void persist()}
            className="rounded-full bg-[#212121]/95 hover:bg-[#2A2A2A] border border-white/10 px-3 py-1.5 text-[12px] font-medium text-white inline-flex items-center gap-1.5"
          >
            <Save className="h-3.5 w-3.5 text-[#979797]" />
            Salvar
          </button>
          <button
            type="button"
            disabled={nos.length === 0}
            onClick={() => void handleRun()}
            className="openbot-btn-primary px-3.5 py-1.5 text-[12px] inline-flex items-center gap-1.5 disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            Executar
          </button>
        </div>
      </div>

      {/* Estado Vazio Central idêntico à Screenshot 4: "Comece com um gatilho" */}
      {nos.length === 0 ? (
        <div className="h-full w-full flex flex-col items-center justify-center relative z-10 px-4">
          <div className="h-11 w-11 rounded-2xl bg-[#FF9412]/15 border border-[#FF9412]/30 flex items-center justify-center text-[#FF9412] mb-3 shadow-lg">
            <Zap className="h-5 w-5" />
          </div>
          <p className="text-[14px] font-medium text-[#DCDCDC] mb-3.5">
            Comece com um gatilho
          </p>
          <div className="relative">
            <button
              type="button"
              onClick={() => setTriggerMenuOpen((o) => !o)}
              className="openbot-btn-primary px-5 py-2 text-[13px] shadow-xl inline-flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Adicionar gatilho
            </button>

            {triggerMenuOpen && (
              <div className="absolute left-1/2 -translate-x-1/2 top-12 w-72 rounded-2xl bg-[#212121] border border-white/15 shadow-2xl p-1.5 z-40">
                {TRIGGER_PRESETS.map((preset) => (
                  <button
                    key={preset.titulo}
                    type="button"
                    onClick={() => void addTriggerNode(preset)}
                    className="w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl hover:bg-[#2A2A2A] text-left transition-colors"
                  >
                    <div className="h-7 w-7 rounded-lg bg-[#FF9412]/15 text-[#FF9412] flex items-center justify-center shrink-0 mt-0.5">
                      {preset.canal === "cron" ? (
                        <Clock className="h-3.5 w-3.5" />
                      ) : preset.canal === "webhook" ? (
                        <Webhook className="h-3.5 w-3.5" />
                      ) : (
                        <Zap className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div>
                      <div className="text-[12.5px] font-semibold text-white">
                        {preset.titulo}
                      </div>
                      <div className="text-[11px] text-[#979797]">{preset.subtitulo}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Camada SVG + Nós Conectáveis com Zoom */
        <div
          className="h-full w-full relative origin-top-left"
          style={{ transform: `scale(${zoom / 100})` }}
        >
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {arestas.map((aresta) => {
              const src = nos.find((n) => n.id === aresta.origem);
              const dst = nos.find((n) => n.id === aresta.destino);
              if (!src || !dst) return null;
              const x1 = src.x + 220;
              const y1 = src.y + 42;
              const x2 = dst.x;
              const y2 = dst.y + 42;
              const cpx = Math.round((x1 + x2) / 2);
              return (
                <path
                  key={aresta.id}
                  d={`M ${x1} ${y1} C ${cpx} ${y1}, ${cpx} ${y2}, ${x2} ${y2}`}
                  stroke="rgba(255,255,255,0.28)"
                  strokeWidth="2"
                  fill="none"
                />
              );
            })}
          </svg>

          {nos.map((no) => {
            const isSelected = no.id === selectedNodeId;
            return (
              <div
                key={no.id}
                onPointerDown={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  const scale = zoom / 100;
                  setSelectedNodeId(no.id);
                  setDraggingNode({
                    id: no.id,
                    offsetX: (e.clientX - box.left) / scale,
                    offsetY: (e.clientY - box.top) / scale,
                  });
                }}
                style={{ left: no.x, top: no.y }}
                className={`absolute w-[220px] rounded-2xl border p-3.5 cursor-grab active:cursor-grabbing shadow-2xl transition-colors ${
                  isSelected
                    ? "bg-[#242424] border-[#42A0FF]"
                    : "bg-[#212121] border-white/10 hover:border-white/25"
                }`}
              >
                {/* Porta entrada esquerda */}
                {no.tipo !== "gatilho" && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (connectingFromId && connectingFromId !== no.id) {
                        setArestas((prev) => [
                          ...prev,
                          { id: `ar-${Date.now()}`, origem: connectingFromId, destino: no.id },
                        ]);
                        setConnectingFromId(null);
                      }
                    }}
                    title="Conectar entrada"
                    className="absolute -left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-[#141414] border-2 border-white/40 hover:border-[#31CF76]"
                  />
                )}

                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-[#979797] font-medium">
                      {no.tipo}
                    </span>
                    <h4 className="text-[13px] font-semibold text-white mt-0.5">{no.titulo}</h4>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setNos((prev) => prev.filter((item) => item.id !== no.id));
                      setArestas((prev) =>
                        prev.filter((a) => a.origem !== no.id && a.destino !== no.id)
                      );
                      if (selectedNodeId === no.id) setSelectedNodeId(null);
                    }}
                    aria-label={`Remover nó ${no.titulo}`}
                    className="text-[#6A6A6A] hover:text-[#FD2F3B]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {no.subtitulo && (
                  <p className="text-[11px] text-[#979797] mt-1 line-clamp-2">{no.subtitulo}</p>
                )}

                {/* Porta saída direita */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConnectingFromId((prev) => (prev === no.id ? null : no.id));
                  }}
                  title="Clique para conectar à próxima etapa"
                  className={`absolute -right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full border-2 transition-colors ${
                    connectingFromId === no.id
                      ? "bg-[#31CF76] border-white scale-125"
                      : "bg-[#141414] border-white/40 hover:border-[#42A0FF]"
                  }`}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Drawer lateral de configuração do nó selecionado */}
      {selectedNode && (
        <div className="absolute top-16 right-4 z-30 w-72 rounded-2xl bg-[#212121]/95 border border-white/15 p-4 shadow-2xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-white">Configurar Nó</span>
            <button
              type="button"
              onClick={() => setSelectedNodeId(null)}
              className="text-[#979797] hover:text-white text-[14px]"
            >
              ×
            </button>
          </div>
          <div>
            <label htmlFor="wf-node-title" className="block text-[11px] text-[#979797] mb-1">
              Título
            </label>
            <input
              id="wf-node-title"
              name="wf_node_title"
              aria-label="Título do nó"
              type="text"
              value={selectedNode.titulo}
              onChange={(e) => {
                const val = e.target.value;
                setNos((prev) =>
                  prev.map((n) => (n.id === selectedNode.id ? { ...n, titulo: val } : n))
                );
              }}
              className="w-full rounded-xl bg-[#141414] border border-white/10 px-3 py-1.5 text-[12px] text-white"
            />
          </div>
          {selectedNode.tipo === "agente" && (
            <div>
              <label htmlFor="wf-node-agent" className="block text-[11px] text-[#979797] mb-1">
                Agente Responsável
              </label>
              <select
                id="wf-node-agent"
                name="wf_node_agent"
                aria-label="Agente responsável pelo nó"
                value={String(selectedNode.config?.agente_id ?? agentes[0]?.agente_id ?? "")}
                onChange={(e) => {
                  const val = e.target.value;
                  setNos((prev) =>
                    prev.map((n) =>
                      n.id === selectedNode.id
                        ? { ...n, config: { ...n.config, agente_id: val } }
                        : n
                    )
                  );
                }}
                className="w-full rounded-xl bg-[#141414] border border-white/10 px-3 py-1.5 text-[12px] text-white"
              >
                {agentes.map((ag) => (
                  <option key={ag.agente_id} value={ag.agente_id}>
                    {ag.nome}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Canto inferior esquerdo: Widget 'Uso' multi-conta + controles Zoom (Screenshot 4) */}
      <div className="absolute bottom-3.5 left-3.5 z-20 space-y-2.5">
        <div className="w-[272px] rounded-2xl bg-[#212121]/95 border border-white/10 p-3 shadow-2xl">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-white mb-2">
            <Activity className="h-3.5 w-3.5 text-[#979797]" />
            <span>Uso</span>
          </div>

          <div className="space-y-2.5 max-h-[180px] overflow-y-auto pr-0.5">
            {((uso?.provedores ?? []).filter((p) => p.janelas.length > 0).length > 0
              ? (uso?.provedores ?? []).filter((p) => p.janelas.length > 0).slice(0, 2)
              : [
                  primaryUsageProvider ?? {
                    provedor: "gemini" as const,
                    rotulo: "Gemini",
                    conectado: false,
                    janelas: [
                      { janela: "5h", rotulo: "Gemini Models · 5h", restante_percentual: 100, reseta_em_texto: "4 h 59 min" },
                      { janela: "7d", rotulo: "Gemini Models · Semanal", restante_percentual: 100, reseta_em_texto: "6 d 23 h" },
                    ],
                  },
                ]
            ).map((prov, idx) => (
              <div key={`${prov.provedor}-${idx}`} className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-white">
                  <ProviderLogo provider={prov.provedor} size={13} />
                  <span className="truncate">{prov.rotulo}</span>
                </div>

                {prov.janelas.slice(0, 4).map((j, jIdx) => (
                  <div key={`${j.janela}-${jIdx}`} className="flex items-center justify-between gap-2 text-[10.5px]">
                    <span className="text-[#979797] truncate w-24">{j.rotulo}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-[#DCDCDC] rounded-full"
                        style={{ width: `${j.restante_percentual}%` }}
                      />
                    </div>
                    <span className="text-white font-medium shrink-0 tabular-nums">{j.restante_percentual}%</span>
                    <span className="text-[#6A6A6A] shrink-0 tabular-nums">{j.reseta_em_texto}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Cápsula de Zoom '- 100% + | encaixar' */}
        <div className="inline-flex items-center gap-1 rounded-xl bg-[#212121]/95 border border-white/10 px-2 py-1 text-[11.5px] text-[#DCDCDC] shadow-lg">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(50, z - 10))}
            aria-label="Reduzir zoom"
            className="h-6 w-6 rounded flex items-center justify-center hover:bg-white/10"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="px-1.5 font-medium">{zoom}%</span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(160, z + 10))}
            aria-label="Aumentar zoom"
            className="h-6 w-6 rounded flex items-center justify-center hover:bg-white/10"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <span className="mx-1 h-3.5 w-px bg-white/10" />
          <button
            type="button"
            onClick={() => setZoom(100)}
            title="Restaurar 100%"
            aria-label="Ajustar canvas em 100%"
            className="h-6 w-6 rounded flex items-center justify-center hover:bg-white/10"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Barra inferior flutuante centrada (Screenshot 4) */}
      <div className="absolute bottom-3.5 left-1/2 -translate-x-1/2 z-30">
        {nodeMenuOpen && (
          <div className="mb-2 w-72 ml-auto rounded-2xl bg-[#212121] border border-white/15 shadow-2xl p-1.5">
            {NODE_LIBRARY.map((item) => {
              const Icon = item.Icon;
              return (
                <button
                  key={item.tipo}
                  type="button"
                  onClick={() => void addActionNode(item)}
                  className="w-full flex items-start gap-2.5 px-3 py-2 rounded-xl hover:bg-[#2A2A2A] text-left transition-colors"
                >
                  <span
                    className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{ backgroundColor: `${item.accent}22`, color: item.accent }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <div className="text-[12.5px] font-semibold text-white">{item.titulo}</div>
                    <div className="text-[11px] text-[#979797]">{item.subtitulo}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-1 rounded-2xl bg-[#212121]/95 border border-white/10 px-2 py-1.5 shadow-2xl">
          {[
            { id: "pointer", label: "Selecionar", Icon: MousePointer },
            { id: "hand", label: "Mover", Icon: Hand },
            { id: "note", label: "Nota", Icon: Pencil },
            { id: "text", label: "Texto", Icon: Type },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTool(id as typeof activeTool)}
              title={label}
              aria-label={label}
              className={`h-8 w-8 rounded-xl flex items-center justify-center transition-colors ${
                activeTool === id
                  ? "bg-[#2A2A2A] text-white"
                  : "text-[#979797] hover:text-white hover:bg-white/[0.05]"
              }`}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}

          <button
            type="button"
            onClick={() =>
              void addActionNode(NODE_LIBRARY[NODE_LIBRARY.length - 1])
            }
            title="Adicionar Nota Adesiva"
            aria-label="Adicionar Nota Adesiva"
            className="h-8 w-8 rounded-xl flex items-center justify-center text-[#FF9412] hover:bg-white/[0.05]"
          >
            <StickyNote className="h-4 w-4" />
          </button>

          <button
            type="button"
            title="Comentar etapa"
            aria-label="Comentar etapa"
            onClick={() => setNodeMenuOpen(true)}
            className="hidden sm:flex h-8 w-8 rounded-xl items-center justify-center text-[#979797] hover:text-white hover:bg-white/[0.05]"
          >
            <MessageSquare className="h-4 w-4" />
          </button>

          <button
            type="button"
            title="Buscar nó"
            aria-label="Buscar nó"
            onClick={() => setNodeMenuOpen(true)}
            className="hidden sm:flex h-8 w-8 rounded-xl items-center justify-center text-[#979797] hover:text-white hover:bg-white/[0.05]"
          >
            <Search className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setNodeMenuOpen((o) => !o)}
            className="openbot-btn-primary ml-1 px-3.5 py-1.5 text-[12px] inline-flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar nó
          </button>
        </div>
      </div>
    </div>
  );
};
