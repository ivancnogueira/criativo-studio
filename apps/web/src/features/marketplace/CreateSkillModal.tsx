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
import {
  AppBrandIcon,
  CarbonSelect,
  SlidingTabs,
  type CarbonSelectOption,
} from "../../components/ui/CarbonControls";
import { daemonApi } from "../../services/websocket-client";
import { SKILL_CATEGORY_OPTIONS, slugifyLocal } from "./marketplace-helpers";

export interface CreateSkillModalProps {
  open: boolean;
  agentes: AgenteRegistro[];
  defaultAgentId?: string;
  onClose: () => void;
  onCreated?: (skill: MarketplaceSkillItem) => void;
  onCreateWithAgent?: (agentId: string, prompt: string) => void;
}

export function CreateSkillModal({
  open,
  agentes,
  defaultAgentId = "estrategista",
  onClose,
  onCreated,
  onCreateWithAgent,
}: CreateSkillModalProps) {
  const [mode, setMode] = useState<"assisted" | "manual">("manual");
  const [assistantAgentId, setAssistantAgentId] = useState(defaultAgentId);
  const [assistedGoal, setAssistedGoal] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [category, setCategory] = useState("Automação & Rotinas");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<string[]>([defaultAgentId]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setSlug("");
    setSlugEdited(false);
    setDescription("");
    setInstructions("");
    setAssistedGoal("");
    setErrorMsg(null);
  }, [open]);

  if (!open) return null;

  const agentSelectOptions: CarbonSelectOption[] = agentes.map((ag) => ({
    value: ag.agente_id,
    label: ag.nome,
    description: ag.papel,
  }));

  const handleNameChange = (nextName: string) => {
    setName(nextName);
    if (!slugEdited) {
      setSlug(slugifyLocal(nextName));
    }
  };

  const handleStartAssisted = () => {
    const prompt = assistedGoal.trim()
      ? `Crie uma nova habilidade reutilizável usando a ferramenta create_skill com objetivo: ${assistedGoal.trim()}`
      : "Me ajude a projetar e registrar uma nova habilidade personalizada (SKILL.md) usando a ferramenta create_skill.";
    onCreateWithAgent?.(assistantAgentId, prompt);
    onClose();
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!name.trim() || !description.trim() || !instructions.trim()) {
      setErrorMsg("Preencha nome, descrição curta e instruções completas da habilidade.");
      return;
    }
    setSaving(true);
    try {
      const created = await daemonApi.createCustomSkill({
        name: name.trim(),
        slug: slug.trim() || slugifyLocal(name),
        description: description.trim(),
        category,
        instructions: instructions.trim(),
        agentIds: selectedAgents,
      });
      onCreated?.(created);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Falha ao criar habilidade.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Criar nova habilidade"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D0D0D]/80 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[16px] border border-[#2A2A2A] bg-[#212121] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#2A2A2A] px-6 py-4">
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-[#007CF7]" />
            <h2 className="text-[20px] font-semibold text-[#F0F0F0]">
              Criar nova habilidade
            </h2>
          </div>
          <button
            type="button"
            aria-label="Fechar janela"
            onClick={onClose}
            className="rounded-[8px] p-1 text-[#979797] hover:bg-[#2A2A2A] hover:text-[#F0F0F0]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <SlidingTabs<"assisted" | "manual">
            ariaLabel="Modo de criação da habilidade"
            value={mode}
            onChange={setMode}
            tabs={[
              { id: "assisted", label: "Assistida por agente" },
              { id: "manual", label: "Definição manual" },
            ]}
          />

          {mode === "assisted" ? (
            <div className="space-y-4 rounded-[12px] border border-[#2A2A2A] bg-[#1A1A1A] p-4">
              <p className="text-[14px] text-[#DCDCDC]">
                Descreva o que a habilidade deve ensinar ao agente. Abriremos uma conversa pronta para gerar e registrar o arquivo `SKILL.md` com `create_skill`.
              </p>
              <div className="space-y-1">
                <span className="block text-[14px] font-semibold text-[#F0F0F0]">
                  Agente responsável
                </span>
                <CarbonSelect
                  ariaLabel="Selecionar agente criador da habilidade"
                  value={assistantAgentId}
                  options={agentSelectOptions}
                  onChange={setAssistantAgentId}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="skill-assisted-goal" className="block text-[14px] font-semibold text-[#F0F0F0]">
                  Objetivo da habilidade
                </label>
                <textarea
                  id="skill-assisted-goal"
                  rows={4}
                  value={assistedGoal}
                  onChange={(e) => setAssistedGoal(e.target.value)}
                  placeholder="Ex.: Checklist editorial para revisar carrosséis antes da aprovação humana..."
                  className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 text-[14px] text-[#F0F0F0] placeholder-[#979797] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0]"
                >
                  Descartar alterações
                </button>
                <button
                  type="button"
                  onClick={handleStartAssisted}
                  className="rounded-full bg-[#F0F0F0] px-5 py-2 text-[14px] font-semibold text-[#141414]"
                >
                  Criar habilidade
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor="skill-name" className="block text-[14px] font-semibold text-[#F0F0F0]">
                    Nome da habilidade
                  </label>
                  <input
                    id="skill-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="Auditoria de Legendas"
                    className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 text-[14px] text-[#F0F0F0] placeholder-[#979797] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="skill-slug" className="block text-[14px] font-semibold text-[#F0F0F0]">
                    Identificador (slug)
                  </label>
                  <input
                    id="skill-slug"
                    type="text"
                    value={slug}
                    onChange={(e) => {
                      setSlugEdited(true);
                      setSlug(slugifyLocal(e.target.value));
                    }}
                    placeholder="auditoria-de-legendas"
                    className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 font-mono text-[12px] text-[#F0F0F0] placeholder-[#979797]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <span className="block text-[14px] font-semibold text-[#F0F0F0]">Categoria</span>
                  <CarbonSelect
                    ariaLabel="Categoria da habilidade"
                    value={category}
                    options={SKILL_CATEGORY_OPTIONS}
                    onChange={setCategory}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="skill-desc" className="block text-[14px] font-semibold text-[#F0F0F0]">
                    Descrição curta
                  </label>
                  <input
                    id="skill-desc"
                    type="text"
                    required
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Quando ativar esta habilidade durante a conversa"
                    className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 text-[14px] text-[#F0F0F0] placeholder-[#979797]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="skill-md" className="block text-[14px] font-semibold text-[#F0F0F0]">
                  Instruções completas (SKILL.md)
                </label>
                <textarea
                  id="skill-md"
                  required
                  rows={6}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="# Regras de execução&#10;1. Verifique gancho inicial..."
                  className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 font-mono text-[12px] text-[#F0F0F0] placeholder-[#979797]"
                />
              </div>

              <div className="space-y-2">
                <span className="block text-[14px] font-semibold text-[#F0F0F0]">
                  Vincular aos agentes ({selectedAgents.length})
                </span>
                <div className="grid max-h-32 grid-cols-1 gap-1.5 overflow-y-auto rounded-[10px] border border-[#2A2A2A] bg-[#1A1A1A] p-3 md:grid-cols-2">
                  {agentes.map((ag) => {
                    const checked = selectedAgents.includes(ag.agente_id);
                    return (
                      <label
                        key={ag.agente_id}
                        className="flex cursor-pointer items-center gap-2 rounded-[8px] bg-[#242424] px-2.5 py-1.5 text-[12px] text-[#F0F0F0]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedAgents((prev) =>
                              checked
                                ? prev.filter((id) => id !== ag.agente_id)
                                : [...prev, ag.agente_id]
                            )
                          }
                          className="accent-[#007CF7]"
                        />
                        <span className="truncate">{ag.nome}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {errorMsg && (
                <div className="rounded-[10px] border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 px-4 py-2 text-[12px] text-[#FD2F3B]">
                  {errorMsg}
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-[#2A2A2A] pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0]"
                >
                  Descartar alterações
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full bg-[#F0F0F0] px-5 py-2 text-[14px] font-semibold text-[#141414] disabled:opacity-50"
                >
                  {saving ? "Salvando..." : "Criar habilidade"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ====================================================================
// Dialog auxiliar: AddToAgentsDialog (vinculação em lote + 6s Undo)
// ====================================================================
