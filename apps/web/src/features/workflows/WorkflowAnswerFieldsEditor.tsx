import { useState } from "react";
import type { WorkflowAnswerField, WorkflowAnswerFieldType } from "@criativo/contracts";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { CarbonMenuPicker, type PopoverOption } from "./workflow-node-helpers";

const FIELD_TYPE_OPTIONS: Array<PopoverOption<WorkflowAnswerFieldType>> = [
  { value: "text", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "boolean", label: "Booleano" },
  { value: "select", label: "Seleção" },
  { value: "json", label: "JSON" },
];

function sanitizeFieldKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function WorkflowAnswerFieldsEditor({
  fields,
  disabled = false,
  onChange,
}: {
  fields: WorkflowAnswerField[];
  disabled?: boolean;
  onChange: (nextFields: WorkflowAnswerField[]) => void;
}) {
  const [open, setOpen] = useState(fields.length > 0);

  const handleAdd = () => {
    const idx = fields.length + 1;
    const newField: WorkflowAnswerField = {
      id: `af_${Date.now().toString(36)}_${idx}`,
      key: `campo_${idx}`,
      label: `Campo ${idx}`,
      type: "text",
      required: true,
    };
    setOpen(true);
    onChange([...fields, newField]);
  };

  const handleUpdate = (id: string, patch: Partial<WorkflowAnswerField>) => {
    onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const handleRemove = (id: string) => {
    onChange(fields.filter((f) => f.id !== id));
  };

  return (
    <div
      className="rounded-lg border border-white/[0.08] bg-[#1A1A1A] p-2"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-[11px] font-semibold text-[#DCDCDC] hover:text-white"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <span>Answer fields ({fields.length})</span>
        </button>
        {!disabled && (
          <button
            type="button"
            onClick={handleAdd}
            className="flex items-center gap-1 rounded bg-[#2A2A2A] px-1.5 py-0.5 text-[11px] font-medium text-[#42A0FF] hover:bg-[#333333]"
          >
            <Plus className="h-3 w-3" />
            <span>Adicionar</span>
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {fields.length === 0 ? (
            <p className="text-[11px] text-[#979797]">
              Defina campos tipados para usar depois como <code className="text-[#DCDCDC]">{"{{campo}}"}</code>.
            </p>
          ) : (
            fields.map((field) => (
              <div
                key={field.id}
                className="space-y-1.5 rounded-lg border border-white/[0.06] bg-[#242424] p-2"
              >
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    readOnly={disabled}
                    value={field.key}
                    placeholder="chave_slug"
                    onChange={(e) =>
                      handleUpdate(field.id, {
                        key: sanitizeFieldKey(e.target.value),
                        label: field.label || e.target.value,
                      })
                    }
                    className="min-w-0 flex-1 rounded border border-white/[0.08] bg-[#141414] px-1.5 py-1 font-mono text-[11px] text-[#31CF76] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#007CF7]"
                  />
                  <div className="w-24">
                    <CarbonMenuPicker
                      value={field.type}
                      disabled={disabled}
                      options={FIELD_TYPE_OPTIONS}
                      ariaLabel="Tipo do campo estruturado"
                      onChange={(t) => handleUpdate(field.id, { type: t })}
                    />
                  </div>
                  {!disabled && (
                    <button
                      type="button"
                      aria-label="Remover campo"
                      onClick={() => handleRemove(field.id)}
                      className="rounded p-1 text-[#979797] hover:bg-[#2A2A2A] hover:text-[#FD2F3B]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {field.type === "select" && (
                  <input
                    type="text"
                    readOnly={disabled}
                    value={(field.options ?? []).join(", ")}
                    placeholder="Opções separadas por vírgula..."
                    onChange={(e) =>
                      handleUpdate(field.id, {
                        options: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    className="w-full rounded border border-white/[0.08] bg-[#141414] px-1.5 py-1 text-[11px] text-[#DCDCDC]"
                  />
                )}

                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[#979797]">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={Boolean(field.required)}
                    onChange={(e) => handleUpdate(field.id, { required: e.target.checked })}
                    className="accent-[#31CF76]"
                  />
                  <span>Campo obrigatório na saída</span>
                </label>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
