import {
  RefreshCw,
} from "lucide-react";
import { daemonApi } from "../../services/websocket-client";
import { SwitchPill, formatPlatformLabel } from "./providers-catalog-helpers";
import type { ProvidersCatalogController } from "./useProvidersCatalogController";

export function ProviderDetailConfigSection({ ctrl }: { ctrl: ProvidersCatalogController }) {
  const {
    onConnectApiKey,
    onDisconnectProvider,
    onRefreshProviders,
    onSetModelsVisibility,
    activeServerName,
    onShowToast,
    modelQuery,
    setModelQuery,
    editingKey,
    setEditingKey,
    keyDraft,
    setKeyDraft,
    refreshingRuntime,
    setRefreshingRuntime,
    detailProvider,
    filteredModels,
    totalModels,
    visibleModelsCount,
    handleToggleAllModels,
    handleToggleSingleModel,
  } = ctrl;
  if (!detailProvider) return null;
  return (
    <>
        {/* Seção API key (compacta igual Screenshot 1 & 3) */}
        {detailProvider.provedor !== "ollama" && (
          <section className="space-y-2">
            <h4 className="text-[13px] font-medium text-[#E5E5E7]">Chave de API</h4>
            <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] px-4 py-3.5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-medium text-white">
                    {detailProvider.vault_configurado ? "Chave ativa no Cofre" : "Sem chave"}
                  </div>
                  <p className="text-[11.5px] text-[#8E8E93] mt-0.5">
                    {detailProvider.provedor === "opencode"
                      ? "Opcional. Uma chave adiciona modelos pagos do OpenCode Go."
                      : `Ou cole uma chave de API ${detailProvider.rotulo} no Cofre AES-256-GCM.`}
                  </p>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  {detailProvider.provedor === "opencode" && !detailProvider.vault_configurado && (
                    <span className="text-[11.5px] font-medium text-[#8E8E93]">Grátis</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingKey((v) => !v)}
                    className="rounded-xl bg-[#242428] hover:bg-[#303036] border border-white/[0.08] px-3 py-1.5 text-[12px] font-medium text-white"
                  >
                    {detailProvider.vault_configurado ? "Alterar key" : "Add key"}
                  </button>
                </div>
              </div>

              {editingKey && (
                <div className="pt-2.5 border-t border-white/[0.06] flex flex-col sm:flex-row gap-2">
                  <input
                    id={`studio-key-${detailProvider.provedor}`}
                    name={`studio_key_${detailProvider.provedor}`}
                    aria-label={`Chave API de ${detailProvider.rotulo}`}
                    type="password"
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder={`Cole sua chave ${detailProvider.rotulo}...`}
                    className="flex-1 rounded-xl bg-[#111113] border border-white/10 px-3 py-2 text-[12px] text-white placeholder-[#6A6A6A]"
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingKey(false);
                        setKeyDraft("");
                      }}
                      className="rounded-xl bg-[#242428] hover:bg-[#303036] px-3 py-2 text-[12px] text-[#B5B5B5]"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const clean = keyDraft.trim();
                        if (!clean) {
                          onShowToast("Cole uma chave válida antes de salvar.");
                          return;
                        }
                        await onConnectApiKey(detailProvider.provedor, clean);
                        setKeyDraft("");
                        setEditingKey(false);
                        onShowToast(`Chave ${detailProvider.rotulo} salva no Cofre.`);
                      }}
                      className="rounded-xl bg-[#F0F0F0] hover:bg-white text-[#141414] px-3.5 py-2 text-[12px] font-semibold"
                    >
                      Salvar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Seção Runtime */}
        <section className="space-y-2">
          <h4 className="text-[13px] font-medium text-[#E5E5E7]">Runtime</h4>
          <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] divide-y divide-white/[0.05]">
            <div className="px-4 py-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-white">Versão</div>
                <p className="text-[11.5px] text-[#8E8E93] mt-0.5 truncate">
                  {detailProvider.cli_detectado
                    ? `${detailProvider.cli_versao ?? "Instalada no servidor"}${
                        detailProvider.cli_executavel
                          ? ` · ${detailProvider.cli_executavel}`
                          : ""
                      }`
                    : "CLI não detectada neste servidor"}
                </p>
                {(activeServerName || detailProvider.runtime_platform || detailProvider.runtime_host) && (
                  <p className="text-[11px] text-[#6E6E73] mt-0.5 truncate">
                    Ambiente:{" "}
                    {[
                      activeServerName,
                      formatPlatformLabel(detailProvider.runtime_platform),
                      detailProvider.runtime_host,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
              {onRefreshProviders && (
                <button
                  type="button"
                  disabled={refreshingRuntime}
                  onClick={async () => {
                    setRefreshingRuntime(true);
                    try {
                      if (
                        detailProvider.provedor === "openai" ||
                        detailProvider.provedor === "claude" ||
                        detailProvider.provedor === "gemini" ||
                        detailProvider.provedor === "opencode"
                      ) {
                        const up = await daemonApi.upgradeProviderRuntime(detailProvider.provedor);
                        await onRefreshProviders();
                        if (up.ok) {
                          onShowToast(
                            `CLI atualizada (${up.versao ?? "última versão"}) e modelos recarregados.`
                          );
                        } else {
                          onShowToast(up.erro ?? "Detecção de runtime atualizada.");
                        }
                      } else {
                        await onRefreshProviders();
                        onShowToast("Detecção de runtime atualizada.");
                      }
                    } finally {
                      setRefreshingRuntime(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#242428] hover:bg-[#303036] border border-white/[0.08] px-3 py-1.5 text-[12px] font-medium text-white shrink-0"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshingRuntime ? "animate-spin" : ""}`} />
                  <span>Atualizar</span>
                </button>
              )}
            </div>

            {detailProvider.conectado && (
              <div className="px-4 py-3.5 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-medium text-white">Desconectar sessão</div>
                  <p className="text-[11.5px] text-[#8E8E93] mt-0.5">
                    Remove credenciais e contas salvas no Studio para este provedor.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await onDisconnectProvider(detailProvider.provedor);
                    onShowToast(`${detailProvider.rotulo} desconectado.`);
                  }}
                  className="rounded-xl bg-[#242428] hover:bg-[#FD2F3B]/20 border border-white/[0.08] hover:border-[#FD2F3B]/40 px-3 py-1.5 text-[12px] font-medium text-[#E5E5E7] hover:text-[#FF858B] shrink-0"
                >
                  Desconectar
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Seção Modelos (lista vertical 1-por-linha com switches + Ocultar todos) */}
        <section className="space-y-2.5 pb-6">
          <div className="flex items-end justify-between gap-2">
            <div>
              <h4 className="text-[13px] font-medium text-[#E5E5E7]">Modelos</h4>
              <p className="text-[11.5px] text-[#8E8E93] mt-0.5">
                {visibleModelsCount} de {totalModels} modelos aparecem no seletor de modelos.
              </p>
            </div>
            {totalModels > 0 && onSetModelsVisibility && (
              <button
                type="button"
                onClick={() => void handleToggleAllModels()}
                className="text-[12px] font-medium text-[#B5B5BD] hover:text-white transition-colors"
              >
                {visibleModelsCount > 0 ? "Ocultar todos" : "Mostrar todos"}
              </button>
            )}
          </div>

          <input
            id="studio-search-models"
            name="studio_search_models"
            aria-label="Buscar modelos"
            type="text"
            value={modelQuery}
            onChange={(e) => setModelQuery(e.target.value)}
            placeholder="Buscar modelos"
            className="w-full rounded-xl bg-[#18181A] border border-white/[0.08] px-3.5 py-2 text-[12.5px] text-white placeholder-[#78787D] focus:outline-none focus:border-white/25"
          />

          <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] divide-y divide-white/[0.05]">
            {filteredModels.map((model) => {
              const isVisible = !model.oculto;
              return (
                <div
                  key={model.id}
                  className="px-4 py-2.5 flex items-center justify-between gap-3"
                >
                  <div className="flex flex-wrap items-baseline gap-2 min-w-0">
                    <span className="text-[12.5px] font-medium text-white truncate">
                      {model.rotulo}
                    </span>
                    <span className="text-[11.5px] font-mono text-[#7D7D85] truncate">
                      {model.id}
                    </span>
                    {model.suporta_imagem && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#42A0FF]/15 text-[#74B9FF]">
                        Imagem
                      </span>
                    )}
                    {model.gratuito && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#31CF76]/15 text-[#31CF76]">
                        Grátis
                      </span>
                    )}
                    {typeof model.restante_percentual === "number" && (
                      <span className="text-[10.5px] font-semibold text-[#31CF76] tabular-nums">
                        {model.restante_percentual}%
                      </span>
                    )}
                  </div>
                  <SwitchPill
                    checked={isVisible}
                    onChange={() => void handleToggleSingleModel(model.id, Boolean(model.oculto))}
                    ariaLabel={`Exibir modelo ${model.rotulo}`}
                    disabled={!onSetModelsVisibility}
                  />
                </div>
              );
            })}
            {filteredModels.length === 0 && (
              <div className="px-4 py-6 text-center text-[12px] text-[#7D7D85]">
                Nenhum modelo encontrado para &ldquo;{modelQuery}&rdquo;.
              </div>
            )}
          </div>
        </section>
    </>
  );
}
