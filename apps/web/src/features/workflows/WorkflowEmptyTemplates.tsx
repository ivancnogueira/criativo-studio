import type {
  TipoNoWorkflow,
  WorkflowNo,
  WorkflowTemplateDefinition,
  WorkflowTemplateId,
} from "@criativo/contracts";
import { BarChart3, CalendarClock, ImagePlus, Radar, Sparkles, Zap } from "lucide-react";
import { TRIGGER_PRESETS } from "./workflow-canvas-types";
import { WORKFLOW_EMPTY_TEMPLATES } from "./workflow-templates";

function iconForCategory(cat: WorkflowTemplateDefinition["categoria"]) {
  if (cat === "criacao") return ImagePlus;
  if (cat === "metricas") return BarChart3;
  if (cat === "inteligencia") return Radar;
  return CalendarClock;
}

export function WorkflowEmptyTemplates({
  templates,
  triggerMenuOpen,
  onToggleTriggerMenu,
  onApplyTemplate,
  onAddTriggerNode,
}: {
  templates?: readonly WorkflowTemplateDefinition[];
  triggerMenuOpen: boolean;
  onToggleTriggerMenu: () => void;
  onApplyTemplate: (templateId: WorkflowTemplateId) => void;
  onAddTriggerNode: (tipo: TipoNoWorkflow, extra: Partial<WorkflowNo>) => void;
}) {
  const catalog = templates && templates.length > 0 ? templates : WORKFLOW_EMPTY_TEMPLATES;

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
      <div className="pointer-events-auto w-full max-w-3xl space-y-5 rounded-2xl border border-white/[0.12] bg-[#212121]/95 p-6 shadow-2xl backdrop-blur">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#42A0FF]/15 text-[#42A0FF]">
            <Sparkles className="h-5 w-5" />
          </div>
          <h2 className="text-[20px] font-semibold text-white">
            Comece com um template de marketing ou um gatilho
          </h2>
          <p className="max-w-xl text-[13px] text-[#979797]">
            Escolha um fluxo pronto adaptado para <code className="text-[#DCDCDC]">[NOME_DA_MARCA]</code>{" "}
            ou inicie do zero conectando seu próprio disparo.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {catalog.map((tpl) => {
            const Icon = iconForCategory(tpl.categoria);
            return (
              <div
                key={tpl.id}
                data-testid={`workflow-template-card-${tpl.id}`}
                className="flex flex-col justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#181818] p-4 transition-colors hover:border-[#42A0FF]/50"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#242424] px-2.5 py-0.5 text-[11px] font-semibold text-[#42A0FF]">
                      <Icon className="h-3.5 w-3.5" />
                      <span>{tpl.badge}</span>
                    </span>
                    <span className="text-[11px] text-[#979797]">
                      {tpl.estimativaNos} etapas
                    </span>
                  </div>
                  <h3 className="text-[15px] font-semibold text-white">{tpl.nome}</h3>
                  <p className="text-[12px] leading-relaxed text-[#979797]">{tpl.descricao}</p>
                </div>

                <button
                  type="button"
                  data-testid={`workflow-template-apply-${tpl.id}`}
                  onClick={() => onApplyTemplate(tpl.id)}
                  className="w-full rounded-lg bg-[#2A2A2A] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#007CF7]"
                >
                  Usar template
                </button>
              </div>
            );
          })}
        </div>

        <div className="relative flex items-center justify-center border-t border-white/[0.08] pt-4">
          <button
            type="button"
            onClick={onToggleTriggerMenu}
            className="flex items-center gap-2 rounded-lg border border-white/[0.12] bg-[#242424] px-4 py-2 text-[13px] font-semibold text-[#DCDCDC] hover:bg-[#2A2A2A]"
          >
            <Zap className="h-4 w-4 text-[#FF9412]" />
            <span>Começar do zero com um gatilho</span>
          </button>
          {triggerMenuOpen && (
            <div className="absolute top-full z-40 mt-2 w-64 rounded-xl border border-white/[0.12] bg-[#212121] p-1 text-left shadow-2xl">
              {TRIGGER_PRESETS.map((preset) => (
                <button
                  key={preset.titulo}
                  type="button"
                  onClick={() =>
                    onAddTriggerNode("gatilho", {
                      titulo: preset.titulo,
                      triggerKind: preset.triggerKind,
                      config: preset.conectorId
                        ? { triggerKind: preset.triggerKind, conectorId: preset.conectorId }
                        : { triggerKind: preset.triggerKind },
                    })
                  }
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-[#DCDCDC] hover:bg-[#2A2A2A]"
                >
                  <Zap className="h-3.5 w-3.5 text-[#FF9412]" />
                  <span>{preset.titulo}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
