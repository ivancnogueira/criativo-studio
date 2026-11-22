import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { CriativoUserError, StructuredLogEntry } from "@criativo/contracts";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileWarning,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { CarbonSelect } from "../../components/ui/CarbonControls";
import { daemonApi } from "../../services/websocket-client";

export const SettingsDiagnosticsTab: React.FC = () => {
  const [logs, setLogs] = useState<StructuredLogEntry[]>([]);
  const [catalog, setCatalog] = useState<CriativoUserError[]>([]);
  const [levelFilter, setLevelFilter] = useState<"todos" | "info" | "warn" | "error">("todos");
  const [codeQuery, setCodeQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [logsRes, catalogRes] = await Promise.all([
        daemonApi.listDiagnosticLogs({
          level: levelFilter === "todos" ? undefined : levelFilter,
          code: codeQuery.trim() || undefined,
          limit: 120,
        }),
        daemonApi.listErrorCatalog(),
      ]);
      setLogs(logsRes.logs);
      setCatalog(catalogRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar diagnóstico.");
    } finally {
      setLoading(false);
    }
  }, [levelFilter, codeQuery]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredCatalog = useMemo(() => {
    const q = codeQuery.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (item) =>
        item.code.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.domain.toLowerCase().includes(q)
    );
  }, [catalog, codeQuery]);

  const buildRedactedReport = (): string => {
    return JSON.stringify(
      {
        gerado_em: new Date().toISOString(),
        redigido: true,
        filtros: { nivel: levelFilter, codigo: codeQuery.trim() || null },
        total_logs: logs.length,
        logs,
      },
      null,
      2
    );
  };

  const handleCopyReport = async () => {
    try {
      await navigator.clipboard.writeText(buildRedactedReport());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Não foi possível copiar para a área de transferência.");
    }
  };

  const handleDownloadReport = () => {
    const blob = new Blob([buildRedactedReport()], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `criativo-diagnostico-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-[#141414] p-3.5">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="h-4.5 w-4.5 text-[#31CF76]" />
          <div>
            <p className="text-xs font-semibold text-white">
              Logs Estruturados Redigidos & Catálogo CRV-*
            </p>
            <p className="text-[11px] text-[#979797]">
              Tokens, chaves Bearer e API Keys são removidos automaticamente antes da persistência.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCopyReport()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#212121] px-2.5 py-1.5 text-xs font-medium text-[#DCDCDC] hover:bg-[#2A2A2A]"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-[#31CF76]" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? "Copiado" : "Copiar relatório"}</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadReport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#212121] px-2.5 py-1.5 text-xs font-medium text-[#DCDCDC] hover:bg-[#2A2A2A]"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Baixar JSON</span>
          </button>
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2A2A2A] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#353535]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* Filtros de nível e código CRV-* */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-40">
          <CarbonSelect
            ariaLabel="Filtrar logs por nível"
            value={levelFilter}
            onChange={(v) => setLevelFilter(v as "todos" | "info" | "warn" | "error")}
            options={[
              { value: "todos", label: "Todos os níveis" },
              { value: "error", label: "Erros" },
              { value: "warn", label: "Avisos" },
              { value: "info", label: "Info" },
            ]}
          />
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-[#6A6A6A]" />
          <input
            type="text"
            value={codeQuery}
            onChange={(e) => setCodeQuery(e.target.value)}
            placeholder="Filtrar por código (ex.: CRV-META-001, CRV-VAULT-001)..."
            className="w-full rounded-xl border border-white/10 bg-[#141414] py-2 pl-8 pr-3 text-xs text-white placeholder:text-[#6A6A6A] focus:border-[#42A0FF] focus:outline-none"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[#FD2F3B]/30 bg-[#FD2F3B]/10 px-3 py-2 text-xs text-[#FF8A90]">
          {error}
        </div>
      )}

      {/* Lista de Logs Recentes */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#979797]">
          Eventos recentes ({logs.length})
        </h3>
        {loading ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-[#141414] py-8 text-xs text-[#979797]">
            <Loader2 className="h-4 w-4 animate-spin text-[#42A0FF]" />
            <span>Carregando logs redigidos...</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="rounded-xl border border-white/[0.06] bg-[#141414] px-4 py-6 text-center text-xs text-[#979797]">
            Nenhum evento registrado com os filtros atuais.
          </div>
        ) : (
          <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-xl border border-white/[0.06] bg-[#141414] p-2.5">
            {logs.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-white/[0.05] bg-[#1A1A1A] px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                        entry.level === "error"
                          ? "bg-[#FD2F3B]/20 text-[#FF8A90]"
                          : entry.level === "warn"
                            ? "bg-[#FF9412]/20 text-[#FDCB6E]"
                            : "bg-[#42A0FF]/20 text-[#42A0FF]"
                      }`}
                    >
                      {entry.level}
                    </span>
                    {entry.code && (
                      <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white">
                        {entry.code}
                      </span>
                    )}
                    <span className="text-[11px] text-[#979797]">{entry.domain}</span>
                  </div>
                  <span className="font-mono text-[10px] text-[#6A6A6A]">
                    {entry.ts}
                    {entry.traceId ? ` · ${entry.traceId}` : ""}
                  </span>
                </div>
                <p className="mt-1 break-words text-[11.5px] text-[#DCDCDC]">{entry.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Referência Rápida do Catálogo CRV-* */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#979797]">
          Catálogo de códigos CRV-* ({filteredCatalog.length})
        </h3>
        <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-white/[0.06] bg-[#141414] p-2.5">
          {filteredCatalog.map((item) => (
            <div
              key={item.code}
              className="rounded-lg border border-white/[0.05] bg-[#1A1A1A] px-3 py-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold text-[#42A0FF]">
                  {item.severity === "critical" || item.severity === "error" ? (
                    <FileWarning className="h-3.5 w-3.5 text-[#FD2F3B]" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 text-[#FDCB6E]" />
                  )}
                  {item.code} — {item.title}
                </span>
                <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-[#979797]">
                  {item.domain}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-[#DCDCDC]">{item.userMessage}</p>
              <p className="mt-0.5 text-[10.5px] text-[#31CF76]">Ação: {item.suggestedAction}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
