import React, { useRef, useState } from "react";
import type { AnexoChat, ArquivoStudio } from "@criativo/contracts";
import { Download, Film, FolderOpen, Image as ImageIcon, Upload } from "lucide-react";

interface FilesVaultPageProps {
  arquivos: ArquivoStudio[];
  onUploadFile: (file: File) => Promise<AnexoChat>;
}

/**
 * Galeria dedicada 'Arquivos e ImagePaths' para gerir referências faciais, logos e mídias geradas.
 */
export const FilesVaultPage: React.FC<FilesVaultPageProps> = ({ arquivos, onUploadFile }) => {
  const [filter, setFilter] = useState<"todos" | "referencia" | "gerado" | "video">("todos");
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const visible =
    filter === "todos"
      ? arquivos
      : arquivos.filter((a) => a.tipo_uso === filter);

  const handleUpload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(list)) {
        await onUploadFile(file);
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex-1 h-full bg-[#1A1A1A] overflow-y-auto p-6">
      <div className="max-w-[1120px] mx-auto space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-bold text-white flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-[#42A0FF]" />
              Arquivos, ImagePaths &amp; Entregáveis
            </h1>
            <p className="text-[12.5px] text-[#979797]">
              Envie referências reais para o Engenheiro de Consistência e visualize artes PNG e Reels MP4 gerados.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              id="files-page-upload"
              name="files_page_upload"
              aria-label="Selecionar arquivo para upload"
              type="file"
              multiple
              accept="image/*,video/mp4,.pdf,.csv,.srt"
              className="hidden"
              onChange={(e) => {
                void handleUpload(e.target.files);
                e.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="openbot-btn-primary px-4 py-2 text-[12.5px] inline-flex items-center gap-1.5"
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? "Enviando..." : "Enviar Referência ImagePaths"}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {[
            { id: "todos", label: `Todos (${arquivos.length})` },
            { id: "referencia", label: "Referências / Fotos" },
            { id: "gerado", label: "Artes Geradas" },
            { id: "video", label: "Vídeos MP4" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id as typeof filter)}
              className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
                filter === tab.id
                  ? "bg-[#F0F0F0] text-[#141414]"
                  : "bg-[#212121] text-[#979797] hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-[#141414] p-12 text-center">
            <ImageIcon className="h-9 w-9 text-[#6A6A6A] mx-auto mb-2.5" />
            <p className="text-[13.5px] text-[#DCDCDC] font-medium">
              Nenhum arquivo cadastrado nesta categoria ainda
            </p>
            <p className="text-[12px] text-[#6A6A6A] mt-1">
              Suba fotos de rosto, logo da marca ou artes acima para uso nos agentes de imagem.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
            {visible.map((arq) => {
              const isImg = arq.mime_type.startsWith("image/");
              const isVid = arq.mime_type.startsWith("video/");
              return (
                <div
                  key={arq.arquivo_id}
                  className="rounded-2xl bg-[#212121] border border-white/[0.07] overflow-hidden flex flex-col"
                >
                  <div className="aspect-[4/3] bg-[#101010] flex items-center justify-center overflow-hidden">
                    {isImg ? (
                      <img
                        src={arq.url}
                        alt={arq.nome_original}
                        className="h-full w-full object-cover"
                      />
                    ) : isVid ? (
                      <Film className="h-8 w-8 text-[#EF4444]" />
                    ) : (
                      <FolderOpen className="h-8 w-8 text-[#42A0FF]" />
                    )}
                  </div>
                  <div className="p-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium text-white truncate">
                        {arq.nome_original}
                      </div>
                      <div className="text-[10.5px] text-[#979797] truncate">
                        {arq.tipo_uso} · {(arq.tamanho_bytes / 1024).toFixed(1)} KB
                      </div>
                    </div>
                    <a
                      href={arq.url}
                      download={arq.nome_original}
                      className="h-8 w-8 rounded-lg bg-[#2A2A2A] hover:bg-[#333336] flex items-center justify-center text-white shrink-0"
                      title="Baixar"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
