import {
  ExternalLink,
  Globe,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { ConnectorsPageProps } from "./connectors-types";
import type { ConnectorsController } from "./useConnectorsController";

export function ConnectorsShowcaseTab({
  ctrl,
  props,
}: {
  ctrl: ConnectorsController;
  props: ConnectorsPageProps;
}) {
  const {
    showcaseSites = [],
    onPublishShowcase,
    onReplaceShowcase,
    onDeleteShowcase,
  } = props;
  const {
    hubTab,
    showcaseSlug,
    setShowcaseSlug,
    showcaseTitle,
    setShowcaseTitle,
    showcaseDesc,
    setShowcaseDesc,
    showcaseSourceDir,
    setShowcaseSourceDir,
    showcaseSpa,
    setShowcaseSpa,
    pendingPublishApproval,
    setPendingPublishApproval,
    replacingSite,
    setReplacingSite,
    replaceSourceDir,
    setReplaceSourceDir,
    confirmDeleteSiteId,
    setConfirmDeleteSiteId,
    showcaseBusy,
    setShowcaseBusy,
    showToast,
  } = ctrl;

  return (
    <>
            {/* ABA SHOWCASE LOCAL */}
            {hubTab === "showcase" && (
              <div className="space-y-5 pb-6">
                <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-[16px] font-semibold text-white">
                        Publicar entregável no Showcase Local
                      </h2>
                      <p className="text-[12px] text-[#979797] mt-0.5">
                        Hospede páginas estáticas ou prévias HTML aprovadas localmente na rota{" "}
                        <code className="text-[#42A0FF]">/showcase/:slug/</code> sem expor pastas do sistema.
                      </p>
                    </div>
                    <span className="rounded-full bg-[#007CF7]/15 px-3 py-1 text-[11px] font-semibold text-[#42A0FF]">
                      Aprovação humana obrigatória
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label htmlFor="showcase-slug" className="text-[11.5px] font-medium text-[#DCDCDC]">
                        Slug da URL pública local
                      </label>
                      <input
                        id="showcase-slug"
                        type="text"
                        value={showcaseSlug}
                        onChange={(e) => setShowcaseSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, "-"))}
                        placeholder="ex: campanha-lancamento"
                        className="w-full rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[12.5px] text-white placeholder-[#6A6A6A]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="showcase-title" className="text-[11.5px] font-medium text-[#DCDCDC]">
                        Título do site
                      </label>
                      <input
                        id="showcase-title"
                        type="text"
                        value={showcaseTitle}
                        onChange={(e) => setShowcaseTitle(e.target.value)}
                        placeholder="ex: Landing Page Campanha"
                        className="w-full rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[12.5px] text-white placeholder-[#6A6A6A]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label htmlFor="showcase-source-dir" className="text-[11.5px] font-medium text-[#DCDCDC]">
                        Pasta aprovada de origem
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          id="showcase-source-dir"
                          type="text"
                          value={showcaseSourceDir}
                          onChange={(e) => setShowcaseSourceDir(e.target.value)}
                          placeholder="saidas/ ou previas/"
                          className="flex-1 rounded-xl bg-[#141414] border border-white/10 px-3 py-2 font-mono text-[12px] text-white placeholder-[#6A6A6A]"
                        />
                        {["saidas/", "previas/"].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setShowcaseSourceDir(preset)}
                            className={`rounded-lg border px-2.5 py-2 font-mono text-[11px] ${
                              showcaseSourceDir === preset
                                ? "border-[#007CF7] bg-[#007CF7]/15 text-[#42A0FF]"
                                : "border-white/10 bg-[#141414] text-[#979797] hover:text-white"
                            }`}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="showcase-desc" className="text-[11.5px] font-medium text-[#DCDCDC]">
                        Descrição
                      </label>
                      <input
                        id="showcase-desc"
                        type="text"
                        value={showcaseDesc}
                        onChange={(e) => setShowcaseDesc(e.target.value)}
                        placeholder="Resumo opcional do entregável"
                        className="w-full rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[12.5px] text-white placeholder-[#6A6A6A]"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showcaseSpa}
                      onClick={() => setShowcaseSpa((v) => !v)}
                      className="inline-flex items-center gap-2 text-[12px] text-[#DCDCDC]"
                    >
                      <span
                        className={`inline-flex h-5 w-9 rounded-full border transition-colors ${
                          showcaseSpa ? "border-[#007CF7] bg-[#007CF7]" : "border-white/15 bg-[#141414]"
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 translate-y-0.5 rounded-full bg-white transition-transform ${
                            showcaseSpa ? "translate-x-4" : "translate-x-0.5"
                          }`}
                        />
                      </span>
                      <span>Fallback SPA (`index.html` para rotas internas)</span>
                    </button>

                    {!pendingPublishApproval ? (
                      <button
                        type="button"
                        disabled={!showcaseSlug.trim() || !showcaseTitle.trim() || !showcaseSourceDir.trim() || !onPublishShowcase}
                        onClick={() => setPendingPublishApproval(true)}
                        className="rounded-xl bg-[#F0F0F0] hover:bg-white text-[#141414] px-4 py-2 text-[12.5px] font-semibold disabled:opacity-40"
                      >
                        Publicar showcase
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 rounded-xl border border-[#FF9412]/50 bg-[#FF9412]/10 px-3 py-2">
                        <span className="text-[12px] text-[#FF9412]">
                          Confirmar publicação de <strong>/showcase/{showcaseSlug}/</strong>?
                        </span>
                        <button
                          type="button"
                          disabled={showcaseBusy}
                          onClick={async () => {
                            if (!onPublishShowcase) return;
                            setShowcaseBusy(true);
                            try {
                              const res = await onPublishShowcase({
                                slug: showcaseSlug.trim(),
                                titulo: showcaseTitle.trim(),
                                descricao: showcaseDesc.trim() || undefined,
                                sourceDir: showcaseSourceDir.trim(),
                                spaFallback: showcaseSpa,
                                aprovadoPorHumano: true,
                              });
                              if (res.ok) {
                                setShowcaseSlug("");
                                setShowcaseTitle("");
                                setShowcaseDesc("");
                                setPendingPublishApproval(false);
                                showToast("Site publicado com sucesso no Showcase Local.");
                              } else {
                                showToast(res.erro || "Não foi possível publicar o showcase.");
                              }
                            } finally {
                              setShowcaseBusy(false);
                            }
                          }}
                          className="rounded-lg bg-[#31CF76] px-3 py-1 text-[11.5px] font-semibold text-[#141414]"
                        >
                          Confirmar publicação
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingPublishApproval(false)}
                          className="rounded-lg bg-[#2A2A2A] px-2.5 py-1 text-[11.5px] text-white"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {showcaseSites.length === 0 ? (
                  <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] p-8 text-center space-y-2">
                    <Globe className="h-7 w-7 text-[#42A0FF] mx-auto" />
                    <p className="text-[13px] text-[#979797]">
                      Nenhum site publicado localmente. Publique uma pasta de entregáveis aprovada.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {showcaseSites.map((site) => (
                      <div
                        key={site.site_id}
                        className="rounded-2xl bg-[#18181A] border border-white/[0.07] p-4 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[14px] font-semibold text-white truncate">
                                {site.titulo}
                              </span>
                              <span className="rounded-full bg-[#31CF76]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#31CF76]">
                                {site.ativo ? "Ativo" : "Inativo"}
                              </span>
                            </div>
                            <div className="text-[11.5px] font-mono text-[#42A0FF] truncate">
                              {site.url_local || `/showcase/${site.slug}/`}
                            </div>
                            {site.descricao && (
                              <p className="text-[12px] text-[#979797] mt-0.5">{site.descricao}</p>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <a
                              href={site.url_local || `/showcase/${site.slug}/`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-white"
                            >
                              <ExternalLink className="h-3.5 w-3.5 text-[#42A0FF]" />
                              <span>Abrir showcase</span>
                            </a>
                            {onReplaceShowcase && (
                              <button
                                type="button"
                                onClick={() => {
                                  setReplacingSite(site);
                                  setReplaceSourceDir(site.source_dir || "saidas/");
                                }}
                                className="inline-flex items-center gap-1 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-[#DCDCDC]"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                                <span>Substituir arquivos</span>
                              </button>
                            )}
                            {onDeleteShowcase && (
                              confirmDeleteSiteId === site.site_id ? (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    disabled={showcaseBusy}
                                    onClick={async () => {
                                      setShowcaseBusy(true);
                                      try {
                                        await onDeleteShowcase(site.site_id);
                                        setConfirmDeleteSiteId(null);
                                        showToast("Site despublicado do Showcase Local.");
                                      } finally {
                                        setShowcaseBusy(false);
                                      }
                                    }}
                                    className="rounded-lg bg-[#FD2F3B] px-2.5 py-1.5 text-[11.5px] font-semibold text-white"
                                  >
                                    Confirmar despublicação
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteSiteId(null)}
                                    className="rounded-lg bg-[#2A2A2A] px-2.5 py-1.5 text-[11.5px] text-white"
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteSiteId(site.site_id)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-[#FD2F3B]/30 bg-[#FD2F3B]/10 px-3 py-1.5 text-[12px] font-semibold text-[#FF7675] hover:bg-[#FD2F3B]/20"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  <span>Despublicar site</span>
                                </button>
                              )
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono text-[#787878] border-t border-white/[0.05] pt-2">
                          <span>Origem: {site.source_dir}</span>
                          <span>Arquivos: {site.arquivos_count ?? 0}</span>
                          {typeof site.tamanho_bytes === "number" && (
                            <span>{(site.tamanho_bytes / 1024).toFixed(1)} KB</span>
                          )}
                        </div>

                        {replacingSite?.site_id === site.site_id && onReplaceShowcase && (
                          <div className="rounded-xl border border-[#007CF7]/40 bg-[#141414] p-3 flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              value={replaceSourceDir}
                              onChange={(e) => setReplaceSourceDir(e.target.value)}
                              aria-label="Nova pasta aprovada para substituição"
                              placeholder="saidas/..."
                              className="flex-1 rounded-lg bg-[#212121] border border-white/10 px-3 py-1.5 font-mono text-[12px] text-white"
                            />
                            <button
                              type="button"
                              disabled={showcaseBusy || !replaceSourceDir.trim()}
                              onClick={async () => {
                                setShowcaseBusy(true);
                                try {
                                  const res = await onReplaceShowcase(site.site_id, {
                                    sourceDir: replaceSourceDir.trim(),
                                    aprovadoPorHumano: true,
                                  });
                                  if (res.ok) {
                                    setReplacingSite(null);
                                    showToast("Arquivos do Showcase substituídos.");
                                  } else {
                                    showToast(res.erro || "Falha ao substituir arquivos.");
                                  }
                                } finally {
                                  setShowcaseBusy(false);
                                }
                              }}
                              className="rounded-lg bg-[#007CF7] px-3 py-1.5 text-[11.5px] font-semibold text-white"
                            >
                              Confirmar substituição
                            </button>
                            <button
                              type="button"
                              onClick={() => setReplacingSite(null)}
                              className="rounded-lg bg-[#2A2A2A] px-2.5 py-1.5 text-[11.5px] text-white"
                            >
                              Cancelar
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
    </>
  );
}
