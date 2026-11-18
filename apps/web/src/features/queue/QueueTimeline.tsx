import { useState, type FormEvent } from "react";
import type { StatusTarefa, TarefaRegistro } from "@criativo/contracts";
import { ListFilter, Plus, X } from "lucide-react";
import { CarbonSelect } from "../../components/ui/CarbonControls";
import { TaskCard } from "./TaskCard";

const STATUS_OPTIONS = [
  { value: "todos", label: "Todos os status" },
  { value: "executando", label: "Executando" },
  { value: "aguardando_aprovacao", label: "Aguardando Aprovação" },
  { value: "pendente", label: "Pendente" },
  { value: "concluido", label: "Concluído" },
  { value: "falha", label: "Falha" },
] as const;

interface QueueTimelineProps {
  tarefas: TarefaRegistro[];
  selectedTaskId: string | null;
  onSelectTask: (tarefaId: string) => void;
  onCreateTask: (input: {
    titulo: string;
    tipo: string;
    prioridade: number;
    prompt: string;
  }) => Promise<void>;
  onRetryTask: (tarefaId: string) => void;
  onCancelTask: (tarefaId: string) => void;
}

const TIPOS_CRIACAO = [
  { value: "carrossel", label: "Carrossel (1080x1350)" },
  { value: "post_individual", label: "Post Individual (1080x1350)" },
  { value: "reels", label: "Reels Remotion (9:16)" },
  { value: "stories", label: "Stories (9:16)" },
  { value: "anuncio", label: "Anúncio Meta Ads" },
  { value: "planejamento", label: "Calendário Editorial" },
];

export function QueueTimeline({
  tarefas,
  selectedTaskId,
  onSelectTask,
  onCreateTask,
  onRetryTask,
  onCancelTask,
}: QueueTimelineProps) {
  const [statusFilter, setStatusFilter] = useState<"todos" | StatusTarefa>("todos");
  const [showCreate, setShowCreate] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState("carrossel");
  const [prioridade, setPrioridade] = useState(3);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const filtered =
    statusFilter === "todos"
      ? tarefas
      : tarefas.filter((t) => t.status === statusFilter);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!titulo.trim()) return;
    setSubmitting(true);
    try {
      await onCreateTask({
        titulo: titulo.trim(),
        tipo,
        prioridade,
        prompt: prompt.trim() || titulo.trim(),
      });
      setTitulo("");
      setPrompt("");
      setShowCreate(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="flex flex-col rounded-2xl border border-white/[0.07] bg-[#212121] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListFilter className="h-4 w-4 text-[#979797]" />
          <h2 className="text-sm font-semibold text-white">
            Linha do Tempo &amp; Fila FIFO ({filtered.length})
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <CarbonSelect<"todos" | StatusTarefa>
            id="queue-status-filter"
            ariaLabel="Filtrar por status"
            value={statusFilter}
            options={STATUS_OPTIONS as ReadonlyArray<{ value: "todos" | StatusTarefa; label: string }>}
            onChange={(val) => setStatusFilter(val)}
          />

          <button
            type="button"
            onClick={() => setShowCreate((prev) => !prev)}
            className="openbot-btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs shadow"
          >
            {showCreate ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            Disparar Nova Tarefa
          </button>
        </div>
      </div>

      {showCreate && (
        <form
          onSubmit={handleSubmit}
          className="mb-3 space-y-2.5 rounded-2xl border border-white/10 bg-[#141414] p-3.5"
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              id="queue-new-title"
              name="queue_new_title"
              aria-label="Título ou pauta da criação"
              type="text"
              required
              placeholder="Título ou pauta da criação..."
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              className="sm:col-span-2 rounded-xl border border-white/10 bg-[#212121] px-3 py-1.5 text-xs text-white placeholder-[#6A6A6A] focus:border-white/30 focus:outline-none"
            />
            <CarbonSelect
              id="queue-new-type"
              ariaLabel="Formato criativo"
              value={tipo}
              options={TIPOS_CRIACAO}
              onChange={(val) => setTipo(val)}
            />
          </div>

          <textarea
            id="queue-new-prompt"
            name="queue_new_prompt"
            aria-label="Briefing detalhado para os agentes"
            rows={2}
            placeholder="Briefing detalhado para os agentes (estilo da marca, objetivo, CTA)..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-[#212121] px-3 py-1.5 text-xs text-white placeholder-[#6A6A6A] focus:border-white/30 focus:outline-none"
          />

          <div className="flex items-center justify-between">
            <label
              htmlFor="queue-new-priority"
              className="flex items-center gap-2 text-xs text-[#979797]"
            >
              Prioridade (1 máx - 10 mín):
              <input
                id="queue-new-priority"
                name="queue_new_priority"
                aria-label="Prioridade da tarefa"
                type="number"
                min={1}
                max={10}
                value={prioridade}
                onChange={(e) => setPrioridade(Number(e.target.value))}
                className="w-14 rounded-lg border border-white/10 bg-[#212121] px-2 py-0.5 text-center text-xs text-white"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="openbot-btn-primary px-3.5 py-1.5 text-xs disabled:opacity-50"
            >
              {submitting ? "Enfileirando..." : "Adicionar na Fila FIFO"}
            </button>
          </div>
        </form>
      )}

      {filtered.length === 0 ? (
        <div className="flex min-h-[160px] items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#141414]/70 p-6 text-center text-sm text-[#979797]">
          Nenhuma tarefa pendente. Os agentes estão prontos para agir.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((tarefa) => (
            <TaskCard
              key={tarefa.tarefa_id}
              tarefa={tarefa}
              isSelected={selectedTaskId === tarefa.tarefa_id}
              onSelect={onSelectTask}
              onRetry={onRetryTask}
              onCancel={onCancelTask}
            />
          ))}
        </div>
      )}
    </section>
  );
}
