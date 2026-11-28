import React, { useState } from "react";
import type { DeliverableSourceType, PublicDeliverableRecord } from "@criativo/contracts";
import { ExternalLink, Globe, ShieldCheck, Trash2, UploadCloud } from "lucide-react";
import { commentDmApi } from "../../../lib/comment-dm-api";
import { CommentDmSelect } from "./CommentDmSelect";

export interface CommentDmDeliverablesPanelProps {
  deliverables: PublicDeliverableRecord[];
  onChanged: () => Promise<void>;
}

export const CommentDmDeliverablesPanel: React.FC<CommentDmDeliverablesPanelProps> = ({
  deliverables,
  onChanged,
}) => {
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [sourceType, setSourceType] = useState<DeliverableSourceType>("github_pages");
  const [localFilePath, setLocalFilePath] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [publicBaseUrl, setPublicBaseUrl] = useState("");
  const [githubOwner, setGithubOwner] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const handlePublish = async (evt: React.FormEvent) => {
    evt.preventDefault();
    setErrorMsg(null);
    setPublishing(true);
    try {
      await commentDmApi.publishDeliverable({
        titulo: titulo.trim(),
        descricao: descricao.trim(),
        source_type: sourceType,
        local_file_path: localFilePath.trim() || null,
        external_https_url: externalUrl.trim() || null,
        public_base_url: publicBaseUrl.trim() || null,
        github_owner: githubOwner.trim() || null,
        github_repo: githubRepo.trim() || null,
        github_token: githubToken.trim() || null,
      });
      setTitulo("");
      setDescricao("");
      setLocalFilePath("");
      setExternalUrl("");
      await onChanged();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro ao publicar entregável.");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <form
        onSubmit={(e) => void handlePublish(e)}
        className="rounded-xl border border-white/[0.08] bg-[#171717] p-4 space-y-3 text-xs"
      >
        <div className="flex items-center gap-2 font-semibold text-sm">
          <UploadCloud className="h-4 w-4 text-[#31CF76]" />
          Publicar Entregável Público (HTTPS Seguro)
        </div>
        <p className="text-[11px] text-neutral-400">
          O CriativoOS bloqueia estritamente IPs brutos de VPS e endereços locais (`http://`, `localhost`).
          No Desktop Local ou VPS sem domínio, o padrão recomendado é <strong>GitHub Pages</strong>.
        </p>

        <div className="space-y-1">
          <span className="text-neutral-300">Destino público</span>
          <CommentDmSelect
            value={sourceType}
            onChange={(v) => setSourceType(v as DeliverableSourceType)}
            options={[
              { value: "github_pages", label: "GitHub Pages (Padrão Grátis · HTTPS 24/7)" },
              { value: "showcase_https", label: "Showcase VPS (Somente Domínio HTTPS)" },
              { value: "external_https", label: "Link HTTPS Externo (Drive / Notion)" },
            ]}
          />
        </div>

        <label className="block space-y-1">
          <span className="text-neutral-300">Título do entregável</span>
          <input
            required
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex.: Checklist Estratégico [NOME_DA_MARCA]"
            className="w-full rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-white"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-neutral-300">Descrição breve</span>
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-white"
          />
        </label>

        {sourceType !== "external_https" && (
          <label className="block space-y-1">
            <span className="text-neutral-300">Arquivo no workspace (ex.: saidas/guia.pdf · opcional)</span>
            <input
              value={localFilePath}
              onChange={(e) => setLocalFilePath(e.target.value)}
              placeholder="saidas/material.pdf"
              className="w-full rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-white"
            />
          </label>
        )}

        {sourceType === "github_pages" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              value={githubOwner}
              onChange={(e) => setGithubOwner(e.target.value)}
              placeholder="Usuário GitHub (Cofre)"
              className="rounded-lg border border-white/10 bg-[#111] px-2.5 py-2 text-white"
            />
            <input
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              placeholder="Repositório Pages"
              className="rounded-lg border border-white/10 bg-[#111] px-2.5 py-2 text-white"
            />
            <input
              type="password"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder="PAT (salvo no Cofre)"
              className="rounded-lg border border-white/10 bg-[#111] px-2.5 py-2 text-white"
            />
          </div>
        )}

        {sourceType === "showcase_https" && (
          <label className="block space-y-1">
            <span className="text-neutral-300">Domínio HTTPS da VPS (nunca IP bruto)</span>
            <input
              required
              value={publicBaseUrl}
              onChange={(e) => setPublicBaseUrl(e.target.value)}
              placeholder="https://estudio.seudominio.invalid"
              className="w-full rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-white"
            />
          </label>
        )}

        {sourceType === "external_https" && (
          <label className="block space-y-1">
            <span className="text-neutral-300">URL HTTPS externa</span>
            <input
              required
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              placeholder="https://exemplo-marca.github.io/guia"
              className="w-full rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-white"
            />
          </label>
        )}

        {errorMsg && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-[11px] text-red-300">
            {errorMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={publishing}
          className="rounded-lg bg-[#31CF76] px-4 py-2 text-xs font-semibold text-[#08120C]"
        >
          {publishing ? "Publicando..." : "Publicar e Adicionar ao Catálogo"}
        </button>
      </form>

      <div className="rounded-xl border border-white/[0.08] bg-[#171717] p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <ShieldCheck className="h-4 w-4 text-[#42A0FF]" />
          Catálogo de Entregáveis Prontos ({deliverables.length})
        </div>
        {deliverables.length === 0 ? (
          <p className="text-xs text-neutral-500">
            Nenhum entregável publicado ainda. Publique ao lado ou peça ao Diretor de Operações no chat.
          </p>
        ) : (
          <div className="space-y-2.5">
            {deliverables.map((d) => (
              <div
                key={d.deliverable_id}
                className="rounded-lg border border-white/10 bg-[#121212] p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="text-xs font-semibold truncate">{d.titulo}</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-[#42A0FF] truncate">
                    <Globe className="h-3 w-3 shrink-0" />
                    <span className="truncate">{d.public_https_url}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href={d.public_https_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded border border-white/10 p-1.5 text-neutral-300 hover:text-white"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => void commentDmApi.deleteDeliverable(d.deliverable_id).then(onChanged)}
                    className="rounded border border-red-500/20 p-1.5 text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
