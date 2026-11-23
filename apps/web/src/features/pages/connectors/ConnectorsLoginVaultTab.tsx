import React, { useEffect, useState } from "react";
import type {
  CsvLoginImportPreview,
  LoginAutofillPolicy,
  LoginCredentialSummary,
  PasswordManagerDriverStatus,
} from "@criativo/contracts";
import { KeyRound, Plus, ShieldCheck, Trash2, Upload } from "lucide-react";
import { CarbonSelect, type CarbonSelectOption } from "../../../components/ui/CarbonControls";
import { daemonApi } from "../../../services/websocket-client";

const AUTOFILL_POLICY_OPTIONS: CarbonSelectOption[] = [
  { value: "exact", label: "Domínio exato (exact)" },
  { value: "anywhere", label: "Qualquer URL (anywhere)" },
  { value: "never", label: "Nunca autopreencher (never)" },
];

export const ConnectorsLoginVaultTab: React.FC<{
  onToast: (msg: string) => void;
}> = ({ onToast }) => {
  const [logins, setLogins] = useState<LoginCredentialSummary[]>([]);
  const [drivers, setDrivers] = useState<PasswordManagerDriverStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [domain, setDomain] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [autofillPolicy, setAutofillPolicy] = useState<LoginAutofillPolicy>("exact");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [csvText, setCsvText] = useState("");
  const [csvPreview, setCsvPreview] = useState<CsvLoginImportPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    try {
      const [list, drv] = await Promise.all([
        daemonApi.listLogins(),
        daemonApi.getPasswordManagersStatus(),
      ]);
      setLogins(list);
      setDrivers(drv);
    } catch {
      // mantém estado atual
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !domain.trim() || !username.trim() || !password) return;
    setBusy(true);
    try {
      await daemonApi.createLogin({
        title: title.trim(),
        domain: domain.trim(),
        username: username.trim(),
        password,
        autofillPolicy,
      });
      setTitle("");
      setDomain("");
      setUsername("");
      setPassword("");
      setAutofillPolicy("exact");
      await reload();
      onToast("Credencial salva no Cofre de Logins AES-256-GCM.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Erro ao criar login.");
    } finally {
      setBusy(false);
    }
  };

  const handleCsvPreview = async () => {
    if (!csvText.trim()) return;
    setBusy(true);
    try {
      const prev = await daemonApi.importCsvLogins({
        csvText,
        mode: "preview",
        defaultPolicy: "exact",
      });
      setCsvPreview(prev);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Erro ao validar CSV.");
    } finally {
      setBusy(false);
    }
  };

  const handleCsvCommit = async () => {
    if (!csvText.trim()) return;
    setBusy(true);
    try {
      const committed = await daemonApi.importCsvLogins({
        csvText,
        mode: "commit",
        defaultPolicy: "exact",
      });
      setCsvPreview(null);
      setCsvText("");
      await reload();
      onToast(`${committed.importedCount} login(s) importado(s) com segurança.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Erro ao importar CSV.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-6" data-testid="login-vault-tab">
      {/* Status dos gerenciadores externos via CLI */}
      <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#31CF76]" />
          <h3 className="text-[14px] font-semibold text-white">
            Gerenciadores Externos de Senhas (CLI local)
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {drivers.map((drv) => (
            <div
              key={drv.id}
              className="rounded-xl bg-[#121214] border border-white/[0.06] p-3 space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-semibold text-white">{drv.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    drv.authenticated
                      ? "bg-[#31CF76]/15 text-[#31CF76]"
                      : drv.installed
                        ? "bg-[#FF9412]/15 text-[#FF9412]"
                        : "bg-white/[0.06] text-[#9E9EA6]"
                  }`}
                >
                  {drv.authenticated ? "Autenticado" : drv.installed ? "Instalado" : "Ausente"}
                </span>
              </div>
              <p className="text-[11px] text-[#8E8E93]">{drv.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Lista de logins armazenados localmente */}
      <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[#42A0FF]" />
            <h3 className="text-[14px] font-semibold text-white">
              Cofre Estruturado de Logins ({logins.length})
            </h3>
          </div>
          <span className="text-[11px] text-[#8E8E93]">
            Senhas nunca são retornadas em claro para UI ou Criativos
          </span>
        </div>

        {loading ? (
          <div className="text-[12px] text-[#8E8E93] py-2">Carregando cofre de logins...</div>
        ) : logins.length === 0 ? (
          <div className="text-[12px] text-[#8E8E93] py-2">
            Nenhuma credencial cadastrada no Cofre de Logins.
          </div>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {logins.map((item) => (
              <div
                key={item.id}
                className="py-2.5 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-white truncate">{item.title}</div>
                  <div className="text-[11.5px] font-mono text-[#9E9EA6] truncate">
                    {item.domain} · {item.username}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="w-48">
                    <CarbonSelect
                      ariaLabel={`Política de autopreenchimento de ${item.title}`}
                      value={item.autofillPolicy}
                      options={AUTOFILL_POLICY_OPTIONS}
                      onChange={(policy) => {
                        void daemonApi
                          .updateLogin(item.id, {
                            autofillPolicy: policy as LoginAutofillPolicy,
                          })
                          .then(() => reload())
                          .then(() => onToast("Política de domínio atualizada."));
                      }}
                    />
                  </div>
                  {confirmDeleteId === item.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        void daemonApi
                          .deleteLogin(item.id)
                          .then(() => {
                            setConfirmDeleteId(null);
                            return reload();
                          })
                          .then(() => onToast("Credencial removida."));
                      }}
                      className="rounded-lg bg-[#FD2F3B] px-2.5 py-1 text-[11px] font-semibold text-white"
                    >
                      Confirmar
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Excluir login ${item.title}`}
                      onClick={() => setConfirmDeleteId(item.id)}
                      className="p-1.5 rounded-lg text-[#9E9EA6] hover:text-[#FD2F3B] hover:bg-white/[0.04]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Formulário novo login */}
      <form
        onSubmit={handleCreate}
        className="rounded-2xl bg-[#18181A] border border-white/[0.07] p-4 space-y-3"
      >
        <div className="text-[13px] font-semibold text-white">Adicionar credencial de login</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título (ex.: Painel Instagram Business)"
            className="rounded-xl bg-[#121214] border border-white/10 px-3 py-2 text-[12px] text-white placeholder-[#78787D]"
          />
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="Domínio (ex.: business.instagram.com)"
            className="rounded-xl bg-[#121214] border border-white/10 px-3 py-2 text-[12px] text-white placeholder-[#78787D]"
          />
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Usuário / Email"
            className="rounded-xl bg-[#121214] border border-white/10 px-3 py-2 text-[12px] text-white placeholder-[#78787D]"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Senha"
            className="rounded-xl bg-[#121214] border border-white/10 px-3 py-2 text-[12px] text-white placeholder-[#78787D]"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="w-60">
            <CarbonSelect
              ariaLabel="Política padrão do novo login"
              value={autofillPolicy}
              options={AUTOFILL_POLICY_OPTIONS}
              onChange={(val) => setAutofillPolicy(val as LoginAutofillPolicy)}
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#F0F0F0] hover:bg-white px-4 py-2 text-[12.5px] font-semibold text-[#141414] disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Salvar login cifrado</span>
          </button>
        </div>
      </form>

      {/* Importador CSV */}
      <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] p-4 space-y-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-white">
          <Upload className="h-4 w-4 text-[#42A0FF]" />
          <span>Importar logins de arquivo CSV (Chrome, 1Password, Bitwarden)</span>
        </div>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          rows={4}
          placeholder="Cole o CSV (name,url,username,password,note) para pré-visualizar antes de importar..."
          className="w-full rounded-xl bg-[#121214] border border-white/10 px-3 py-2 text-[12px] font-mono text-white placeholder-[#78787D]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !csvText.trim()}
            onClick={() => void handleCsvPreview()}
            className="rounded-xl bg-[#242428] hover:bg-[#303036] px-3.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
          >
            Pré-visualizar importação
          </button>
          {csvPreview && csvPreview.newCount > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleCsvCommit()}
              className="rounded-xl bg-[#31CF76] hover:opacity-90 px-3.5 py-1.5 text-[12px] font-semibold text-[#141414]"
            >
              Confirmar importação ({csvPreview.newCount} novo(s))
            </button>
          )}
        </div>
        {csvPreview && (
          <div className="rounded-xl bg-[#121214] border border-white/[0.06] p-3 text-[12px] text-[#DCDCDC]">
            Detectados {csvPreview.totalParsed} registros · {csvPreview.newCount} novos ·{" "}
            {csvPreview.duplicateCount} duplicados ignorados.
          </div>
        )}
      </div>
    </div>
  );
};
