import { Download, Eye, FileText } from "lucide-react";
import type { AnexoChat } from "@criativo/contracts";

export function ChatMessageAttachments({
  anexos,
  onOpenImageLightbox,
  onOpenFilePreview,
}: {
  anexos: AnexoChat[];
  onOpenImageLightbox?: (imageUrl: string, alt?: string) => void;
  onOpenFilePreview?: (anexo: AnexoChat) => void;
}) {
  if (!anexos || anexos.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2.5 pt-1">
      {anexos.map((anexo, aIdx) => {
        const isImage = anexo.mime_type.startsWith("image/");
        const isVideo = anexo.mime_type.startsWith("video/");
        return (
          <div
            key={`${anexo.caminho_relativo}-${aIdx}`}
            className="rounded-xl bg-[#212121] border border-white/10 overflow-hidden max-w-[260px]"
          >
            {isImage && (
              <button
                type="button"
                onClick={() => {
                  if (onOpenImageLightbox) {
                    onOpenImageLightbox(anexo.url, anexo.nome);
                  } else {
                    onOpenFilePreview?.(anexo);
                  }
                }}
                aria-label={`Ampliar imagem ${anexo.nome}`}
                className="block w-full text-left"
              >
                <img
                  src={anexo.url}
                  alt={anexo.nome}
                  className="max-h-[240px] w-full object-cover cursor-zoom-in"
                />
              </button>
            )}
            {isVideo && (
              <video src={anexo.url} controls className="max-h-[240px] w-full" />
            )}
            <div className="px-3 py-2 flex items-center justify-between gap-2 text-[11.5px] text-[#DCDCDC]">
              <div className="flex items-center gap-1.5 min-w-0">
                {!isImage && !isVideo && (
                  <FileText className="h-3.5 w-3.5 text-[#42A0FF] shrink-0" />
                )}
                <span className="truncate">{anexo.nome}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {onOpenFilePreview && (
                  <button
                    type="button"
                    onClick={() => onOpenFilePreview(anexo)}
                    title="Abrir prévia"
                    aria-label={`Abrir prévia de ${anexo.nome}`}
                    className="text-[#979797] hover:text-white"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                )}
                <a
                  href={anexo.url}
                  download={anexo.nome}
                  title="Baixar arquivo"
                  className="text-[#979797] hover:text-white shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
