import React, { useState } from "react";
import type {
  CommentDmRule,
  DryRunSimulationResult,
  MetaConnectionConfig,
  MetaReceptionMode,
} from "@criativo/contracts";
import { Check, Copy, Play, Radio, Server, Webhook } from "lucide-react";
import { commentDmApi } from "../../../lib/comment-dm-api";
import { CommentDmSelect } from "./CommentDmSelect";

export interface CommentDmConnectionAndSimulatorProps {
  mode: "connection" | "simulator";
  config: MetaConnectionConfig | null;
  rules: CommentDmRule[];
  onSaved: () => Promise<void>;
}

export const CommentDmConnectionAndSimulator: React.FC<CommentDmConnectionAndSimulatorProps> = ({
  mode,
  config,
  rules,
  onSaved,
}) => {
  const [receptionMode, setReceptionMode] = useState<MetaReceptionMode>(config?.reception_mode ?? "polling");
  const [pollSec, setPollSec] = useState<number>(config?.poll_interval_sec ?? 45);
  const [painelUrl, setPainelUrl] = useState("https://painel.seudominio.invalid");
  const [relayInfo, setRelayInfo] = useState<{ webhook_url?: string; verify_token?: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [selectedRuleId, setSelectedRuleId] = useState(rules[0]?.rule_id ?? "");
  const [simComment, setSimComment] = useState("Eu quero receber!");
  const [simClickButton, setSimClickButton] = useState(true);
  const [simIsReply, setSimIsReply] = useState(false);
  const [simIsLive, setSimIsLive] = useState(false);
  const [simResult, setSimResult] = useState<DryRunSimulationResult | null>(null);

  const copyText = (key: string, txt: string) => {
    void navigator.clipboard?.writeText(txt);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  if (mode === "connection") {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-[#171717] p-5 space-y-4 text-xs">
        <h2 className="text-sm font-semibold">Modos Unificados de Recepção (BYO App Meta · Zero Tokens no Painel)</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            {
              id: "polling" as const,
              title: "1. Polling Local (Zero-Config)",
              desc: "Padrão imediato para PC e VPS. Varre comentários a cada 30s–60s e recupera até 7 dias pós-offline.",
              Icon: Radio,
            },
            {
              id: "painel_relay" as const,
              title: "2. Webhook Relay Painel (Tempo Real)",
              desc: "URL HTTPS vitalícia sem túnel para PC local. O Painel não vê seus tokens Meta; HMAC roda localmente.",
              Icon: Webhook,
            },
            {
              id: "direct_webhook" as const,
              title: "3. Webhook Direto Daemon (VPS HTTPS)",
              desc: "Para VPS com domínio HTTPS próprio apontando para GET/POST /api/instagram/webhook.",
              Icon: Server,
            },
          ].map(({ id, title, desc, Icon }) => {
            const active = receptionMode === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setReceptionMode(id)}
                className={`text-left rounded-xl border p-3.5 space-y-1.5 transition-colors ${
                  active ? "border-[#31CF76]/50 bg-[#31CF76]/10" : "border-white/10 bg-[#121212] hover:border-white/20"
                }`}
              >
                <div className="flex items-center gap-2 font-semibold text-white">
                  <Icon className="h-4 w-4 text-[#31CF76]" />
                  {title}
                </div>
                <p className="text-[11px] text-neutral-400">{desc}</p>
              </button>
            );
          })}
        </div>

        {receptionMode === "polling" && (
          <label className="block max-w-xs space-y-1">
            <span className="text-neutral-300">Intervalo de varredura (segundos)</span>
            <input
              type="number"
              min={15}
              max={300}
              value={pollSec}
              onChange={(e) => setPollSec(Number(e.target.value) || 45)}
              className="w-full rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-white"
            />
          </label>
        )}

        {receptionMode === "painel_relay" && (
          <div className="rounded-lg border border-white/10 bg-[#121212] p-3.5 space-y-3">
            <div className="flex flex-wrap gap-2">
              <input
                value={painelUrl}
                onChange={(e) => setPainelUrl(e.target.value)}
                placeholder="URL HTTPS do CriativoOS Painel"
                className="flex-1 min-w-[240px] rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-white"
              />
              <button
                type="button"
                onClick={async () => {
                  const res = await commentDmApi.provisionPainelRelay({ painel_base_url: painelUrl });
                  if (res.ok) {
                    setRelayInfo({ webhook_url: res.webhook_url, verify_token: res.verify_token });
                    setStatusMsg("Canal Relay provisionado!");
                    await onSaved();
                  } else {
                    setStatusMsg(res.erro ?? "Falha ao provisionar Relay.");
                  }
                }}
                className="rounded-lg bg-[#42A0FF] px-3.5 py-2 font-semibold text-[#06101B]"
              >
                Gerar URL Vitalícia Relay
              </button>
            </div>
            {(relayInfo?.webhook_url || config?.relay_channel_id) && (
              <div className="space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between rounded bg-[#181818] px-3 py-2">
                  <span className="truncate">
                    URL Callback: {relayInfo?.webhook_url || `/api/webhooks/meta-relay/${config?.relay_channel_id}`}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        "url",
                        relayInfo?.webhook_url || `/api/webhooks/meta-relay/${config?.relay_channel_id}`
                      )
                    }
                    className="text-[#42A0FF]"
                  >
                    {copiedKey === "url" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                {(relayInfo?.verify_token || config?.relay_verify_token) && (
                  <div className="flex items-center justify-between rounded bg-[#181818] px-3 py-2">
                    <span className="truncate">
                      Verify Token: {relayInfo?.verify_token || config?.relay_verify_token}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        copyText("tok", relayInfo?.verify_token || config?.relay_verify_token || "")
                      }
                      className="text-[#42A0FF]"
                    >
                      {copiedKey === "tok" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {statusMsg && <div className="text-xs text-[#31CF76]">{statusMsg}</div>}

        <button
          type="button"
          onClick={async () => {
            await commentDmApi.updateConnectionConfig({
              reception_mode: receptionMode,
              poll_interval_sec: pollSec,
            });
            setStatusMsg("Configuração de recepção salva.");
            await onSaved();
          }}
          className="rounded-lg bg-[#31CF76] px-4 py-2 font-semibold text-[#08120C]"
        >
          Salvar Modo de Recepção
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#171717] p-5 space-y-4 text-xs">
      <h2 className="text-sm font-semibold">Simulador Dry-Run (0 chamadas HTTP na Meta)</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <CommentDmSelect
          value={selectedRuleId || rules[0]?.rule_id || ""}
          onChange={setSelectedRuleId}
          placeholder="Selecione uma regra para testar"
          options={rules.map((r) => ({ value: r.rule_id, label: r.nome }))}
        />
        <input
          value={simComment}
          onChange={(e) => setSimComment(e.target.value)}
          placeholder="Comentário simulado do seguidor"
          className="rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-white"
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={simClickButton} onChange={(e) => setSimClickButton(e.target.checked)} />
          <span>Simular clique do seguidor no botão CTA (abre 24h)</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={simIsReply} onChange={(e) => setSimIsReply(e.target.checked)} />
          <span>É réplica de outro comentário</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={simIsLive} onChange={(e) => setSimIsLive(e.target.checked)} />
          <span>Comentário em Live</span>
        </label>
      </div>

      <button
        type="button"
        disabled={!(selectedRuleId || rules[0]?.rule_id)}
        onClick={async () => {
          const rid = selectedRuleId || rules[0]?.rule_id;
          if (!rid) return;
          const res = await commentDmApi.simulate({
            rule_id: rid,
            comment_text: simComment,
            is_comment_reply: simIsReply,
            is_live_comment: simIsLive,
            simulated_button_clicks: simClickButton ? ["open"] : [],
          });
          setSimResult(res);
        }}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[#42A0FF] px-4 py-2 font-semibold text-[#06101B]"
      >
        <Play className="h-3.5 w-3.5" /> Rodar Simulação Passo a Passo
      </button>

      {simResult && (
        <div className="rounded-lg border border-white/10 bg-[#121212] p-3.5 space-y-2">
          <div className="font-semibold">
            {simResult.matched ? (
              <span className="text-[#31CF76]">Disparou regra: {simResult.rule_name}</span>
            ) : (
              <span className="text-amber-300">Pulada: {simResult.skip_reason}</span>
            )}
          </div>
          {simResult.trace.map((st) => (
            <div key={st.step} className="rounded border border-white/[0.06] bg-[#181818] px-3 py-2">
              <span className="font-mono text-[10px] text-neutral-400 mr-2">
                #{st.step} [{st.window_required}]
              </span>
              <span>{st.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
