import React, { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Edit3,
  Folder,
  FolderOpen,
  FolderPlus,
  Layers,
  Trash2,
} from "lucide-react";
import type {
  AgenteRegistro,
  ArquivoStudio,
  BibliotecaPasta,
  BibliotecasPastasSnapshot,
} from "@criativo/contracts";

export type LibraryFolderSelection =
  | { kind: "all" }
  | { kind: "agent"; agenteId: string }
  | { kind: "folder"; pastaId: string; agenteId: string }
  | { kind: "removed_agents" };

export interface LibraryFolderTreeProps {
  arquivos: ArquivoStudio[];
  agentes?: AgenteRegistro[];
  snapshot: BibliotecasPastasSnapshot;
  selection: LibraryFolderSelection;
  onSelect: (next: LibraryFolderSelection) => void;
  onCreateFolder: (input: {
    agenteId: string;
    nome: string;
    parentId?: string | null;
  }) => Promise<void> | void;
  onRenameFolder: (pastaId: string, nome: string) => Promise<void> | void;
  onDeleteFolder: (pastaId: string) => Promise<void> | void;
  onDropFileToFolder: (arquivoId: string, pastaId: string | null) => Promise<void> | void;
}

/**
 * Arvore recursiva de pastas hierarquicas ate 4 niveis na Biblioteca (CHAT-03).
 * Suporta criacao/renomeacao/exclusao inline e drag-and-drop de arquivos.
 */
export function LibraryFolderTree({
  arquivos,
  agentes = [],
  snapshot,
  selection,
  onSelect,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onDropFileToFolder,
}: LibraryFolderTreeProps): React.ReactElement {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [creatingTarget, setCreatingTarget] = useState<{
    agenteId: string;
    parentId: string | null;
  } | null>(null);
  const [newFolderName, setNewFolderName] = useState<string>("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState<string>("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const activeAgentIds = useMemo(() => new Set(agentes.map((a) => a.agente_id)), [agentes]);

  const countByFolderId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const arq of arquivos) {
      const folderId = arq.pasta_id ?? snapshot.placement[arq.arquivo_id];
      if (folderId) {
        map[folderId] = (map[folderId] ?? 0) + 1;
      }
    }
    return map;
  }, [arquivos, snapshot.placement]);

  const orphanCount = useMemo(() => {
    if (agentes.length === 0) return 0;
    return arquivos.filter((a) => a.agente_id && !activeAgentIds.has(a.agente_id)).length;
  }, [activeAgentIds, agentes.length, arquivos]);

  const orphanFolders = useMemo(() => {
    if (agentes.length === 0) return [];
    return snapshot.folders.filter((f) => !activeAgentIds.has(f.agente_id));
  }, [activeAgentIds, agentes.length, snapshot.folders]);

  const defaultCreateAgentId =
    selection.kind === "agent" || selection.kind === "folder"
      ? selection.agenteId
      : agentes[0]?.agente_id ?? snapshot.folders[0]?.agente_id ?? "estrategista";

  const toggleExpand = (key: string): void => {
    setExpandedIds((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
  };

  const submitCreate = async (): Promise<void> => {
    if (!creatingTarget || !newFolderName.trim()) return;
    await onCreateFolder({
      agenteId: creatingTarget.agenteId,
      nome: newFolderName.trim().slice(0, 60),
      parentId: creatingTarget.parentId,
    });
    setNewFolderName("");
    setCreatingTarget(null);
  };

  const submitRename = async (pastaId: string): Promise<void> => {
    if (!renameText.trim()) return;
    await onRenameFolder(pastaId, renameText.trim().slice(0, 60));
    setRenamingId(null);
    setRenameText("");
  };

  const renderSubtree = (
    agenteId: string,
    parentId: string | null,
    depth: number,
  ): React.ReactNode => {
    const children = snapshot.folders.filter(
      (f) => f.agente_id === agenteId && (f.parent_id ?? null) === parentId,
    );
    if (children.length === 0) return null;

    return (
      <div className="flex flex-col gap-1">
        {children.map((folder: BibliotecaPasta) => {
          const isExpanded = expandedIds[folder.pasta_id] ?? true;
          const isSelected =
            selection.kind === "folder" && selection.pastaId === folder.pasta_id;
          const hasSub = snapshot.folders.some((f) => f.parent_id === folder.pasta_id);
          const directCount = countByFolderId[folder.pasta_id] ?? 0;

          return (
            <div key={folder.pasta_id} className="flex flex-col gap-1">
              <div
                style={{ paddingLeft: `${depth * 16}px` }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const arqId = e.dataTransfer.getData("text/criativo-arquivo-id");
                  if (arqId) {
                    void onDropFileToFolder(arqId, folder.pasta_id);
                  }
                }}
                className={`group rounded-lg py-1 pr-2 border-l-4 flex items-center justify-between gap-1 ${
                  isSelected
                    ? "bg-[#2A2A2A] border-l-[#007CF7] text-[#FFFFFF]"
                    : "hover:bg-[#242424] border-l-transparent text-[#DCDCDC]"
                }`}
              >
                <div className="flex items-center gap-1 min-w-0 flex-1">
                  <button
                    type="button"
                    aria-label={isExpanded ? "Recolher pasta" : "Expandir pasta"}
                    onClick={() => toggleExpand(folder.pasta_id)}
                    className="p-1 text-[#979797] hover:text-[#FFFFFF]"
                  >
                    {hasSub ? (
                      isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )
                    ) : (
                      <span className="inline-block w-3.5" />
                    )}
                  </button>

                  {renamingId === folder.pasta_id ? (
                    <input
                      type="text"
                      maxLength={60}
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void submitRename(folder.pasta_id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="flex-1 rounded bg-[#101010] border border-[#007CF7] px-2 py-1 text-[12px] text-[#FFFFFF]"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        onSelect({
                          kind: "folder",
                          pastaId: folder.pasta_id,
                          agenteId: folder.agente_id,
                        })
                      }
                      className="flex items-center gap-1 min-w-0 flex-1 text-left"
                    >
                      {isSelected ? (
                        <FolderOpen className="w-4 h-4 text-[#42A0FF] shrink-0" />
                      ) : (
                        <Folder className="w-4 h-4 text-[#979797] shrink-0" />
                      )}
                      <span className="text-[14px] font-normal truncate">{folder.nome}</span>
                      <span className="text-[12px] font-normal text-[#979797] shrink-0">
                        {directCount}
                      </span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {folder.nivel < 4 && (
                    <button
                      type="button"
                      title="Criar pasta"
                      aria-label="Criar pasta"
                      onClick={() => {
                        setCreatingTarget({
                          agenteId: folder.agente_id,
                          parentId: folder.pasta_id,
                        });
                        setNewFolderName("");
                      }}
                      className="p-1 rounded hover:bg-[#212121] text-[#979797] hover:text-[#FFFFFF]"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    title="Renomear pasta"
                    aria-label="Renomear pasta"
                    onClick={() => {
                      setRenamingId(folder.pasta_id);
                      setRenameText(folder.nome);
                    }}
                    className="p-1 rounded hover:bg-[#212121] text-[#979797] hover:text-[#FFFFFF]"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Excluir pasta"
                    aria-label="Excluir pasta"
                    onClick={() => setConfirmDeleteId(folder.pasta_id)}
                    className="p-1 rounded hover:bg-[#212121] text-[#979797] hover:text-[#FD2F3B]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {confirmDeleteId === folder.pasta_id && (
                <div className="ml-4 rounded-lg bg-[#242424] border border-[#FD2F3B] p-2 flex items-center justify-between gap-2">
                  <span className="text-[12px] text-[#DCDCDC]">Remover pasta?</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        void onDeleteFolder(folder.pasta_id);
                        setConfirmDeleteId(null);
                      }}
                      className="rounded bg-[#FD2F3B] px-2 py-1 text-[12px] font-semibold text-[#FFFFFF]"
                    >
                      Excluir pasta
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded bg-[#1A1A1A] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC]"
                    >
                      Manter
                    </button>
                  </div>
                </div>
              )}

              {isExpanded && renderSubtree(agenteId, folder.pasta_id, depth + 1)}
            </div>
          );
        })}
      </div>
    );
  };

  const agentGroups = useMemo(() => {
    if (agentes.length > 0) {
      return agentes.map((a) => ({ id: a.agente_id, nome: a.nome }));
    }
    const ids = Array.from(
      new Set([
        ...snapshot.folders.map((f) => f.agente_id),
        ...arquivos.map((a) => a.agente_id).filter((id): id is string => Boolean(id)),
      ]),
    );
    return ids.map((id) => ({ id, nome: id }));
  }, [agentes, arquivos, snapshot.folders]);

  return (
    <aside className="w-full md:w-72 shrink-0 bg-[#1A1A1A] border-b md:border-b-0 md:border-r border-[rgba(255,255,255,0.06)] p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[rgba(255,255,255,0.06)]">
        <h2 className="text-[20px] font-semibold leading-[1.4] text-[#FFFFFF]">Pastas</h2>
        <button
          type="button"
          onClick={() => {
            setCreatingTarget({
              agenteId: defaultCreateAgentId,
              parentId: selection.kind === "folder" ? selection.pastaId : null,
            });
            setNewFolderName("");
          }}
          className="inline-flex items-center gap-1 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-2 py-1 text-[12px] font-semibold text-[#FFFFFF]"
        >
          <FolderPlus className="w-3.5 h-3.5 text-[#42A0FF]" />
          Criar pasta
        </button>
      </div>

      {creatingTarget && (
        <div className="rounded-lg bg-[#212121] border border-[#007CF7] p-2 flex flex-col gap-2">
          <input
            type="text"
            maxLength={60}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Nome da nova pasta..."
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitCreate();
              if (e.key === "Escape") setCreatingTarget(null);
            }}
            className="w-full rounded bg-[#101010] border border-[rgba(255,255,255,0.12)] px-2 py-1 text-[14px] text-[#FFFFFF]"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void submitCreate()}
              className="rounded bg-[#F0F0F0] px-2 py-1 text-[12px] font-semibold text-[#141414]"
            >
              Criar pasta
            </button>
            <button
              type="button"
              onClick={() => setCreatingTarget(null)}
              className="rounded bg-[#242424] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC]"
            >
              Fechar campo
            </button>
          </div>
        </div>
      )}

      {/* Raiz: Todos os arquivos */}
      <button
        type="button"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const arqId = e.dataTransfer.getData("text/criativo-arquivo-id");
          if (arqId) void onDropFileToFolder(arqId, null);
        }}
        onClick={() => onSelect({ kind: "all" })}
        className={`w-full rounded-lg px-4 py-2 border-l-4 flex items-center justify-between gap-2 text-left ${
          selection.kind === "all"
            ? "bg-[#2A2A2A] border-l-[#007CF7] text-[#FFFFFF]"
            : "hover:bg-[#242424] border-l-transparent text-[#DCDCDC]"
        }`}
      >
        <span className="inline-flex items-center gap-2 text-[14px] font-semibold">
          <Layers className="w-4 h-4 text-[#42A0FF]" />
          Todos os arquivos
        </span>
        <span className="text-[12px] font-normal text-[#979797]">{arquivos.length}</span>
      </button>

      {/* Grupos por agente */}
      <div className="flex flex-col gap-1 overflow-y-auto">
        {agentGroups.map((ag) => {
          const agKey = `agent:${ag.id}`;
          const expanded = expandedIds[agKey] ?? true;
          const agSelected = selection.kind === "agent" && selection.agenteId === ag.id;
          const agFilesCount = arquivos.filter((f) => f.agente_id === ag.id).length;

          return (
            <div key={ag.id} className="flex flex-col gap-1">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const arqId = e.dataTransfer.getData("text/criativo-arquivo-id");
                  if (arqId) void onDropFileToFolder(arqId, null);
                }}
                className={`rounded-lg px-2 py-1 border-l-4 flex items-center justify-between gap-1 ${
                  agSelected
                    ? "bg-[#2A2A2A] border-l-[#007CF7] text-[#FFFFFF]"
                    : "hover:bg-[#242424] border-l-transparent text-[#DCDCDC]"
                }`}
              >
                <div className="flex items-center gap-1 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => toggleExpand(agKey)}
                    className="p-1 text-[#979797] hover:text-[#FFFFFF]"
                  >
                    {expanded ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelect({ kind: "agent", agenteId: ag.id })}
                    className="flex items-center justify-between gap-2 min-w-0 flex-1 text-left"
                  >
                    <span className="text-[14px] font-semibold truncate">{ag.nome}</span>
                    <span className="text-[12px] font-normal text-[#979797] shrink-0">
                      {agFilesCount}
                    </span>
                  </button>
                </div>
              </div>

              {expanded && renderSubtree(ag.id, null, 1)}
            </div>
          );
        })}

        {(orphanCount > 0 || orphanFolders.length > 0) && (
          <button
            type="button"
            onClick={() => onSelect({ kind: "removed_agents" })}
            className={`w-full rounded-lg px-4 py-2 border-l-4 flex items-center justify-between gap-2 text-left ${
              selection.kind === "removed_agents"
                ? "bg-[#2A2A2A] border-l-[#007CF7] text-[#FFFFFF]"
                : "hover:bg-[#242424] border-l-transparent text-[#979797]"
            }`}
          >
            <span className="text-[14px] font-semibold">Agentes removidos</span>
            <span className="text-[12px] font-normal">{orphanCount}</span>
          </button>
        )}
      </div>

      {/* Referencia de acessibilidade de menu contextual */}
      <span className="sr-only">Renomear pasta · Excluir pasta · Agentes removidos</span>
    </aside>
  );
}
