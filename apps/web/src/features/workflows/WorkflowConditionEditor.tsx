import type {
  WorkflowConditionMode,
  WorkflowDeterministicClause,
  WorkflowDeterministicOperator,
  WorkflowDeterministicRule,
} from "@criativo/contracts";
import { Plus, Trash2 } from "lucide-react";
import { CarbonMenuPicker, type PopoverOption } from "./workflow-node-helpers";
import type { AvailableWorkflowToken } from "./workflow-variable-catalog";

const OPERATOR_OPTIONS: Array<PopoverOption<WorkflowDeterministicOperator>> = [
  { value: "equals", label: "Igual a" },
  { value: "not_equals", label: "Diferente de" },
  { value: "contains", label: "Contém" },
  { value: "not_contains", label: "Não contém" },
  { value: "gt", label: "Maior que (>)" },
  { value: "gte", label: "Maior ou igual (>=)" },
  { value: "lt", label: "Menor que (<)" },
  { value: "lte", label: "Menor ou igual (<=)" },
  { value: "is_true", label: "É verdadeiro" },
  { value: "is_false", label: "É falso" },
  { value: "is_empty", label: "Está vazio" },
  { value: "not_empty", label: "Não está vazio" },
  { value: "regex", label: "Regex" },
];

const UNARY_OPERATORS = new Set<WorkflowDeterministicOperator>([
  "is_true",
  "is_false",
  "is_empty",
  "not_empty",
]);

const COMBINE_OPTIONS: Array<PopoverOption<"and" | "or">> = [
  { value: "and", label: "TODAS (E)" },
  { value: "or", label: "QUALQUER (OU)" },
];

export function WorkflowConditionEditor({
  mode,
  ruleText,
  deterministicRule,
  modelValue,
  modelOptions,
  availableTokens,
  readOnly = false,
  onChangeMode,
  onChangeRuleText,
  onChangeDeterministicRule,
  onChangeModel,
}: {
  mode: WorkflowConditionMode;
  ruleText: string;
  deterministicRule?: WorkflowDeterministicRule;
  modelValue: string;
  modelOptions: Array<PopoverOption<string>>;
  availableTokens: AvailableWorkflowToken[];
  readOnly?: boolean;
  onChangeMode: (nextMode: WorkflowConditionMode) => void;
  onChangeRuleText: (nextText: string) => void;
  onChangeDeterministicRule: (nextRule: WorkflowDeterministicRule) => void;
  onChangeModel: (nextModel: string) => void;
}) {
  const activeRule: WorkflowDeterministicRule = deterministicRule ?? {
    combine: "and",
    clauses: [{ fieldRef: availableTokens[0]?.token ?? "input", operator: "not_empty", value: "" }],
  };

  const fieldOptions: Array<PopoverOption<string>> =
    availableTokens.length > 0
      ? availableTokens.map((t) => ({
          value: t.token,
          label: `{{${t.token}}}`,
          subtitle: t.label,
        }))
      : [{ value: "input", label: "{{input}}", subtitle: "Entrada bruta" }];

  const updateClause = (idx: number, patch: Partial<WorkflowDeterministicClause>) => {
    const nextClauses = activeRule.clauses.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChangeDeterministicRule({ ...activeRule, clauses: nextClauses });
  };

  const addClause = () => {
    onChangeDeterministicRule({
      ...activeRule,
      clauses: [
        ...activeRule.clauses,
        { fieldRef: availableTokens[0]?.token ?? "input", operator: "equals", value: "" },
      ],
    });
  };

  const removeClause = (idx: number) => {
    const nextClauses = activeRule.clauses.filter((_, i) => i !== idx);
    onChangeDeterministicRule({
      ...activeRule,
      clauses: nextClauses.length > 0 ? nextClauses : [{ fieldRef: "input", operator: "not_empty" }],
    });
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-[#181818] p-1">
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChangeMode("deterministic")}
          className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
            mode === "deterministic"
              ? "bg-[#31CF76]/20 text-[#31CF76]"
              : "text-[#979797] hover:text-white"
          }`}
        >
          Determinística (R$ 0)
        </button>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChangeMode("ai")}
          className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
            mode === "ai"
              ? "bg-[#42A0FF]/20 text-[#42A0FF]"
              : "text-[#979797] hover:text-white"
          }`}
        >
          Avaliação por IA
        </button>
      </div>

      {mode === "deterministic" ? (
        <div className="space-y-2 rounded-lg border border-white/[0.08] bg-[#181818] p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[#979797]">Combinar regras:</span>
            <div className="w-36">
              <CarbonMenuPicker
                value={activeRule.combine}
                disabled={readOnly}
                options={COMBINE_OPTIONS}
                ariaLabel="Combinador lógico"
                onChange={(combine) => onChangeDeterministicRule({ ...activeRule, combine })}
              />
            </div>
          </div>

          <div className="space-y-2">
            {activeRule.clauses.map((clause, idx) => {
              const needsValue = !UNARY_OPERATORS.has(clause.operator);
              return (
                <div
                  key={`${clause.fieldRef}-${idx}`}
                  className="space-y-1.5 rounded-lg border border-white/[0.06] bg-[#242424] p-2"
                >
                  <div className="flex items-center gap-1">
                    <div className="min-w-0 flex-1">
                      <CarbonMenuPicker
                        value={clause.fieldRef || "input"}
                        disabled={readOnly}
                        options={fieldOptions}
                        ariaLabel="Campo avaliado"
                        onChange={(fieldRef) => updateClause(idx, { fieldRef })}
                      />
                    </div>
                    {!readOnly && activeRule.clauses.length > 1 && (
                      <button
                        type="button"
                        aria-label="Remover cláusula"
                        onClick={() => removeClause(idx)}
                        className="rounded p-1 text-[#979797] hover:text-[#FD2F3B]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <CarbonMenuPicker
                    value={clause.operator}
                    disabled={readOnly}
                    options={OPERATOR_OPTIONS}
                    ariaLabel="Operador determinístico"
                    onChange={(operator) => updateClause(idx, { operator })}
                  />

                  {needsValue && (
                    <input
                      type="text"
                      readOnly={readOnly}
                      value={clause.value ?? ""}
                      placeholder="Valor de comparação..."
                      onChange={(e) => updateClause(idx, { value: e.target.value })}
                      className="w-full rounded border border-white/[0.08] bg-[#141414] px-2 py-1 text-[12px] text-[#DCDCDC] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#007CF7]"
                    />
                  )}
                </div>
              );
            })}
          </div>

          {!readOnly && (
            <button
              type="button"
              onClick={addClause}
              className="flex w-full items-center justify-center gap-1 rounded-lg border border-white/[0.08] bg-[#242424] py-1 text-[11px] font-medium text-[#42A0FF] hover:bg-[#2A2A2A]"
            >
              <Plus className="h-3 w-3" />
              <span>Adicionar condição</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            readOnly={readOnly}
            rows={2}
            value={ruleText}
            onChange={(e) => onChangeRuleText(e.target.value)}
            placeholder="Ex.: A legenda tem menos de 2200 caracteres e inclui CTA?"
            className="w-full resize-none rounded-lg border border-white/[0.06] bg-[#242424] p-2 text-[14px] text-[#DCDCDC] placeholder:text-[#6A6A6A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
          />
          <CarbonMenuPicker
            value={modelValue}
            disabled={readOnly}
            options={modelOptions}
            ariaLabel="Selecionar modelo da condição"
            onChange={onChangeModel}
          />
        </div>
      )}
    </div>
  );
}
