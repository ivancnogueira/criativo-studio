import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgenteRegistro,
  GithubImportPreview,
  MarketplaceAgentPackage,
  MarketplaceAppItem,
  MarketplaceAuthFlow,
  MarketplaceSkillItem,
  MarketplaceSourceFilter,
  MarketplaceTab,
  McpAcessoAgentes,
  McpOAuthStatus,
  McpProbeResultado,
  McpServidorConfig,
  McpTransporte,
  NativeAppAccountSummary,
} from "@criativo/contracts";
import {
  AlertTriangle,
  ArrowLeft,
  Blocks,
  Bot,
  Check,
  Copy,
  Download,
  ExternalLink,
  Github,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

export interface AddToAgentsDialogProps {
  skill: MarketplaceSkillItem | null;
  agentes: AgenteRegistro[];
  onClose: () => void;
  onConfirmBatch: (
    skill: MarketplaceSkillItem,
    nextAgentIds: string[]
  ) => Promise<void>;
}

export function AddToAgentsDialog({
  skill,
  agentes,
  onClose,
  onConfirmBatch,
}: AddToAgentsDialogProps) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!skill) return;
    setSelected(skill.agentIds ?? []);
    setFilter("");
  }, [skill]);

  if (!skill) return null;

  const filtered = agentes.filter(
    (ag) =>
      ag.nome.toLowerCase().includes(filter.toLowerCase()) ||
      ag.papel.toLowerCase().includes(filter.toLowerCase())
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      await onConfirmBatch(skill, selected);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Adicionar habilidade ${skill.name} aos Criativos`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D0D0D]/80 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-[16px] border border-[#2A2A2A] bg-[#212121] p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-[20px] font-semibold text-[#F0F0F0]">
            Adicionar aos Criativos
          </h3>
          <button
            type="button"
            aria-label="Fechar janela"
            onClick={onClose}
            className="text-[#979797] hover:text-[#F0F0F0]"
          >
            <X size={18} />
          </button>
        </div>

        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar Criativos..."
          className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 text-[14px] text-[#F0F0F0] placeholder-[#979797]"
        />

        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {filtered.map((ag) => {
            const checked = selected.includes(ag.agente_id);
            return (
              <label
                key={ag.agente_id}
                className="flex cursor-pointer items-center justify-between rounded-[10px] border border-[#2A2A2A] bg-[#1A1A1A] px-3 py-2 text-[14px] text-[#F0F0F0]"
              >
                <span className="truncate">{ag.nome}</span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setSelected((prev) =>
                      checked
                        ? prev.filter((id) => id !== ag.agente_id)
                        : [...prev, ag.agente_id]
                    )
                  }
                  className="accent-[#007CF7]"
                />
              </label>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#2A2A2A] pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0]"
          >
            Manter registro
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="rounded-full bg-[#F0F0F0] px-5 py-2 text-[14px] font-semibold text-[#141414]"
          >
            Atualizar vínculos
          </button>
        </div>
      </div>
    </div>
  );
}

// ====================================================================
// Componente Principal: MarketplacePage (Central Loja Unificada)
// ====================================================================
