import {
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import type { ConnectorsPageProps } from "./connectors-types";
import type { ConnectorsController } from "./useConnectorsController";

export function ConnectorsVaultTab({
  ctrl,
  props,
}: {
  ctrl: ConnectorsController;
  props: ConnectorsPageProps;
}) {
  const {
    vaultKeys,
    onSaveVaultSecret,
  } = props;
  const {
    hubTab,
    vaultKeyDraftName,
    setVaultKeyDraftName,
    vaultKeyDraftVal,
    setVaultKeyDraftVal,
    showToast,
  } = ctrl;

  return (
    <>
            {/* ABA 4: COFRE (Vault AES-256-GCM) */}
            {hubTab === "cofre" && (
              <div className="space-y-5 pb-6">
                <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] px-4 py-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="h-5 w-5 text-[#31CF76] shrink-0" />
                    <div className="text-[12.5px] text-[#DCDCDC]">
                      <strong>Cofre Local AES-256-GCM:</strong> todas as chaves de API e segredos de publicação são armazenados cifrados apenas na sua máquina.
                    </div>
                  </div>
                  <span className="rounded-full bg-[#31CF76]/15 px-2.5 py-0.5 text-[11px] font-medium text-[#31CF76] shrink-0">
                    {vaultKeys.length} chave(s)
                  </span>
                </div>

                <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] divide-y divide-white/[0.05]">
                  {vaultKeys.map((item) => (
                    <div
                      key={item.chave_nome}
                      className="px-4 py-3 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <KeyRound className="h-4 w-4 text-[#42A0FF] shrink-0" />
                        <span className="text-[13px] font-mono text-white truncate">
                          {item.chave_nome}
                        </span>
                      </div>
                      <span className="text-[11.5px] text-[#8E8E93] shrink-0">
                        Atualizada em {new Date(item.atualizado_em).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                  ))}
                  {vaultKeys.length === 0 && (
                    <div className="px-4 py-5 text-[12.5px] text-[#8E8E93]">
                      Nenhuma chave salva no Cofre até o momento.
                    </div>
                  )}
                </div>

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!vaultKeyDraftName.trim() || !vaultKeyDraftVal.trim()) return;
                    await onSaveVaultSecret(vaultKeyDraftName.trim(), vaultKeyDraftVal.trim());
                    setVaultKeyDraftName("");
                    setVaultKeyDraftVal("");
                    showToast("Segredo cifrado e salvo no Cofre.");
                  }}
                  className="rounded-2xl bg-[#18181A] border border-white/[0.07] p-4 space-y-3"
                >
                  <div className="text-[13px] font-medium text-white">Adicionar ou atualizar segredo</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      id="vault-secret-name"
                      name="vault_secret_name"
                      aria-label="Nome da chave no Cofre"
                      type="text"
                      value={vaultKeyDraftName}
                      onChange={(e) => setVaultKeyDraftName(e.target.value)}
                      placeholder="Ex: elevenlabs_api_key"
                      className="rounded-xl bg-[#111113] border border-white/10 px-3 py-2 text-[12.5px] text-white placeholder-[#6A6A6A]"
                    />
                    <input
                      id="vault-secret-val"
                      name="vault_secret_val"
                      aria-label="Valor da chave no Cofre"
                      type="password"
                      value={vaultKeyDraftVal}
                      onChange={(e) => setVaultKeyDraftVal(e.target.value)}
                      placeholder="Valor secreto"
                      className="rounded-xl bg-[#111113] border border-white/10 px-3 py-2 text-[12.5px] text-white placeholder-[#6A6A6A]"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="rounded-xl bg-[#F0F0F0] hover:bg-white text-[#141414] px-4 py-1.5 text-[12px] font-semibold"
                    >
                      Salvar no Cofre
                    </button>
                  </div>
                </form>
              </div>
            )}
    </>
  );
}
