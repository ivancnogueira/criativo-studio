import React, { useEffect, useState } from "react";
import type {
  McpToolConsentDecision,
  McpToolConsentRule,
} from "@criativo/contracts";
import { Plus, ShieldAlert, Trash2 } from "lucide-react";
import { CarbonSelect, type CarbonSelectOption } from "../../components/ui/CarbonControls";
import { daemonApi } from "../../services/websocket-client";

const DECISION_OPTIONS: CarbonSelectOption[] = [
  { value: "always_allow", label: "Sempre permitir" },
  { value: "ask", label: "Perguntar" },
  { value: "allow_once", label: "Permitir 1x" },
  { value: "deny", label: "Bloquear" },
];

export const InspectorMcpConsentCard: React.FC<{
  agenteId: string;
}> = ({ agenteId }) => {
  const [consents, setConsents] = useState<McpToolConsentRule[]>([]);
  const [mcpId, setMcpId] = useState("");
  const [toolName, setToolName] = useState("*");
  const [decision, setDecision] = useState<McpToolConsentDecision>("ask");

  const load = async () => {
    try {
      const list = await daemonApi.listMcpConsents(agenteId);
      setConsents(list);
    } catch {
      // ignora erro em ambiente SSR/offline
    }
  };

  useEffect(() => {
    void load();
  }, [agenteId]);

  const handleAdd = async () => {
    if (!mcpId.trim()) return;
    try {
      await daemonApi.upsertMcpConsent({
        agenteId,
        mcpId: mcpId.trim(),
        toolName: toolName.trim() || "*",
        decision,
      });
      setMcpId("");
      setToolName("*");
      await load();
    } catch {
      // ignora erro transitório
    }
  };

  return (
    <div
      data-testid="inspector-mcp-consents-card"
      className="rounded-xl bg-[#212121] border border-white/[0.06] p-3 space-y-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[12.5px] font-medium text-white">
          <ShieldAlert className="h-4 w-4 text-[#42A0FF]" />
          <span>Consentimentos MCP Granulares</span>
        </span>
        <span className="text-[10.5px] text-[#8E8E93]">{consents.length} regra(s)</span>
      </div>

      <div className="grid grid-cols-1 gap-1.5">
        <div className="flex gap-1.5">
          <input
            type="text"
            value={mcpId}
            onChange={(e) => setMcpId(e.target.value)}
            placeholder="Servidor MCP (ex.: github)"
            className="flex-1 min-w-0 rounded-lg bg-[#141414] border border-white/10 px-2.5 py-1.5 text-[11.5px] text-white placeholder-[#6A6A6A]"
          />
          <input
            type="text"
            value={toolName}
            onChange={(e) => setToolName(e.target.value)}
            placeholder="Tool (*)"
            className="w-24 rounded-lg bg-[#141414] border border-white/10 px-2 py-1.5 text-[11.5px] text-white placeholder-[#6A6A6A]"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex-1 min-w-0">
            <CarbonSelect
              ariaLabel="Política de consentimento MCP"
              value={decision}
              options={DECISION_OPTIONS}
              onChange={(val) => setDecision(val as McpToolConsentDecision)}
            />
          </div>
          <button
            type="button"
            onClick={() => void handleAdd()}
            className="inline-flex items-center gap-1 rounded-lg bg-[#2A2A2E] hover:bg-[#34343A] px-2.5 py-1.5 text-[11.5px] font-medium text-white shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Definir</span>
          </button>
        </div>
      </div>

      {consents.length > 0 && (
        <div className="space-y-1 max-h-36 overflow-y-auto pt-1">
          {consents.map((rule) => (
            <div
              key={rule.consentId}
              className="flex items-center justify-between gap-2 rounded-lg bg-[#141414] border border-white/[0.05] px-2.5 py-1.5 text-[11px]"
            >
              <div className="min-w-0 truncate text-[#DCDCDC]">
                <span className="font-mono text-white">{rule.mcpId}</span> ·{" "}
                <span className="font-mono">{rule.toolName}</span>{" "}
                <span className="text-[#74B9FF]">({rule.decision})</span>
              </div>
              <button
                type="button"
                aria-label={`Revogar consentimento ${rule.consentId}`}
                onClick={() =>
                  void daemonApi.revokeMcpConsent(rule.consentId).then(() => load())
                }
                className="text-[#8E8E93] hover:text-[#FD2F3B] shrink-0"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
