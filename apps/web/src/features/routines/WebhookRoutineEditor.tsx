import React, { useEffect, useState } from "react";
import type {
  EventFilter,
  RoutineWebhookConfig,
  WebhookReceipt,
  WebhookTestResult,
} from "@criativo/contracts";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { daemonApi } from "../../services/websocket-client";
import { buildSignedCurlExample } from "./routine-schedule-format";

interface WebhookRoutineEditorProps {
  rotinaId: string | null;
  webhook: RoutineWebhookConfig | null;
  revealedSecret: string | null;
  eventType: string;
  filters: EventFilter[];
  onChangeEventType: (value: string) => void;
  onChangeFilters: (filters: EventFilter[]) => void;
  onGenerateEndpoint: () => Promise<void>;
  onRotateSecret: () => Promise<void>;
  onApplyCustomSecret: (secret: string) => Promise<void>;
  onClearRevealedSecret: () => void;
}

export const WebhookRoutineEditor: React.FC<WebhookRoutineEditorProps> = ({
  rotinaId,
  webhook,
  revealedSecret,
  eventType,
  filters,
  onChangeEventType,
  onChangeFilters,
  onGenerateEndpoint,
  onRotateSecret,
  onApplyCustomSecret,
  onClearRevealedSecret,
}) => {
  const [maskUrl, setMaskUrl] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [customSecretOpen, setCustomSecretOpen] = useState(false);
  const [customSecretDraft, setCustomSecretDraft] = useState("");
  const [applyingCustomSecret, setApplyingCustomSecret] = useState(false);
  const [curlOpen, setCurlOpen] = useState(false);
  const [copiedFlag, setCopiedFlag] = useState<"url" | "secret" | null>(null);
  const [testing, setTesting] = useState(false);
  const [testFeedback, setTestFeedback] = useState<WebhookTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<WebhookReceipt[]>([]);
  const [newPointer, setNewPointer] = useState("/");
  const [newValue, setNewValue] = useState("");

  useEffect(() => {
    if (!rotinaId || !webhook) {
      setReceipts([]);
      return;
    }
    let cancelled = false;
    void daemonApi
      .listWebhookReceipts(rotinaId)
      .then((list) => {
        if (!cancelled) setReceipts(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [rotinaId, webhook]);

  const copyText = async (txt: string, kind: "url" | "secret") => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(txt);
      }
      setCopiedFlag(kind);
      setTimeout(() => setCopiedFlag(null), 2000);
    } catch {
      // Fallback silencioso caso clipboard não esteja disponível em contexto de teste
    }
  };

  const maskedUrl = webhook?.url
    ? webhook.url.replace(/([^/]{6})[^/]*$/, "$1••••••••")
    : "";

  const handleTestWebhook = async () => {
    if (!rotinaId) return;
    setTesting(true);
    setTestError(null);
    try {
      const payloadData: Record<string, unknown> = {};
      if (filters.length > 0 && filters[0].pointer.startsWith("/")) {
        const segs = filters[0].pointer.split("/").slice(1);
        let cursor: Record<string, unknown> = payloadData;
        for (let i = 0; i < segs.length; i += 1) {
          const k = segs[i];
          if (i === segs.length - 1) {
            cursor[k] = filters[0].value;
          } else {
            cursor[k] = {};
            cursor = cursor[k] as Record<string, unknown>;
          }
        }
      }
      const res = await daemonApi.testWebhookRoutine(rotinaId, {
        type: eventType.trim() || "teste.manual",
        data: payloadData,
      });
      setTestFeedback(res);
      const refreshedReceipts = await daemonApi.listWebhookReceipts(rotinaId).catch(() => []);
      setReceipts(refreshedReceipts);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Erro ao enviar evento de teste.");
    } finally {
      setTesting(false);
    }
  };

  const handleAddFilter = () => {
    const cleanPointer = newPointer.trim();
    if (!cleanPointer.startsWith("/")) return;
    let parsedValue: string | number | boolean | null = newValue;
    if (newValue === "true") parsedValue = true;
    else if (newValue === "false") parsedValue = false;
    else if (newValue === "null") parsedValue = null;
    else if (newValue !== "" && !Number.isNaN(Number(newValue))) parsedValue = Number(newValue);

    onChangeFilters([...filters, { pointer: cleanPointer, value: parsedValue }]);
    setNewPointer("/");
    setNewValue("");
  };

  return (
    <div className="space-y-4">
      {/* Passo 1 — Endpoint da Rotina */}
      <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[14px] font-semibold text-[#F0F0F0]">
            1. Endpoint da Rotina
          </span>
          {webhook && <CheckCircle2 className="h-4 w-4 text-[#31CF76]" />}
        </div>

        {!rotinaId || !webhook ? (
          <div className="space-y-2">
            <p className="text-[12px] font-normal text-[#979797]">
              Salve e gere uma URL exclusiva assinada para receber eventos HTTP externos nesta rotina.
            </p>
            <button
              type="button"
              disabled={generating}
              onClick={async () => {
                setGenerating(true);
                try {
                  await onGenerateEndpoint();
                } finally {
                  setGenerating(false);
                }
              }}
              className="rounded-xl bg-[#F0F0F0] hover:bg-white px-4 py-2 text-[14px] font-semibold text-[#141414] transition-colors disabled:opacity-45"
            >
              {generating ? "Gerando endpoint..." : "Gerar URL do webhook"}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg bg-[#141414] border border-white/[0.06] px-3 py-2">
              <code className="flex-1 truncate font-terminal text-[12px] text-[#DCDCDC]">
                {maskUrl ? maskedUrl : webhook.url}
              </code>
              <button
                type="button"
                aria-label={maskUrl ? "Exibir URL do webhook" : "Ocultar URL do webhook"}
                onClick={() => setMaskUrl((v) => !v)}
                className="text-[#979797] hover:text-white"
              >
                {maskUrl ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void copyText(webhook.url, "url")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2A2A2A] hover:bg-[#333336] px-3 py-1.5 text-[12px] font-semibold text-[#42A0FF]"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>{copiedFlag === "url" ? "URL copiada" : "Copiar URL do webhook"}</span>
            </button>
          </div>
        )}
      </div>

      {/* Passo 2 — Segredo HMAC-SHA256 */}
      <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[14px] font-semibold text-[#F0F0F0]">
            2. Segredo de Assinatura HMAC-SHA256
          </span>
          <KeyRound className="h-4 w-4 text-[#979797]" />
        </div>

        {revealedSecret && (
          <div className="rounded-xl bg-[#FF9412]/10 border border-[#FF9412]/40 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 text-[#FF9412]">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold">
                <ShieldAlert className="h-4 w-4" />
                Exibição única — guarde agora no seu provedor
              </span>
              <button
                type="button"
                onClick={onClearRevealedSecret}
                className="text-[12px] underline text-[#DCDCDC]"
              >
                Ocultar segredo
              </button>
            </div>
            <div className="rounded-lg bg-[#141414] px-3 py-2 font-terminal text-[12px] text-[#F0F0F0] break-all">
              {revealedSecret}
            </div>
            <button
              type="button"
              onClick={() => void copyText(revealedSecret, "secret")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF9412] px-3 py-1.5 text-[12px] font-semibold text-[#141414]"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>{copiedFlag === "secret" ? "Segredo copiado" : "Copiar segredo HMAC"}</span>
            </button>
          </div>
        )}

        {rotinaId && webhook && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={rotating}
                onClick={async () => {
                  setRotating(true);
                  try {
                    await onRotateSecret();
                  } finally {
                    setRotating(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2A2A2A] hover:bg-[#333336] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0]"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${rotating ? "animate-spin" : ""}`} />
                <span>Rotacionar segredo</span>
              </button>

              <button
                type="button"
                onClick={() => setCustomSecretOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 hover:bg-[#2A2A2A] px-3 py-1.5 text-[12px] font-normal text-[#DCDCDC]"
              >
                <span>Aplicar segredo externo</span>
              </button>
            </div>

            {customSecretOpen && (
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={customSecretDraft}
                  onChange={(e) => setCustomSecretDraft(e.target.value)}
                  placeholder="Cole whsec_... ou segredo do provedor"
                  aria-label="Segredo HMAC externo"
                  className="flex-1 rounded-lg bg-[#141414] border border-white/10 focus:border-[#007CF7] px-3 py-1.5 text-[12px] font-terminal text-[#F0F0F0] focus:outline-none"
                />
                <button
                  type="button"
                  disabled={applyingCustomSecret || customSecretDraft.trim().length < 8}
                  onClick={async () => {
                    setApplyingCustomSecret(true);
                    try {
                      await onApplyCustomSecret(customSecretDraft.trim());
                      setCustomSecretDraft("");
                      setCustomSecretOpen(false);
                    } finally {
                      setApplyingCustomSecret(false);
                    }
                  }}
                  className="rounded-lg bg-[#007CF7] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-45"
                >
                  Confirmar segredo externo
                </button>
              </div>
            )}

            <div>
              <button
                type="button"
                onClick={() => setCurlOpen((o) => !o)}
                className="inline-flex items-center gap-1 text-[12px] font-normal text-[#42A0FF] hover:underline"
              >
                {curlOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                <span>Ver exemplo de requisição assinada</span>
              </button>
              {curlOpen && (
                <pre className="mt-2 overflow-x-auto rounded-lg bg-[#141414] border border-white/[0.06] p-3 font-terminal text-[12px] text-[#DCDCDC]">
                  {buildSignedCurlExample(webhook.url)}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Passo 3 — Verificação e Filtros */}
      <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-4 space-y-4">
        <span className="block text-[14px] font-semibold text-[#F0F0F0]">
          3. Verificação e Filtros
        </span>

        {rotinaId && webhook && (
          <div className="space-y-2">
            <button
              type="button"
              disabled={testing}
              onClick={() => void handleTestWebhook()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2A2A2A] hover:bg-[#333336] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0]"
            >
              <Send className="h-4 w-4 text-[#42A0FF]" />
              <span>{testing ? "Enviando teste..." : "Enviar evento de teste"}</span>
            </button>

            {testFeedback && (
              <div
                className={`rounded-lg px-3 py-2 text-[12px] font-normal border ${
                  testFeedback.status === "accepted"
                    ? "bg-[#31CF76]/10 border-[#31CF76]/40 text-[#31CF76]"
                    : "bg-[#FF9412]/10 border-[#FF9412]/40 text-[#FF9412]"
                }`}
              >
                {testFeedback.status === "accepted"
                  ? `Evento aceito e execução iniciada (${testFeedback.execucao_id ?? "em fila"}).`
                  : `Evento ${testFeedback.status}: ${testFeedback.reason ?? `HTTP ${testFeedback.http_status}`}`}
              </div>
            )}
            {testError && <p className="text-[12px] text-[#FD2F3B]">{testError}</p>}
          </div>
        )}

        <div className="space-y-1">
          <label
            htmlFor="webhook-event-type"
            className="block text-[12px] font-semibold text-[#DCDCDC]"
          >
            Tipo de evento (eventType)
          </label>
          <input
            id="webhook-event-type"
            type="text"
            value={eventType}
            onChange={(e) => onChangeEventType(e.target.value)}
            placeholder="Ex.: order.created ou vazio para aceitar qualquer"
            className="w-full rounded-lg bg-[#141414] border border-white/10 focus:border-[#007CF7] px-3 py-2 text-[12px] font-terminal text-[#F0F0F0] focus:outline-none"
          />
        </div>

        {/* Construtor de Filtros JSON Pointer */}
        <div className="space-y-2">
          <span className="block text-[12px] font-semibold text-[#DCDCDC]">
            Filtros JSON Pointer
          </span>
          {filters.map((f, idx) => (
            <div
              key={`${f.pointer}-${idx}`}
              className="flex items-center justify-between gap-2 rounded-lg bg-[#141414] border border-white/[0.06] px-3 py-1.5"
            >
              <code className="text-[12px] font-terminal text-[#DCDCDC] truncate">
                {f.pointer} == {String(f.value)}
              </code>
              <button
                type="button"
                aria-label="Remover filtro"
                onClick={() => onChangeFilters(filters.filter((_, i) => i !== idx))}
                className="inline-flex items-center gap-1 text-[12px] text-[#FD2F3B] hover:underline shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Remover filtro</span>
              </button>
            </div>
          ))}

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
            <input
              type="text"
              value={newPointer}
              onChange={(e) => setNewPointer(e.target.value)}
              placeholder="/pedido/status"
              aria-label="Caminho JSON Pointer"
              className="rounded-lg bg-[#141414] border border-white/10 focus:border-[#007CF7] px-2.5 py-1.5 text-[12px] font-terminal text-[#F0F0F0] focus:outline-none"
            />
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="Valor esperado"
              aria-label="Valor do filtro"
              className="rounded-lg bg-[#141414] border border-white/10 focus:border-[#007CF7] px-2.5 py-1.5 text-[12px] font-terminal text-[#F0F0F0] focus:outline-none"
            />
            <button
              type="button"
              onClick={handleAddFilter}
              disabled={!newPointer.startsWith("/") || newPointer.length < 2}
              className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#2A2A2A] hover:bg-[#333336] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0] disabled:opacity-45"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Adicionar filtro</span>
            </button>
          </div>
        </div>

        {/* Recibos recentes */}
        {rotinaId && webhook && (
          <div className="space-y-2 pt-2 border-t border-white/[0.06]">
            <span className="block text-[12px] font-semibold text-[#DCDCDC]">
              Recibos recentes ({receipts.length})
            </span>
            {receipts.length === 0 ? (
              <p className="text-[12px] font-normal text-[#979797]">
                Nenhum webhook recebido ainda.
              </p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {receipts.map((rcb) => (
                  <div
                    key={rcb.recibo_id}
                    className="rounded-lg bg-[#141414] border border-white/[0.06] px-3 py-2 flex items-center justify-between gap-2 text-[12px]"
                  >
                    <div className="min-w-0">
                      <p className="font-terminal text-[#DCDCDC] truncate">
                        {rcb.event_type ?? "evento"} · {rcb.delivery_id}
                      </p>
                      {rcb.reason && (
                        <p className="text-[#FF9412]">Motivo: {rcb.reason}</p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 font-semibold ${
                        rcb.status === "started" ? "text-[#31CF76]" : "text-[#FF9412]"
                      }`}
                    >
                      {rcb.status === "started" ? "Iniciado" : "Ignorado"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
