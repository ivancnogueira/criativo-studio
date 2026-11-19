import React, { useEffect, useMemo, useState } from "react";
import type { NivelEsforco, ProvedorStatusInfo, ProviderName } from "@criativo/contracts";
import { Plus, Search } from "lucide-react";
import { ProviderLogo } from "./ProviderLogo";

interface ModelProviderPopoverProps {
  open: boolean;
  onClose: () => void;
  provedores: ProvedorStatusInfo[];
  selectedModel: string;
  selectedEffort: NivelEsforco;
  onSelectModelAndEffort: (modelId: string, effort: NivelEsforco) => void;
  onOpenConnectors?: () => void;
}

const PROVIDER_ORDER: ProviderName[] = ["claude", "openai", "grok", "opencode", "ollama", "gemini"];

export function inferProviderFromModelId(modelId?: string | null): ProviderName {
  const m = (modelId ?? "").toLowerCase();
  if (m.startsWith("opencode/") || m.endsWith("-free") || m.includes("big-pickle")) return "opencode";
  if (m.includes("claude")) return "claude";
  if (m.includes("grok")) return "grok";
  if (m.includes("ollama") || m.includes("llama") || m.includes("qwen")) return "ollama";
  if (m.includes("gpt") || m.startsWith("o1") || m.startsWith("o3")) return "openai";
  return "gemini";
}

function quotaTextColor(pct: number): string {
  if (pct >= 50) return "text-[#31CF76]";
  if (pct >= 20) return "text-[#FDCB6E]";
  return "text-[#FF7675]";
}

/**
 * Popover unificado Provedor + Modelo + Esforço idêntico ao OpenBot Desktop (Screenshot 5),
 * mostrando contas conectadas, modelos reais descobertos e % restante ao vivo.
 */
export const ModelProviderPopover: React.FC<ModelProviderPopoverProps> = ({
  open,
  onClose,
  provedores,
  selectedModel,
  selectedEffort,
  onSelectModelAndEffort,
  onOpenConnectors,
}) => {
  const [activeProvider, setActiveProvider] = useState<ProviderName>(() =>
    inferProviderFromModelId(selectedModel)
  );
  const [query, setQuery] = useState("");

  const connectedProviderOrder = useMemo(
    () =>
      PROVIDER_ORDER.filter(
        (id) => provedores.find((p) => p.provedor === id)?.conectado
      ),
    [provedores]
  );

  useEffect(() => {
    if (!open || connectedProviderOrder.length === 0) return;
    if (!connectedProviderOrder.includes(activeProvider)) {
      const inferred = inferProviderFromModelId(selectedModel);
      if (connectedProviderOrder.includes(inferred)) {
        setActiveProvider(inferred);
      } else {
        setActiveProvider(connectedProviderOrder[0]!);
      }
      setQuery("");
    }
  }, [open, connectedProviderOrder, activeProvider, selectedModel]);

  const currentProviderInfo = useMemo(() => {
    if (connectedProviderOrder.length === 0) return undefined;
    return (
      provedores.find((p) => p.provedor === activeProvider && p.conectado) ??
      provedores.find((p) => p.provedor === connectedProviderOrder[0])
    );
  }, [provedores, activeProvider, connectedProviderOrder]);

  const filteredModels = useMemo(() => {
    const models = (currentProviderInfo?.modelos ?? []).filter((m) => !m.oculto);
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) => m.rotulo.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    );
  }, [currentProviderInfo, query]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const connectedAccounts = currentProviderInfo?.contas ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Selecionar provedor, modelo e esforço"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] max-h-[82vh] rounded-2xl bg-[#212121] border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.75)] flex overflow-hidden"
      >
        {/* Rail vertical à esquerda apenas com provedores conectados */}
        <div className="w-[50px] shrink-0 bg-[#1A1A1A] border-r border-white/[0.06] py-2.5 flex flex-col items-center justify-between gap-2">
          <div className="flex flex-col items-center gap-1.5">
            {connectedProviderOrder.map((provId) => {
              const active = provId === activeProvider;
              const info = provedores.find((p) => p.provedor === provId);
              return (
                <button
                  key={provId}
                  type="button"
                  onClick={() => {
                    setActiveProvider(provId);
                    setQuery("");
                  }}
                  title={info?.rotulo ?? provId.toUpperCase()}
                  aria-label={`Provedor ${provId}`}
                  className={`relative h-9 w-9 rounded-xl flex items-center justify-center transition-colors ${
                    active
                      ? "bg-[#2A2A2A] text-white ring-1 ring-white/15"
                      : "text-[#979797] hover:bg-[#242424] hover:text-white"
                  }`}
                >
                  <ProviderLogo provider={provId} size={17} />
                  {info?.conectado && (
                    <span className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-[#31CF76]" />
                  )}
                </button>
              );
            })}
          </div>

          {onOpenConnectors && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenConnectors();
              }}
              title="Conectar mais provedores ou contas"
              aria-label="Conectar provedor"
              className="h-8 w-8 rounded-lg flex items-center justify-center text-[#979797] hover:text-white hover:bg-[#242424]"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Painel direito: status conta/CLI + busca + modelos reais + esforço */}
        <div className="flex-1 p-3.5 flex flex-col gap-3 min-w-0">
          {connectedProviderOrder.length === 0 ? (
            <div className="py-8 px-3 text-center space-y-3">
              <p className="text-[13px] font-semibold text-white">
                Nenhum provedor de IA conectado
              </p>
              <p className="text-[12px] text-[#979797]">
                Conecte uma conta (Google Antigravity, Claude, ChatGPT, OpenCode, Ollama ou API Key) para listar os modelos reais disponíveis.
              </p>
              {onOpenConnectors && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenConnectors();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#007CF7] px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-[#198BFF]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Conectar provedor</span>
                </button>
              )}
            </div>
          ) : (
            <>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-[14px] font-semibold text-white truncate">
                    {currentProviderInfo?.rotulo ?? activeProvider}
                  </h4>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10.5px] font-medium px-2 py-0.5 rounded-full bg-white/[0.06] text-[#DCDCDC] tabular-nums">
                      {filteredModels.length} {filteredModels.length === 1 ? "modelo" : "modelos"}
                    </span>
                    <span
                      className={`text-[10.5px] font-medium px-2 py-0.5 rounded-full ${
                        currentProviderInfo?.conectado
                          ? "bg-[#31CF76]/15 text-[#31CF76]"
                          : "bg-white/[0.06] text-[#979797]"
                      }`}
                    >
                      {currentProviderInfo?.conectado ? "Conectado" : "Disponível"}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-[#979797] mt-0.5 truncate">
                  {connectedAccounts.length > 0
                    ? `${connectedAccounts.length} conta(s): ${connectedAccounts.map((a) => a.email ?? a.rotulo ?? a.id).join(", ")}`
                    : currentProviderInfo?.cli_versao
                      ? `${currentProviderInfo.cli_versao} (CLI local)`
                      : currentProviderInfo?.vault_configurado
                        ? "API Key segura no Cofre AES-256-GCM"
                        : currentProviderInfo?.subtitulo}
                </p>
              </div>

              <div className="relative">
                <Search className="h-3.5 w-3.5 text-[#6A6A6A] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="popover-search-models"
                  name="buscar_modelos"
                  aria-label="Buscar modelos"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar modelos"
                  className="w-full h-[32px] rounded-xl bg-[#2A2A2A] border border-white/[0.06] pl-8 pr-3 text-[12px] text-white placeholder-[#6A6A6A] focus:outline-none focus:border-white/20"
                />
              </div>

              <div className="space-y-1 max-h-[420px] sm:max-h-[60vh] overflow-y-auto pr-1">
            {filteredModels.map((model) => {
              const isSelected = selectedModel === model.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    onSelectModelAndEffort(model.id, selectedEffort);
                    onClose();
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-left transition-colors ${
                    isSelected ? "bg-[#2A2A2A]" : "hover:bg-white/[0.05]"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${
                        isSelected
                          ? "bg-white border-white text-[#141414]"
                          : "border-white/25"
                      }`}
                    >
                      {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-[#141414]" />}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium text-white truncate">
                        {model.rotulo}
                      </div>
                      {model.suporta_imagem && (
                        <div className="text-[10px] text-[#74B9FF]">Geração de imagem</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {model.gratuito && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#31CF76]/15 text-[#31CF76]">
                        Grátis
                      </span>
                    )}
                    {typeof model.restante_percentual === "number" && (
                      <span
                        className={`text-[10.5px] font-semibold tabular-nums ${quotaTextColor(
                          model.restante_percentual
                        )}`}
                      >
                        {model.restante_percentual}%
                      </span>
                    )}
                    {model.padrao && (
                      <span className="text-[10.5px] text-[#6A6A6A]">padrão</span>
                    )}
                  </div>
                </button>
              );
            })}
            {filteredModels.length === 0 && (
              <div className="py-5 text-center text-[11.5px] text-[#7D7D7D]">
                Nenhum modelo visível para este provedor. Ajuste em Provedores de IA.
              </div>
            )}
          </div>

          {/* Seletor Esforço segmentado limpo (zero dropdown nativo) */}
              <div className="pt-2.5 border-t border-white/[0.06] flex items-center justify-between gap-3">
                <span className="text-[12px] text-[#DCDCDC]">Esforço</span>
                <div className="inline-flex items-center rounded-lg bg-[#1A1A1A] border border-white/10 p-0.5">
                  {(["baixo", "medio", "alto"] as NivelEsforco[]).map((eff) => (
                    <button
                      key={eff}
                      type="button"
                      onClick={() => onSelectModelAndEffort(selectedModel, eff)}
                      className={`px-2.5 py-1 rounded-md text-[11.5px] font-medium capitalize transition-colors ${
                        selectedEffort === eff
                          ? "bg-[#2E2E2E] text-white"
                          : "text-[#888] hover:text-white"
                      }`}
                    >
                      {eff === "medio" ? "Médio" : eff === "alto" ? "Alto" : "Baixo"}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
