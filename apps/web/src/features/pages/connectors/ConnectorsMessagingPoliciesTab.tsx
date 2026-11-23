import React, { useEffect, useState } from "react";
import type {
  AgenteRegistro,
  MessagingAllowlistRole,
  MessagingChannelPolicy,
  MessagingPlatform,
} from "@criativo/contracts";
import { MessageSquare, Plus, Save, Trash2 } from "lucide-react";
import { CarbonSelect, type CarbonSelectOption } from "../../../components/ui/CarbonControls";
import { daemonApi } from "../../../services/websocket-client";

const PLATFORM_LABELS: Record<MessagingPlatform, string> = {
  telegram: "Telegram Bot",
  slack: "Slack App",
  discord: "Discord Bot",
};

const ROLE_OPTIONS: CarbonSelectOption[] = [
  { value: "admin", label: "Admin" },
  { value: "operator", label: "Operador" },
  { value: "viewer", label: "Visualizador (somente leitura)" },
];

export const ConnectorsMessagingPoliciesTab: React.FC<{
  agentes: AgenteRegistro[];
  onToast: (msg: string) => void;
}> = ({ agentes, onToast }) => {
  const [policies, setPolicies] = useState<MessagingChannelPolicy[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState<MessagingPlatform>("telegram");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [newSenderId, setNewSenderId] = useState("");
  const [newSenderRole, setNewSenderRole] = useState<MessagingAllowlistRole>("operator");
  const [newSenderLabel, setNewSenderLabel] = useState("");
  const [newChannelId, setNewChannelId] = useState("");

  useEffect(() => {
    let active = true;
    void daemonApi
      .listMessagingPolicies()
      .then((list) => {
        if (active) setPolicies(list);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const currentPolicy: MessagingChannelPolicy = policies.find(
    (p) => p.channelKind === selectedPlatform,
  ) ?? {
    channelKind: selectedPlatform,
    enabled: true,
    orchestratorAgentId: agentes[0]?.agente_id ?? "orquestrador_estrategista",
    replyInThreads: true,
    allowlist: [],
    allowedChannelIds: [],
  };

  const updateDraft = (updater: (prev: MessagingChannelPolicy) => MessagingChannelPolicy) => {
    setPolicies((prev) => {
      const exists = prev.some((p) => p.channelKind === selectedPlatform);
      if (!exists) {
        return [...prev, updater(currentPolicy)];
      }
      return prev.map((p) => (p.channelKind === selectedPlatform ? updater(p) : p));
    });
  };

  const agentOptions: CarbonSelectOption[] =
    agentes.length > 0
      ? agentes.map((ag) => ({ value: ag.agente_id, label: ag.nome }))
      : [{ value: "orquestrador_estrategista", label: "Orquestrador Estrategista" }];

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await daemonApi.saveMessagingPolicy(selectedPlatform, {
        enabled: currentPolicy.enabled,
        orchestratorAgentId: currentPolicy.orchestratorAgentId,
        replyInThreads: currentPolicy.replyInThreads,
        allowlist: currentPolicy.allowlist,
        allowedChannelIds: currentPolicy.allowedChannelIds,
      });
      setPolicies((prev) => {
        const next = prev.filter((p) => p.channelKind !== saved.channelKind);
        return [...next, saved];
      });
      onToast(`Política conversacional do ${PLATFORM_LABELS[selectedPlatform]} salva.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Erro ao salvar política.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 pb-6" data-testid="messaging-policies-tab">
      <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <MessageSquare className="h-4 w-4 text-[#42A0FF]" />
            <div>
              <h3 className="text-[14px] font-semibold text-white">
                Políticas Conversacionais Multicanal
              </h3>
              <p className="text-[12px] text-[#9E9EA6]">
                Configure allowlist, papéis, thread nativa e Criativo orquestrador padrão para Telegram, Slack e Discord.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 rounded-xl bg-[#121214] p-1 border border-white/[0.06]">
            {(["telegram", "slack", "discord"] as const).map((plat) => (
              <button
                key={plat}
                type="button"
                onClick={() => setSelectedPlatform(plat)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                  selectedPlatform === plat
                    ? "bg-[#2A2A2E] text-white"
                    : "text-[#9E9EA6] hover:text-white"
                }`}
              >
                {PLATFORM_LABELS[plat]}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-[12px] text-[#8E8E93] py-4">Carregando políticas...</div>
        ) : (
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="flex items-center justify-between rounded-xl bg-[#121214] border border-white/[0.06] px-3 py-2.5 text-[12.5px] text-white cursor-pointer">
                <span>Canal ativo</span>
                <input
                  type="checkbox"
                  checked={currentPolicy.enabled}
                  onChange={(e) =>
                    updateDraft((prev) => ({ ...prev, enabled: e.target.checked }))
                  }
                  className="h-4 w-4 accent-[#31CF76]"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl bg-[#121214] border border-white/[0.06] px-3 py-2.5 text-[12.5px] text-white cursor-pointer">
                <span>Responder em thread nativa</span>
                <input
                  type="checkbox"
                  checked={currentPolicy.replyInThreads}
                  onChange={(e) =>
                    updateDraft((prev) => ({ ...prev, replyInThreads: e.target.checked }))
                  }
                  className="h-4 w-4 accent-[#007CF7]"
                />
              </label>

              <div className="space-y-1">
                <span className="block text-[11px] text-[#9E9EA6]">Orquestrador fallback</span>
                <CarbonSelect
                  ariaLabel="Selecionar Criativo orquestrador padrão"
                  value={currentPolicy.orchestratorAgentId}
                  options={agentOptions}
                  onChange={(val) =>
                    updateDraft((prev) => ({ ...prev, orchestratorAgentId: val }))
                  }
                />
              </div>
            </div>

            {/* Allowlist de remetentes */}
            <div className="rounded-xl bg-[#121214] border border-white/[0.06] p-3.5 space-y-3">
              <div className="text-[12.5px] font-semibold text-white">
                Allowlist de remetentes ({currentPolicy.allowlist.length})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <input
                  type="text"
                  value={newSenderId}
                  onChange={(e) => setNewSenderId(e.target.value)}
                  placeholder="ID do remetente (ou *)"
                  className="rounded-lg bg-[#1A1A1D] border border-white/10 px-3 py-1.5 text-[12px] text-white placeholder-[#78787D]"
                />
                <input
                  type="text"
                  value={newSenderLabel}
                  onChange={(e) => setNewSenderLabel(e.target.value)}
                  placeholder="Rótulo opcional"
                  className="rounded-lg bg-[#1A1A1D] border border-white/10 px-3 py-1.5 text-[12px] text-white placeholder-[#78787D]"
                />
                <CarbonSelect
                  ariaLabel="Papel do remetente na allowlist"
                  value={newSenderRole}
                  options={ROLE_OPTIONS}
                  onChange={(val) => setNewSenderRole(val as MessagingAllowlistRole)}
                />
                <button
                  type="button"
                  onClick={() => {
                    const id = newSenderId.trim();
                    if (!id) return;
                    updateDraft((prev) => ({
                      ...prev,
                      allowlist: [
                        ...prev.allowlist.filter((e) => e.senderId !== id),
                        { senderId: id, role: newSenderRole, label: newSenderLabel.trim() || null },
                      ],
                    }));
                    setNewSenderId("");
                    setNewSenderLabel("");
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#242428] hover:bg-[#303036] px-3 py-1.5 text-[12px] font-medium text-white"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Adicionar</span>
                </button>
              </div>

              {currentPolicy.allowlist.length > 0 ? (
                <div className="divide-y divide-white/[0.05]">
                  {currentPolicy.allowlist.map((entry) => (
                    <div
                      key={entry.senderId}
                      className="py-2 flex items-center justify-between gap-2 text-[12px]"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-white truncate">{entry.senderId}</span>
                        {entry.label && (
                          <span className="text-[#9E9EA6] truncate">({entry.label})</span>
                        )}
                        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10.5px] text-[#DCDCDC]">
                          {entry.role}
                        </span>
                      </div>
                      <button
                        type="button"
                        aria-label={`Remover ${entry.senderId}`}
                        onClick={() =>
                          updateDraft((prev) => ({
                            ...prev,
                            allowlist: prev.allowlist.filter((e) => e.senderId !== entry.senderId),
                          }))
                        }
                        className="text-[#9E9EA6] hover:text-[#FD2F3B] p-1"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11.5px] text-[#8E8E93]">
                  Allowlist vazia: qualquer remetente em canais autorizados responde como operador.
                </p>
              )}
            </div>

            {/* Canais permitidos */}
            <div className="rounded-xl bg-[#121214] border border-white/[0.06] p-3.5 space-y-2.5">
              <div className="text-[12.5px] font-semibold text-white">
                IDs de canais/chats autorizados ({currentPolicy.allowedChannelIds.length})
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newChannelId}
                  onChange={(e) => setNewChannelId(e.target.value)}
                  placeholder="Ex.: -100123456 (Telegram) ou C012345 (Slack)"
                  className="flex-1 rounded-lg bg-[#1A1A1D] border border-white/10 px-3 py-1.5 text-[12px] text-white placeholder-[#78787D]"
                />
                <button
                  type="button"
                  onClick={() => {
                    const ch = newChannelId.trim();
                    if (!ch) return;
                    updateDraft((prev) => ({
                      ...prev,
                      allowedChannelIds: Array.from(new Set([...prev.allowedChannelIds, ch])),
                    }));
                    setNewChannelId("");
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#242428] hover:bg-[#303036] px-3 py-1.5 text-[12px] font-medium text-white"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Incluir canal</span>
                </button>
              </div>
              {currentPolicy.allowedChannelIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {currentPolicy.allowedChannelIds.map((ch) => (
                    <span
                      key={ch}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#1A1A1D] border border-white/10 px-2.5 py-1 text-[11.5px] font-mono text-[#DCDCDC]"
                    >
                      {ch}
                      <button
                        type="button"
                        onClick={() =>
                          updateDraft((prev) => ({
                            ...prev,
                            allowedChannelIds: prev.allowedChannelIds.filter((c) => c !== ch),
                          }))
                        }
                        className="text-[#8E8E93] hover:text-white"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#F0F0F0] hover:bg-white px-4 py-2 text-[12.5px] font-semibold text-[#141414] disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{saving ? "Salvando..." : "Salvar política"}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
