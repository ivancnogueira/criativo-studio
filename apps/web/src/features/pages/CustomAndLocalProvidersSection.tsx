import React, { useCallback, useEffect, useState } from "react";
import type { CustomOpenAIEndpointConfig, DetectedLocalProvider } from "@criativo/contracts";
import {
  CheckCircle2,
  Cpu,
  Globe,
  Loader2,
  PlugZap,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { daemonApi } from "../../services/websocket-client";

export interface CustomAndLocalProvidersSectionProps {
  onShowToast?: (msg: string) => void;
}

export const CustomAndLocalProvidersSection: React.FC<CustomAndLocalProvidersSectionProps> = ({
  onShowToast,
}) => {
  const [customs, setCustoms] = useState<CustomOpenAIEndpointConfig[]>([]);
  const [locals, setLocals] = useState<DetectedLocalProvider[]>([]);
  const [loadingLocals, setLoadingLocals] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelsText, setModelsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refreshCustoms = useCallback(async () => {
    try {
      const list = await daemonApi.listCustomProviders();
      setCustoms(list);
    } catch {
      // ignora em SSR ou offline inicial
    }
  }, []);

  const scanLocals = useCallback(async (refresh: boolean) => {
    setLoadingLocals(true);
    try {
      const detected = await daemonApi.detectLocalProviders(refresh);
      setLocals(detected);
    } catch {
      setLocals([]);
    } finally {
      setLoadingLocals(false);
    }
  }, []);

  useEffect(() => {
    void refreshCustoms();
    void scanLocals(false);
  }, [refreshCustoms, scanLocals]);

  const handleSaveCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const models = modelsText
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
      const saved = await daemonApi.saveCustomProvider({
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        models,
        apiKey: apiKey.trim() || undefined,
      });
      setCustoms((prev) => [saved, ...prev.filter((c) => c.id !== saved.id)]);
      setName("");
      setBaseUrl("");
      setApiKey("");
      setModelsText("");
      setFormOpen(false);
      onShowToast?.(`Provedor customizado "${saved.name}" salvo com chave no Cofre.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Erro ao salvar provedor customizado.");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    setFeedback(null);
    try {
      const res = await daemonApi.testCustomProvider(id);
      if (res.ok) {
        onShowToast?.(`Conexão validada (${res.models.length} modelo(s) descoberto(s)).`);
      } else {
        setFeedback(res.erro ?? "Falha ao testar conexão com provedor customizado.");
      }
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    await daemonApi.deleteCustomProvider(id);
    setCustoms((prev) => prev.filter((c) => c.id !== id));
    onShowToast?.("Provedor customizado removido.");
  };

  const handleActivateLocal = async (local: DetectedLocalProvider) => {
    const saved = await daemonApi.saveCustomProvider({
      id: local.kind,
      name: local.label,
      baseUrl: local.kind === "ollama" ? `${local.baseUrl}/v1` : local.baseUrl,
      models: local.models,
    });
    setCustoms((prev) => [saved, ...prev.filter((c) => c.id !== saved.id)]);
    onShowToast?.(`${local.label} ativado com ${local.models.length} modelo(s) disponível(is).`);
  };

  return (
    <div className="space-y-6 pt-2">
      {/* Seção: Servidores Locais Detectados */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-[#42A0FF]" />
            <h3 className="text-[13px] font-medium text-[#E5E5E7]">Servidores Locais Detectados</h3>
          </div>
          <button
            type="button"
            disabled={loadingLocals}
            onClick={() => void scanLocals(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#18181A] px-2.5 py-1 text-[11.5px] text-[#DCDCDC] hover:bg-[#222226] disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loadingLocals ? "animate-spin" : ""}`} />
            <span>Re-escanear portas locais</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {locals.map((loc) => (
            <div
              key={loc.kind}
              className="rounded-2xl border border-white/[0.07] bg-[#18181A] p-3.5 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[13px] font-medium text-white">{loc.label}</p>
                  <p className="font-mono text-[10.5px] text-[#8E8E93]">{loc.baseUrl}</p>
                </div>
                {loc.online ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[#31CF76]/15 px-2 py-0.5 text-[10.5px] font-medium text-[#31CF76]">
                    <CheckCircle2 className="h-3 w-3" />
                    Online ({loc.latencyMs ?? 0}ms)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-2 py-0.5 text-[10.5px] text-[#8E8E93]">
                    <XCircle className="h-3 w-3" />
                    Offline
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="truncate text-[11px] text-[#9E9EA6]">
                  {loc.models.length > 0
                    ? `${loc.models.length} modelo(s): ${loc.models.slice(0, 2).join(", ")}`
                    : "Nenhum modelo detectado"}
                </span>
                {loc.online && (
                  <button
                    type="button"
                    onClick={() => void handleActivateLocal(loc)}
                    className="shrink-0 rounded-lg bg-[#31CF76]/20 px-2.5 py-1 text-[11px] font-medium text-[#31CF76] hover:bg-[#31CF76]/30"
                  >
                    Ativar em 1 clique
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Seção: Provedores Customizados OpenAI-Compatíveis */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-[#31CF76]" />
            <h3 className="text-[13px] font-medium text-[#E5E5E7]">
              Provedores Customizados (OpenAI-Compatível)
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setFormOpen((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#222226] border border-white/[0.08] px-3 py-1.5 text-[11.5px] font-medium text-white hover:bg-[#2B2B30]"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{formOpen ? "Fechar formulário" : "Adicionar endpoint"}</span>
          </button>
        </div>

        {feedback && (
          <div className="rounded-xl border border-[#FD2F3B]/30 bg-[#FD2F3B]/10 px-3 py-2 text-[11.5px] text-[#FF8A90]">
            {feedback}
          </div>
        )}

        {formOpen && (
          <form
            onSubmit={handleSaveCustom}
            className="rounded-2xl border border-white/[0.08] bg-[#18181A] p-4 space-y-3"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11.5px] text-[#DCDCDC]">Nome do provedor</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: OpenRouter, DeepSeek, Groq, vLLM"
                  className="w-full rounded-xl border border-white/10 bg-[#0D0D0D] px-3 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11.5px] text-[#DCDCDC]">URL Base (OpenAI /v1)</label>
                <input
                  type="url"
                  required
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://openrouter.ai/api/v1"
                  className="w-full rounded-xl border border-white/10 bg-[#0D0D0D] px-3 py-1.5 text-xs text-white"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11.5px] text-[#DCDCDC]">
                  API Key (armazenada no Cofre AES-256-GCM)
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Opcional para endpoints locais"
                  className="w-full rounded-xl border border-white/10 bg-[#0D0D0D] px-3 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11.5px] text-[#DCDCDC]">
                  Modelos (separados por vírgula)
                </label>
                <input
                  type="text"
                  value={modelsText}
                  onChange={(e) => setModelsText(e.target.value)}
                  placeholder="deepseek/deepseek-r1, qwen-2.5-72b"
                  className="w-full rounded-xl border border-white/10 bg-[#0D0D0D] px-3 py-1.5 text-xs text-white"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#31CF76] px-4 py-1.5 text-xs font-semibold text-[#0D0D0D] hover:bg-[#3CE084] disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Salvar endpoint</span>
              </button>
            </div>
          </form>
        )}

        <div className="rounded-2xl border border-white/[0.07] bg-[#18181A] divide-y divide-white/[0.05]">
          {customs.map((ep) => (
            <div key={ep.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-white">{ep.name}</span>
                  <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-[#9E9EA6]">
                    custom/{ep.id}/*
                  </span>
                  {ep.hasApiKey && (
                    <span className="rounded bg-[#31CF76]/15 px-1.5 py-0.5 text-[10px] text-[#31CF76]">
                      Chave no Cofre
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-[#8E8E93]">{ep.baseUrl}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={testingId === ep.id}
                  onClick={() => void handleTest(ep.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#222226] px-2.5 py-1 text-[11px] text-white hover:bg-[#2B2B30]"
                >
                  {testingId === ep.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <PlugZap className="h-3 w-3 text-[#42A0FF]" />
                  )}
                  <span>Testar Conexão</span>
                </button>
                <button
                  type="button"
                  aria-label={`Remover ${ep.name}`}
                  onClick={() => void handleDelete(ep.id)}
                  className="rounded-lg p-1.5 text-[#8E8E93] hover:bg-[#FD2F3B]/15 hover:text-[#FD2F3B]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
          {customs.length === 0 && (
            <div className="px-4 py-4 text-[12px] text-[#7D7D85]">
              Nenhum provedor OpenAI-compatível cadastrado. Adicione OpenRouter, DeepSeek, Groq ou vLLM acima.
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
