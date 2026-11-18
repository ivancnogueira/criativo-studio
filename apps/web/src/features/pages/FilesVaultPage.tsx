import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgenteRegistro,
  AnexoChat,
  ArquivoStudio,
  BibliotecasPastasSnapshot,
} from "@criativo/contracts";
import {
  ChevronRight,
  Download,
  Eye,
  Film,
  FolderInput,
  FolderOpen,
  Image as ImageIcon,
  Search,
  Sparkles,
  Upload,
} from "lucide-react";
import { daemonApi } from "../../services/websocket-client";
import {
  LibraryFolderTree,
  type LibraryFolderSelection,
} from "../files/LibraryFolderTree";

export interface FilesVaultPageProps {
  arquivos: ArquivoStudio[];
  onUploadFile: (file: File) => Promise<AnexoChat>;
  agentes?: AgenteRegistro[];
  foldersSnapshot?: BibliotecasPastasSnapshot | null;
  onRefreshFolders?: () => Promise<void> | void;
  onPreviewFile?: (arquivo: ArquivoStudio) => void;
}

const EMPTY_SNAPSHOT: BibliotecasPastasSnapshot = {
  folders: [],
  placement: {},
  unfiledByAgent: {},
};

/**
 * Pagina de Biblioteca Hierarquica em 2 colunas (CHAT-03):
 * LibraryFolderTree ate 4 niveis a esquerda + grade com breadcrumbs, busca,
 * proveniencia (Gerado por IA vs Arquivo enviado), movimentacao sem dropdown nativo e previa rica.
 */
export const FilesVaultPage: React.FC<FilesVaultPageProps> = ({
  arquivos,
  onUploadFile,
  agentes = [],
  foldersSnapshot,
  onRefreshFolders,
  onPreviewFile,
}) => {
  const [filter, setFilter] = useState<"todos" | "referencia" | "gerado" | "video">("todos");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selection, setSelection] = useState<LibraryFolderSelection>({ kind: "all" });
  const [localSnapshot, setLocalSnapshot] = useState<BibliotecasPastasSnapshot>(
    foldersSnapshot ?? EMPTY_SNAPSHOT,
  );
  const [moveOpenForFileId, setMoveOpenForFileId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (foldersSnapshot) {
      setLocalSnapshot(foldersSnapshot);
    }
  }, [foldersSnapshot]);

  const fetchSnapshotFallback = useCallback(async () => {
    try {
      const snap = await daemonApi.listLibraryFolders();
      setLocalSnapshot(snap);
    } catch {
      // ambiente SSR ou offline mantem estado atual
    }
  }, []);

  useEffect(() => {
    if (foldersSnapshot !== undefined) return;
    void fetchSnapshotFallback();
  }, [fetchSnapshotFallback, foldersSnapshot]);

  const effectiveSnapshot = foldersSnapshot ?? localSnapshot;

  const selectedFolderSubtreeIds = useMemo(() => {
    if (selection.kind !== "folder") return null;
    const set = new Set<string>([selection.pastaId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of effectiveSnapshot.folders) {
        if (f.parent_id && set.has(f.parent_id) && !set.has(f.pasta_id)) {
          set.add(f.pasta_id);
          changed = true;
        }
      }
    }
    return set;
  }, [effectiveSnapshot.folders, selection]);

  const breadcrumbs = useMemo(() => {
    if (selection.kind === "all") return ["Todos os arquivos"];
    if (selection.kind === "removed_agents") return ["Todos os arquivos", "Agentes removidos"];
    if (selection.kind === "agent") {
      const agName =
        agentes.find((a) => a.agente_id === selection.agenteId)?.nome ?? selection.agenteId;
      return ["Todos os arquivos", agName];
    }
    const folder = effectiveSnapshot.folders.find((f) => f.pasta_id === selection.pastaId);
    if (!folder) return ["Todos os arquivos"];
    const agName =
      agentes.find((a) => a.agente_id === folder.agente_id)?.nome ?? folder.agente_id;
    return ["Todos os arquivos", agName, ...folder.caminho_completo.split("/")];
  }, [agentes, effectiveSnapshot.folders, selection]);

  const activeAgentSet = useMemo(() => new Set(agentes.map((a) => a.agente_id)), [agentes]);

  const visible = useMemo(() => {
    const lowerQ = searchQuery.trim().toLowerCase();
    return arquivos.filter((arq) => {
      if (filter !== "todos" && arq.tipo_uso !== filter) return false;
      if (lowerQ && !arq.nome_original.toLowerCase().includes(lowerQ)) return false;

      if (selection.kind === "agent") {
        return arq.agente_id === selection.agenteId;
      }
      if (selection.kind === "removed_agents") {
        return Boolean(arq.agente_id && !activeAgentSet.has(arq.agente_id));
      }
      if (selection.kind === "folder" && selectedFolderSubtreeIds) {
        const placedId = arq.pasta_id ?? effectiveSnapshot.placement[arq.arquivo_id] ?? null;
        return Boolean(placedId && selectedFolderSubtreeIds.has(placedId));
      }
      return true;
    });
  }, [
    activeAgentSet,
    arquivos,
    effectiveSnapshot.placement,
    filter,
    searchQuery,
    selectedFolderSubtreeIds,
    selection,
  ]);

  const handleUpload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(list)) {
        await onUploadFile(file);
      }
      await onRefreshFolders?.();
    } finally {
      setUploading(false);
    }
  };

  const handleCreateFolder = async (input: {
    agenteId: string;
    nome: string;
    parentId?: string | null;
  }) => {
    const res = await daemonApi.createLibraryFolder({
      agente_id: input.agenteId,
      nome: input.nome,
      parent_id: input.parentId ?? null,
    });
    setLocalSnapshot(res.snapshot);
    await onRefreshFolders?.();
  };

  const handleRenameFolder = async (pastaId: string, nome: string) => {
    const res = await daemonApi.updateLibraryFolder(pastaId, { nome });
    setLocalSnapshot(res.snapshot);
    await onRefreshFolders?.();
  };

  const handleDeleteFolder = async (pastaId: string) => {
    const res = await daemonApi.deleteLibraryFolder(pastaId);
    setLocalSnapshot(res.snapshot);
    if (selection.kind === "folder" && selection.pastaId === pastaId) {
      setSelection({ kind: "all" });
    }
    await onRefreshFolders?.();
  };

  const handleMoveFile = async (arquivoId: string, pastaId: string | null) => {
    const res = await daemonApi.moveFilesToLibraryFolder([arquivoId], pastaId);
    setLocalSnapshot(res.snapshot);
    setMoveOpenForFileId(null);
    await onRefreshFolders?.();
  };

  return (
    <div className="flex-1 h-full bg-[#1A1A1A] flex flex-col md:flex-row overflow-hidden">
      <LibraryFolderTree
        arquivos={arquivos}
        agentes={agentes}
        snapshot={effectiveSnapshot}
        selection={selection}
        onSelect={setSelection}
        onCreateFolder={handleCreateFolder}
        onRenameFolder={handleRenameFolder}
        onDeleteFolder={handleDeleteFolder}
        onDropFileToFolder={handleMoveFile}
      />

      <div className="flex-1 h-full overflow-y-auto p-6">
        <div className="max-w-[1120px] mx-auto flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1 flex-wrap text-[12px] font-semibold text-[#979797]">
                {breadcrumbs.map((crumb, idx) => (
                  <React.Fragment key={`${crumb}-${idx}`}>
                    {idx > 0 && <ChevronRight className="w-3.5 h-3.5" />}
                    <span className={idx === breadcrumbs.length - 1 ? "text-[#42A0FF]" : ""}>
                      {crumb}
                    </span>
                  </React.Fragment>
                ))}
              </div>
              <h1 className="text-[28px] font-semibold leading-[1.29] text-[#FFFFFF] flex items-center gap-2">
                <FolderOpen className="h-6 w-6 text-[#42A0FF]" />
                Arquivos, ImagePaths &amp; Entregáveis
              </h1>
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                id="files-page-upload"
                name="files_page_upload"
                aria-label="Selecionar arquivo para upload"
                type="file"
                multiple
                accept="image/*,video/mp4,.pdf,.csv,.tsv,.md,.json,.txt,.srt"
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
                className="openbot-btn-primary rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414] inline-flex items-center gap-2"
              >
                <Upload className="h-4 w-4" />
                {uploading ? "Enviando arquivo..." : "Enviar Referência ImagePaths"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-wrap">
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
                  className={`px-4 py-2 rounded-full text-[12px] font-semibold transition-colors ${
                    filter === tab.id
                      ? "bg-[#F0F0F0] text-[#141414]"
                      : "bg-[#212121] text-[#979797] hover:text-[#FFFFFF]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative min-w-[220px]">
              <Search className="w-4 h-4 text-[#6A6A6A] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por nome..."
                className="w-full rounded-lg bg-[#101010] border border-[rgba(255,255,255,0.12)] pl-9 pr-4 py-2 text-[14px] text-[#FFFFFF] placeholder:text-[#6A6A6A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
              />
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-[rgba(255,255,255,0.12)] bg-[#141414] p-12 text-center flex flex-col items-center gap-4">
              <ImageIcon className="h-8 w-8 text-[#6A6A6A]" />
              <p className="text-[14px] text-[#DCDCDC] font-semibold">
                Nenhum arquivo encontrado nesta pasta
              </p>
              <button
                type="button"
                onClick={() => {
                  setFilter("todos");
                  setSearchQuery("");
                  setSelection({ kind: "all" });
                }}
                className="rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] font-semibold text-[#FFFFFF]"
              >
                Limpar filtro
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {visible.map((arq) => {
                const isImg = arq.mime_type.startsWith("image/");
                const isVid = arq.mime_type.startsWith("video/");
                const isAiGenerated = arq.tipo_uso === "gerado" || arq.tipo_uso === "video";
                const isMoveOpen = moveOpenForFileId === arq.arquivo_id;

                return (
                  <div
                    key={arq.arquivo_id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/criativo-arquivo-id", arq.arquivo_id);
                    }}
                    className="relative rounded-[14px] bg-[#212121] border border-[rgba(255,255,255,0.06)] overflow-hidden flex flex-col"
                  >
                    <button
                      type="button"
                      onClick={() => onPreviewFile?.(arq)}
                      aria-label={`Expandir prévia de ${arq.nome_original}`}
                      className="aspect-[4/3] bg-[#101010] flex items-center justify-center overflow-hidden relative group"
                    >
                      {isImg ? (
                        <img
                          src={arq.url}
                          alt={arq.nome_original}
                          className="h-full w-full object-cover"
                        />
                      ) : isVid ? (
                        <Film className="h-8 w-8 text-[#FD2F3B]" />
                      ) : (
                        <FolderOpen className="h-8 w-8 text-[#42A0FF]" />
                      )}
                      <span className="absolute bottom-2 right-2 rounded-md bg-[#212121] border border-[rgba(255,255,255,0.12)] px-2 py-1 text-[12px] font-semibold text-[#FFFFFF] inline-flex items-center gap-1">
                        <Eye className="w-3.5 h-3.5 text-[#42A0FF]" />
                        Expandir prévia
                      </span>
                    </button>

                    <div className="p-4 flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        {isAiGenerated ? (
                          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#42A0FF]">
                            <Sparkles className="w-3.5 h-3.5" />
                            Gerado por IA
                          </span>
                        ) : (
                          <span className="text-[12px] font-normal text-[#979797]">
                            Arquivo enviado
                          </span>
                        )}
                        <span className="text-[12px] font-normal text-[#6A6A6A]">
                          {(arq.tamanho_bytes / 1024).toFixed(1)} KB
                        </span>
                      </div>

                      <div className="text-[14px] font-semibold text-[#FFFFFF] truncate">
                        {arq.nome_original}
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-[rgba(255,255,255,0.06)]">
                        <button
                          type="button"
                          onClick={() =>
                            setMoveOpenForFileId(isMoveOpen ? null : arq.arquivo_id)
                          }
                          className="inline-flex items-center gap-1 rounded-md bg-[#242424] hover:bg-[#2A2A2A] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC]"
                        >
                          <FolderInput className="w-3.5 h-3.5" />
                          Mover arquivo
                        </button>

                        <a
                          href={arq.url}
                          download={arq.nome_original}
                          title="Baixar arquivo"
                          aria-label="Baixar arquivo"
                          className="inline-flex items-center gap-1 rounded-md bg-[#2A2A2A] hover:bg-[#242424] px-2 py-1 text-[12px] font-semibold text-[#FFFFFF]"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Baixar arquivo
                        </a>
                      </div>

                      {isMoveOpen && (
                        <div
                          role="listbox"
                          aria-label="Selecionar pasta de destino"
                          className="rounded-lg bg-[#101010] border border-[rgba(255,255,255,0.12)] p-2 flex flex-col gap-1 max-h-40 overflow-y-auto"
                        >
                          <button
                            type="button"
                            role="option"
                            aria-selected={!arq.pasta_id}
                            onClick={() => void handleMoveFile(arq.arquivo_id, null)}
                            className="w-full text-left rounded px-2 py-1 text-[12px] text-[#DCDCDC] hover:bg-[#242424]"
                          >
                            Raiz (Sem pasta)
                          </button>
                          {effectiveSnapshot.folders.map((fld) => (
                            <button
                              key={fld.pasta_id}
                              type="button"
                              role="option"
                              aria-selected={arq.pasta_id === fld.pasta_id}
                              onClick={() => void handleMoveFile(arq.arquivo_id, fld.pasta_id)}
                              className="w-full text-left rounded px-2 py-1 text-[12px] text-[#DCDCDC] hover:bg-[#242424] truncate"
                            >
                              {fld.caminho_completo}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
