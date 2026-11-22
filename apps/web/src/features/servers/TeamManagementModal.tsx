import React, { useEffect, useState } from "react";
import type {
  ServerAuditEntry,
  TeamInvite,
  TeamMember,
  TeamRole,
} from "@criativo/contracts";
import { ClipboardList, Copy, Shield, UserPlus, Users, X } from "lucide-react";
import { CarbonSelect, type CarbonSelectOption } from "../../components/ui/CarbonControls";
import { daemonApi } from "../../services/websocket-client";

const INVITE_ROLE_OPTIONS: CarbonSelectOption[] = [
  { value: "admin", label: "Admin" },
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Visualizador (Viewer)" },
];

export const TeamManagementModal: React.FC<{
  open: boolean;
  serverName?: string;
  onClose: () => void;
}> = ({ open, serverName = "Servidor", onClose }) => {
  const [tab, setTab] = useState<"members" | "audit">("members");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [auditLogs, setAuditLogs] = useState<ServerAuditEntry[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<TeamRole, "owner">>("editor");
  const [lastToken, setLastToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadData = async () => {
    try {
      const [{ members: m, invites: inv }, logs] = await Promise.all([
        daemonApi.listTeamMembers(),
        daemonApi.listServerAuditLogs(40),
      ]);
      setMembers(m);
      setInvites(inv);
      setAuditLogs(logs);
    } catch {
      // ignora em SSR/offline
    }
  };

  useEffect(() => {
    if (open) {
      void loadData();
    }
  }, [open]);

  if (!open) return null;

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    try {
      const res = await daemonApi.createTeamInvite({ email: email.trim(), role });
      setLastToken(res.inviteToken);
      setEmail("");
      await loadData();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Gestão de Equipe e Auditoria"
      data-testid="team-management-modal"
      className="fixed inset-0 z-[75] bg-black/75 flex items-center justify-center p-4"
    >
      <div className="w-full max-w-[680px] max-h-[85vh] rounded-2xl bg-[#1E1E22] border border-white/15 shadow-2xl flex flex-col overflow-hidden">
        <header className="px-5 py-3.5 border-b border-white/[0.07] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-[#42A0FF]" />
            <h3 className="text-[14.5px] font-semibold text-white">
              Equipe & Auditoria — {serverName}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar gestão de equipe"
            className="text-[#9E9EA6] hover:text-white p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="px-5 pt-3 flex gap-2 border-b border-white/[0.06] pb-3">
          <button
            type="button"
            onClick={() => setTab("members")}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium ${
              tab === "members" ? "bg-[#2A2A2E] text-white" : "text-[#9E9EA6] hover:text-white"
            }`}
          >
            <Shield className="h-3.5 w-3.5" />
            <span>Membros & Convites ({members.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("audit")}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium ${
              tab === "audit" ? "bg-[#2A2A2E] text-white" : "text-[#9E9EA6] hover:text-white"
            }`}
          >
            <ClipboardList className="h-3.5 w-3.5" />
            <span>Trilha de Auditoria ({auditLogs.length})</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === "members" ? (
            <>
              <form
                onSubmit={handleInvite}
                className="rounded-xl bg-[#141414] border border-white/[0.07] p-3.5 space-y-2.5"
              >
                <div className="text-[12.5px] font-semibold text-white">Convidar membro</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@equipe.com"
                    className="rounded-lg bg-[#1A1A1D] border border-white/10 px-3 py-1.5 text-[12px] text-white"
                  />
                  <CarbonSelect
                    ariaLabel="Papel do membro convidado"
                    value={role}
                    options={INVITE_ROLE_OPTIONS}
                    onChange={(v) => setRole(v as Exclude<TeamRole, "owner">)}
                  />
                  <button
                    type="submit"
                    disabled={busy || !email.trim()}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#F0F0F0] hover:bg-white px-3 py-1.5 text-[12px] font-semibold text-[#141414] disabled:opacity-50"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    <span>Gerar convite</span>
                  </button>
                </div>
                {lastToken && (
                  <div className="flex items-center gap-2 rounded-lg bg-[#31CF76]/10 border border-[#31CF76]/30 px-3 py-2 text-[11.5px] text-[#31CF76]">
                    <span className="truncate font-mono flex-1">Token: {lastToken}</span>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(lastToken)}
                      className="inline-flex items-center gap-1 underline"
                    >
                      <Copy className="h-3 w-3" /> Copiar
                    </button>
                  </div>
                )}
              </form>

              <div className="space-y-2">
                {members.map((m) => (
                  <div
                    key={m.memberId}
                    className="rounded-xl bg-[#141414] border border-white/[0.07] px-3.5 py-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium text-white truncate">
                        {m.displayName} ({m.email})
                      </div>
                      <div className="text-[11px] text-[#8E8E93]">
                        Papel: {m.role} · Status: {m.status}
                      </div>
                    </div>
                    {m.status === "active" && m.role !== "owner" && (
                      <button
                        type="button"
                        onClick={() =>
                          void daemonApi.revokeTeamMember(m.memberId).then(() => loadData())
                        }
                        className="rounded-lg border border-[#FD2F3B]/35 px-2.5 py-1 text-[11px] text-[#FD2F3B] hover:bg-[#FD2F3B]/10"
                      >
                        Revogar
                      </button>
                    )}
                  </div>
                ))}
                {invites.length > 0 && (
                  <div className="text-[11.5px] text-[#9E9EA6] pt-1">
                    Convites pendentes: {invites.filter((i) => i.status === "pending").length}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-2">
              {auditLogs.map((log) => (
                <div
                  key={log.auditId}
                  className="rounded-xl bg-[#141414] border border-white/[0.06] px-3.5 py-2.5 text-[11.5px]"
                >
                  <div className="flex items-center justify-between gap-2 text-white font-medium">
                    <span>{log.action}</span>
                    <span className="text-[10.5px] text-[#8E8E93]">
                      {new Date(log.createdAt).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <div className="text-[#9E9EA6] mt-0.5">
                    Ator: {log.actorLabel} · Recurso: {log.resourceType}
                  </div>
                </div>
              ))}
              {auditLogs.length === 0 && (
                <div className="text-[12px] text-[#8E8E93]">
                  Nenhum evento administrativo registrado ainda.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
