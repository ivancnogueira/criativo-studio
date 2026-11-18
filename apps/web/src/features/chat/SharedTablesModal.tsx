import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Database,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { SharedTableDetail, SharedTableSummary } from "@criativo/contracts";
import { daemonApi } from "../../services/websocket-client";

export interface SharedTablesModalProps {
  open: boolean;
  onClose: () => void;
  refreshToken?: number;
  initialTables?: SharedTableSummary[];
  initialSelectedDetail?: SharedTableDetail | null;
  initialConfirmDelete?: boolean;
  initialReadError?: boolean;
}

/**
 * Modal de inspecao, filtragem read-only, exportacao CSV/JSON e exclusao segura
 * das Tabelas SQL Compartilhadas armazenadas em dados/shared-tables.db (LRN-03).
 */
export function SharedTablesModal({
  open,
  onClose,
  refreshToken = 0,
  initialTables,
  initialSelectedDetail,
  initialConfirmDelete = false,
  initialReadError = false,
}: SharedTablesModalProps): React.ReactElement | null {
  const [tables, setTables] = useState<SharedTableSummary[]>(initialTables ?? []);
  const [selectedName, setSelectedName] = useState<string | null>(
    initialSelectedDetail?.name ?? initialTables?.[0]?.name ?? null,
  );
  const [detail, setDetail] = useState<SharedTableDetail | null>(initialSelectedDetail ?? null);
  const [searchFilter, setSearchFilter] = useState<string>("");
  const [loadingList, setLoadingList] = useState<boolean>(false);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [readError, setReadError] = useState<boolean>(initialReadError);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState<boolean>(initialConfirmDelete);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const loadTablesList = useCallback(async () => {
    setLoadingList(true);
    try {
      const list = await daemonApi.listSharedTables();
      setTables(list);
      setSelectedName((prev) => {
        if (prev && list.some((t) => t.name === prev)) return prev;
        return list[0]?.name ?? null;
      });
    } catch {
      setReadError(true);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadTableDetail = useCallback(
    async (tableName: string, busca = "") => {
      setLoadingDetail(true);
      setReadError(false);
      try {
        const inspected = await daemonApi.inspectSharedTable(tableName, {
          limit: 500,
          offset: 0,
          busca: busca.trim() || undefined,
        });
        setDetail(inspected);
      } catch {
        setReadError(true);
      } finally {
        setLoadingDetail(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open || initialTables !== undefined) return;
    void loadTablesList();
  }, [initialTables, loadTablesList, open, refreshToken]);

  useEffect(() => {
    if (!open || !selectedName || initialSelectedDetail !== undefined) return;
    setConfirmDeleteOpen(false);
    void loadTableDetail(selectedName, searchFilter);
  }, [initialSelectedDetail, loadTableDetail, open, refreshToken, searchFilter, selectedName]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const handleConfirmDelete = async (): Promise<void> => {
    if (!selectedName || deleting) return;
    setDeleting(true);
    try {
      await daemonApi.deleteSharedTable(selectedName);
      setFeedbackMsg("Tabela removida");
      setConfirmDeleteOpen(false);
      setDetail(null);
      await loadTablesList();
    } catch {
      setReadError(true);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tabelas SQL Compartilhadas"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.72)" }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="w-full max-w-[1280px] max-h-[90vh] rounded-[14px] bg-[#212121] border border-[rgba(255,255,255,0.12)] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-[rgba(255,255,255,0.06)] p-4">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-[#42A0FF]" />
            <h2 className="text-[20px] font-semibold leading-[1.4] text-[#FFFFFF]">
              Tabelas SQL Compartilhadas
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {feedbackMsg && (
              <span className="text-[12px] font-semibold text-[#31CF76]">{feedbackMsg}</span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] font-semibold text-[#DCDCDC]"
            >
              <X className="w-4 h-4" />
              Fechar tabelas
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          {/* Coluna esquerda: lista de tabelas */}
          <aside className="w-full md:w-72 shrink-0 bg-[#1A1A1A] border-b md:border-b-0 md:border-r border-[rgba(255,255,255,0.06)] p-4 flex flex-col gap-2 overflow-y-auto">
            {loadingList && tables.length === 0 ? (
              <span className="text-[12px] font-normal text-[#979797]">
                Consultando tabelas...
              </span>
            ) : tables.length === 0 ? (
              <span className="text-[12px] font-normal text-[#979797]">
                Sem tabelas registradas.
              </span>
            ) : (
              tables.map((tb) => {
                const isActive = tb.name === selectedName;
                return (
                  <button
                    key={tb.name}
                    type="button"
                    onClick={() => {
                      setSelectedName(tb.name);
                      setConfirmDeleteOpen(false);
                      if (initialSelectedDetail !== undefined) {
                        void loadTableDetail(tb.name, searchFilter);
                      }
                    }}
                    className={`w-full text-left rounded-lg p-2 border-l-4 transition-colors flex flex-col gap-1 ${
                      isActive
                        ? "bg-[#2A2A2A] border-l-[#007CF7]"
                        : "bg-transparent hover:bg-[#242424] border-l-transparent"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[14px] font-semibold font-terminal text-[#FFFFFF] truncate">
                        {tb.name}
                      </span>
                      <span className="text-[12px] font-normal text-[#DCDCDC] shrink-0">
                        {tb.rowCount ?? 0} linhas
                      </span>
                    </div>
                    <span className="text-[12px] font-normal text-[#979797] truncate">
                      Criador: {tb.ownerAgentId ?? "sistema"}
                    </span>
                  </button>
                );
              })
            )}
          </aside>

          {/* Area principal: dados da tabela selecionada */}
          <main className="flex-1 bg-[#212121] p-6 flex flex-col gap-4 min-w-0 overflow-hidden">
            {tables.length === 0 && !loadingList && !readError ? (
              <div className="my-8 flex flex-col items-center justify-center text-center gap-2">
                <Database className="w-8 h-8 text-[#6A6A6A]" />
                <h3 className="text-[20px] font-semibold leading-[1.4] text-[#FFFFFF]">
                  Nenhuma tabela SQL compartilhada encontrada
                </h3>
                <p className="max-w-md text-[14px] font-normal leading-[1.43] text-[#979797]">
                  Peça ao agente para estruturar uma tabela de dados durante a conversa. Os registros aparecerão aqui para consulta e exportação.
                </p>
              </div>
            ) : readError ? (
              <div className="rounded-lg bg-[#212121] border border-[#FD2F3B] p-4 flex items-center justify-between gap-4 flex-wrap">
                <span className="text-[14px] font-normal text-[#DCDCDC]">
                  Não foi possível consultar esta tabela agora. Verifique se a tabela ainda existe ou feche e reabra o painel.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedName) {
                      void loadTableDetail(selectedName, searchFilter);
                    } else {
                      void loadTablesList();
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] font-semibold text-[#FFFFFF]"
                >
                  <RefreshCw className="w-4 h-4" />
                  Recarregar tabela
                </button>
              </div>
            ) : selectedName ? (
              <>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="w-4 h-4 text-[#6A6A6A] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      placeholder="Filtrar registros..."
                      className="w-full rounded-lg bg-[#101010] border border-[rgba(255,255,255,0.12)] pl-9 pr-4 py-2 text-[14px] text-[#FFFFFF] placeholder:text-[#6A6A6A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                    />
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {detail?.truncated && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#242424] px-2 py-1 text-[12px] font-semibold text-[#FF9412]">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Exibindo teto de 500 linhas ({detail.totalRows} no total)
                      </span>
                    )}

                    <a
                      href={daemonApi.getSharedTableExportUrl(selectedName, "csv")}
                      download
                      onClick={() => setFeedbackMsg("Tabela exportada em CSV")}
                      className="openbot-btn-primary inline-flex items-center gap-2 rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414]"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      Exportar CSV
                    </a>

                    <a
                      href={daemonApi.getSharedTableExportUrl(selectedName, "json")}
                      download
                      className="inline-flex items-center gap-2 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] font-semibold text-[#DCDCDC]"
                    >
                      <Download className="w-4 h-4" />
                      Exportar JSON
                    </a>

                    <button
                      type="button"
                      onClick={() => setConfirmDeleteOpen(true)}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[#FD2F3B] px-4 py-2 text-[14px] font-semibold text-[#FD2F3B]"
                    >
                      <Trash2 className="w-4 h-4" />
                      Excluir tabela
                    </button>
                  </div>
                </div>

                {confirmDeleteOpen && (
                  <div className="rounded-lg bg-[#242424] border border-[#FD2F3B] p-4 flex items-center justify-between gap-4 flex-wrap">
                    <span className="text-[14px] font-normal text-[#FFFFFF]">
                      Remover esta tabela apaga todos os registros estruturados.
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={deleting}
                        onClick={() => void handleConfirmDelete()}
                        className="rounded-lg bg-[#FD2F3B] px-4 py-2 text-[14px] font-semibold text-[#FFFFFF]"
                      >
                        Concluir exclusão
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteOpen(false)}
                        className="rounded-lg bg-[#1A1A1A] px-4 py-2 text-[14px] font-semibold text-[#DCDCDC]"
                      >
                        Manter tabela
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#101010]">
                  {loadingDetail && !detail ? (
                    <div className="p-4 text-[12px] text-[#979797]">Carregando linhas...</div>
                  ) : detail && detail.columns.length > 0 ? (
                    <table className="w-full border-collapse text-left">
                      <thead className="sticky top-0 bg-[#242424] z-10">
                        <tr>
                          {detail.columns.map((col) => (
                            <th
                              key={col}
                              className="px-4 py-2 text-[12px] font-semibold font-terminal text-[#FFFFFF] border-b border-[rgba(255,255,255,0.06)] whitespace-nowrap"
                            >
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {detail.rows.map((row, rIdx) => (
                          <tr
                            key={`r-${rIdx}`}
                            className="border-b border-[rgba(255,255,255,0.06)] hover:bg-[#1A1A1A]"
                          >
                            {detail.columns.map((col, cIdx) => {
                              const cellVal = row[cIdx];
                              const textVal =
                                cellVal === null || cellVal === undefined
                                  ? "NULL"
                                  : typeof cellVal === "object"
                                    ? JSON.stringify(cellVal)
                                    : String(cellVal);
                              return (
                                <td
                                  key={`${rIdx}-${col}`}
                                  title={textVal}
                                  className="px-4 py-2 text-[12px] font-normal font-terminal text-[#DCDCDC] max-w-[280px] truncate"
                                >
                                  {textVal}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-4 text-[12px] text-[#979797]">
                      Nenhum registro encontrado para esta seleção.
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}
