import React, { useCallback, useEffect, useState } from "react";
import type { ArquivoStudio } from "@criativo/contracts";
import {
  MAX_DIRECT_UPLOAD_BYTES,
  filesTablesApi,
  formatOversizedUploadGuidance,
} from "../../services/api/files-browser-whatsapp-api";

const SUPPORTED_EXT_RE = /\.(png|jpe?g|webp|gif|svg|mp4|mov|mp3|wav)$/i;
const SUPPORTED_MIME_PREFIXES = ["image/", "video/mp4", "video/quicktime", "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav"];

export function isSupportedCanvasMediaFile(file: Pick<File, "name" | "type">): boolean {
  const mime = (file.type || "").toLowerCase();
  if (mime && SUPPORTED_MIME_PREFIXES.some((prefix) => mime === prefix || mime.startsWith(prefix))) {
    return true;
  }
  return SUPPORTED_EXT_RE.test(file.name);
}

export function useWorkflowCanvasMediaDrop({
  stageRef,
  zoom,
  panOffset,
  isReadOnly,
  onUploadFile,
  onCreateAssetNodeAt,
  setStatusFeedback,
}: {
  stageRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panOffset: { x: number; y: number };
  isReadOnly: boolean;
  onUploadFile?: (file: File) => Promise<ArquivoStudio | void>;
  onCreateAssetNodeAt: (arquivo: ArquivoStudio, x: number, y: number) => void;
  setStatusFeedback: (msg: string | null) => void;
}) {
  const [isDraggingMedia, setIsDraggingMedia] = useState(false);
  const [uploadingDropCount, setUploadingDropCount] = useState(0);

  const processFilesAt = useCallback(
    async (files: File[], worldX: number, worldY: number) => {
      if (isReadOnly || files.length === 0) return;
      const supported = files.filter(isSupportedCanvasMediaFile);
      if (supported.length === 0) {
        setStatusFeedback(
          "Formato não suportado no canvas. Arraste imagens, vídeos (MP4/MOV) ou áudios (MP3/WAV)."
        );
        return;
      }

      setUploadingDropCount((c) => c + supported.length);
      try {
        for (let i = 0; i < supported.length; i += 1) {
          const file = supported[i]!;
          if (file.size > MAX_DIRECT_UPLOAD_BYTES) {
            setStatusFeedback(formatOversizedUploadGuidance(file));
            continue;
          }
          const customRes = onUploadFile ? await onUploadFile(file) : undefined;
          const arquivo =
            customRes && typeof customRes === "object" && "arquivo_id" in customRes
              ? customRes
              : (await filesTablesApi.uploadFileCategorized(file)).arquivo;
          onCreateAssetNodeAt(arquivo, Math.round(worldX + i * 40), Math.round(worldY + i * 40));
          setStatusFeedback(`Mídia "${arquivo.nome_original}" adicionada ao fluxo.`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Falha ao enviar mídia para o canvas.";
        setStatusFeedback(msg);
      } finally {
        setUploadingDropCount((c) => Math.max(0, c - supported.length));
      }
    },
    [isReadOnly, onCreateAssetNodeAt, onUploadFile, setStatusFeedback]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (isReadOnly) return;
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!isDraggingMedia) setIsDraggingMedia(true);
      }
    },
    [isDraggingMedia, isReadOnly]
  );

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const related = e.relatedTarget as Node | null;
    if (!related || !stageRef.current?.contains(related)) {
      setIsDraggingMedia(false);
    }
  }, [stageRef]);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      setIsDraggingMedia(false);
      if (isReadOnly) return;
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();

      const rect = stageRef.current?.getBoundingClientRect();
      const worldX = rect ? (e.clientX - rect.left - panOffset.x) / zoom : 240;
      const worldY = rect ? (e.clientY - rect.top - panOffset.y) / zoom : 200;
      void processFilesAt(files, worldX, worldY);
    },
    [isReadOnly, panOffset.x, panOffset.y, processFilesAt, stageRef, zoom]
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isReadOnly) return;
      const activeEl =
        typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.tagName === "SELECT" ||
          activeEl.isContentEditable)
      ) {
        return;
      }
      const files = Array.from(e.clipboardData?.files ?? []).filter(isSupportedCanvasMediaFile);
      if (files.length === 0) return;
      e.preventDefault();
      const rect = stageRef.current?.getBoundingClientRect();
      const worldX = rect ? (rect.width / 2 - panOffset.x) / zoom - 120 : 260;
      const worldY = rect ? (rect.height / 2 - panOffset.y) / zoom - 80 : 200;
      void processFilesAt(files, worldX, worldY);
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [isReadOnly, panOffset.x, panOffset.y, processFilesAt, stageRef, zoom]);

  return {
    isDraggingMedia,
    uploadingDropCount,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
