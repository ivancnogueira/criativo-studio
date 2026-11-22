import React from "react";
import type {
  ArquivoStudio,
  ProviderName,
  WorkflowNo,
  WorkflowTriggerState,
} from "@criativo/contracts";
import {
  Copy,
  FileText,
  Image as ImageIcon,
  Play,
  Settings2,
  Upload,
} from "lucide-react";
import { ProviderLogo } from "../../components/ProviderLogo";
import {
  CarbonMenuPicker,
  EFFORT_OPTIONS,
  TRIGGER_KIND_OPTIONS,
  type PopoverOption,
} from "./workflow-node-helpers";
import type { WorkflowNodeCardProps } from "./WorkflowNodes";

export interface WorkflowNodeBasicFieldsProps {
  props: WorkflowNodeCardProps;
  kind: string;
  cfg: Record<string, unknown>;
  triggerKind: NonNullable<WorkflowNo["triggerKind"]>;
  modelOptions: Array<PopoverOption<string>>;
  selectedAsset: ArquivoStudio | undefined;
  filteredAssets: ArquivoStudio[];
  assetMenuOpen: boolean;
  setAssetMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  assetTab: "recentes" | "imagens" | "arquivos";
  setAssetTab: React.Dispatch<React.SetStateAction<"recentes" | "imagens" | "arquivos">>;
  assetSearch: string;
  setAssetSearch: React.Dispatch<React.SetStateAction<string>>;
  copiedNotice: boolean;
  setCopiedNotice: React.Dispatch<React.SetStateAction<boolean>>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  systemPromptOpen: boolean;
  setSystemPromptOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export function WorkflowNodeBasicFields(ctx: WorkflowNodeBasicFieldsProps) {
  const {
    node,
    readOnly = false,
    triggerState,
    onPatchNode,
    onExecuteStep,
    onOpenTriggerModal,
    onUploadFile,
  } = ctx.props;
  const {
    kind,
    cfg,
    triggerKind,
    modelOptions,
    selectedAsset,
    filteredAssets,
    assetMenuOpen,
    setAssetMenuOpen,
    assetTab,
    setAssetTab,
    assetSearch,
    setAssetSearch,
    copiedNotice,
    setCopiedNotice,
    fileInputRef,
    systemPromptOpen,
    setSystemPromptOpen,
  } = ctx;

  return (
    <>
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
    </>
  );
}
