import React, { useMemo, useState } from "react";
import type {
  BackupModelChoice,
  BackupModelsConfig,
  ProvedorStatusInfo,
  UsageLimitAskPayload,
} from "@criativo/contracts";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Clock,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { ProviderLogo } from "../../components/ProviderLogo";

export const MAX_BACKUP_MODEL_ENTRIES = 8;

export function reorderBackupModels(
  order: BackupModelChoice[],
  fromIndex: number,
  toIndex: number
): BackupModelChoice[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= order.length ||
    toIndex >= order.length
  ) {
    return [...order];
  }
  const next = [...order];
  const [moved] = next.splice(fromIndex, 1);
  if (moved) {
    next.splice(toIndex, 0, moved);
  }
  return next;
}

export function resolveBackupModelStatus(
  choice: BackupModelChoice,
  provedores: ProvedorStatusInfo[]
): "pronto" | "limite" | "indisponivel" {
  const prov = provedores.find((p) => p.provedor === choice.provedor);
  if (!prov || (!prov.conectado && !prov.vault_configurado)) {
    return "indisponivel";
  }

  if (choice.conta_id && prov.contas && prov.contas.length > 0) {
    const acc = prov.contas.find((c) => c.id === choice.conta_id);
    if (!acc || acc.estado !== "conectado") {
      return "indisponivel";
    }
    const exhausted = (acc.grupos_cota ?? []).some(
      (g) =>
        (g.janela_5h && g.janela_5h.restante_percentual <= 15) ||
        (g.janela_semanal && g.janela_semanal.restante_percentual <= 5)
    );
    if (exhausted) {
      return "limite";
    }
  }

  const modelMeta = prov.modelos.find((m) => m.id === choice.modelo);
  if (
    modelMeta &&
    typeof modelMeta.restante_percentual === "number" &&
    modelMeta.restante_percentual <= 5
  ) {
    return "limite";
  }

  return "pronto";
}

export interface BackupModelsEditorProps {
  primaryModel: string;
  config: BackupModelsConfig;
  provedores: ProvedorStatusInfo[];
  onChange: (nextConfig: BackupModelsConfig) => void | Promise<void>;
}

export function BackupModelsEditor({
  primaryModel,
  config,
  provedores,
  onChange,
}: BackupModelsEditorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");

  const availableOptions = useMemo(() => {
    const existingKeys = new Set(
      config.order.map((o) => `${o.provedor}:${o.modelo}:${o.conta_id ?? ""}`)
    );
    const primaryNorm = primaryModel.trim().toLowerCase();
    const out: Array<{
      key: string;
      choice: BackupModelChoice;
      rotulo: string;
      contaRotulo: string | null;
      status: "pronto" | "limite" | "indisponivel";
    }> = [];

    for (const prov of provedores) {
      if (!prov.conectado && !prov.vault_configurado) continue;
      const connectedAccounts = (prov.contas ?? []).filter(
        (c) => c.estado === "conectado" || c.token_valido
      );

      for (const m of prov.modelos) {
        if (m.oculto) continue;
        if (m.id.trim().toLowerCase() === primaryNorm) continue;

        if (connectedAccounts.length > 1) {
          for (const acc of connectedAccounts) {
            const key = `${prov.provedor}:${m.id}:${acc.id}`;
            if (existingKeys.has(key)) continue;
            const choice: BackupModelChoice = {
              provedor: prov.provedor,
              modelo: m.id,
              conta_id: acc.id,
            };
            out.push({
              key,
              choice,
              rotulo: m.rotulo || m.id,
              contaRotulo: acc.email || acc.rotulo || acc.id,
              status: resolveBackupModelStatus(choice, provedores),
            });
          }
        } else {
          const singleAccId = connectedAccounts[0]?.id ?? null;
          const key = `${prov.provedor}:${m.id}:${singleAccId ?? ""}`;
          if (existingKeys.has(key) || existingKeys.has(`${prov.provedor}:${m.id}:`)) continue;
          const choice: BackupModelChoice = {
            provedor: prov.provedor,
            modelo: m.id,
            conta_id: singleAccId,
          };
          out.push({
            key,
            choice,
            rotulo: m.rotulo || m.id,
            contaRotulo: connectedAccounts[0]?.email ?? null,
            status: resolveBackupModelStatus(choice, provedores),
          });
        }
      }
    }

    const q = search.trim().toLowerCase();
    if (!q) return out;
    return out.filter(
      (item) =>
        item.rotulo.toLowerCase().includes(q) ||
        item.choice.modelo.toLowerCase().includes(q) ||
        item.choice.provedor.toLowerCase().includes(q) ||
        (item.contaRotulo ?? "").toLowerCase().includes(q)
    );
  }, [config.order, primaryModel, provedores, search]);

  const askBeforeSwitch = !config.automatic;

  const handleToggleAskBeforeSwitch = () => {
    void onChange({
      ...config,
      automatic: askBeforeSwitch, // alterna: se perguntava antes, vira automático
    });
  };

  const handleMove = (fromIndex: number, toIndex: number) => {
    const nextOrder = reorderBackupModels(config.order, fromIndex, toIndex);
    void onChange({ ...config, order: nextOrder });
  };

  const handleRemove = (index: number) => {
    const nextOrder = config.order.filter((_, idx) => idx !== index);
    void onChange({ ...config, order: nextOrder });
  };

  const handleAdd = (choice: BackupModelChoice) => {
    if (config.order.length >= MAX_BACKUP_MODEL_ENTRIES) return;
    setPickerOpen(false);
    setSearch("");
    void onChange({
      ...config,
      order: [...config.order, choice],
    });
  };

  return (
    <div className="space-y-[16px]">
      <div className="space-y-1">
        <h3 className="text-[14px] font-semibold text-[#F0F0F0]">
          Backup Models &amp; Failover
        </h3>
        <p className="text-[12px] text-[#979797]">
          Quando o modelo principal atingir o limite, o Criativo seguirá esta ordem automaticamente.
        </p>
      </div>

      {/* Toggle Perguntar antes de alternar */}
      <div className="flex items-center justify-between gap-[12px] rounded-xl border border-white/[0.06] bg-[#212121] px-[16px] py-[12px]">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-[#F0F0F0]">
            Perguntar antes de alternar quando atingir limite
          </p>
          <p className="text-[12px] text-[#979797]">
            {askBeforeSwitch
              ? "Exibe confirmação no chat antes de usar um modelo reserva."
              : "Alterna automaticamente na fila abaixo sem interromper a tarefa."}
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={askBeforeSwitch}
          aria-label="Perguntar antes de alternar quando atingir limite"
          onClick={handleToggleAskBeforeSwitch}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
            askBeforeSwitch ? "bg-[#007CF7]" : "bg-[#2A2A2A]"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              askBeforeSwitch ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Lista ordenada 1..8 */}
      {config.order.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/[0.08] bg-[#212121]/60 p-[16px] text-center">
          <p className="text-[14px] font-semibold text-[#F0F0F0]">
            Nenhum modelo reserva adicionado
          </p>
          <p className="mt-1 text-[12px] text-[#979797]">
            Adicione até {MAX_BACKUP_MODEL_ENTRIES} modelos para evitar paradas por cota.
          </p>
        </div>
      ) : (
        <ol className="space-y-[8px]">
          {config.order.map((choice, idx) => {
            const st = resolveBackupModelStatus(choice, provedores);
            const badgeStyle =
              st === "pronto"
                ? { label: "Pronto", cls: "bg-[#31CF76]/15 text-[#31CF76]" }
                : st === "limite"
                  ? { label: "Em limite", cls: "bg-[#FF9412]/15 text-[#FF9412]" }
                  : { label: "Indisponível", cls: "bg-[#FD2F3B]/15 text-[#FD2F3B]" };

            return (
              <li
                key={`${choice.provedor}:${choice.modelo}:${choice.conta_id ?? idx}`}
                className="flex items-center justify-between gap-[8px] rounded-xl border border-white/[0.06] bg-[#212121] px-[16px] py-[8px]"
              >
                <div className="flex min-w-0 items-center gap-[8px]">
                  <span className="w-5 shrink-0 font-mono text-[12px] font-semibold text-[#979797]">
                    #{idx + 1}
                  </span>
                  <ProviderLogo provider={choice.provedor} size={16} />
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[12px] font-semibold text-[#F0F0F0]">
                      {choice.modelo}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badgeStyle.cls}`}>
                        {badgeStyle.label}
                      </span>
                      {choice.conta_id && (
                        <span className="truncate text-[11px] text-[#979797]">
                          {choice.conta_id}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={idx === 0}
                    aria-label="Mover modelo acima"
                    title="Mover modelo acima"
                    onClick={() => handleMove(idx, idx - 1)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#979797] hover:bg-[#2A2A2A] hover:text-[#F0F0F0] disabled:opacity-30"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={idx === config.order.length - 1}
                    aria-label="Mover modelo abaixo"
                    title="Mover modelo abaixo"
                    onClick={() => handleMove(idx, idx + 1)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#979797] hover:bg-[#2A2A2A] hover:text-[#F0F0F0] disabled:opacity-30"
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label="Remover modelo"
                    title="Remover modelo"
                    onClick={() => handleRemove(idx)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#979797] hover:bg-[#2A2A2A] hover:text-[#FD2F3B]"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Botão e Popover pesquisável de Adicionar modelo (zero listbox nativo) */}
      <div className="relative">
        <button
          type="button"
          disabled={config.order.length >= MAX_BACKUP_MODEL_ENTRIES}
          onClick={() => setPickerOpen((prev) => !prev)}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414] transition hover:bg-white disabled:opacity-40"
        >
          <Plus size={15} />
          <span>Adicionar modelo</span>
        </button>

        {pickerOpen && (
          <div className="mt-2 rounded-xl border border-white/[0.08] bg-[#141414] p-2 shadow-2xl">
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-[#1A1A1A] px-2.5 py-1.5">
              <Search size={14} className="text-[#979797]" />
              <input
                type="text"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar modelo ou provedor conectado..."
                className="min-w-0 flex-1 bg-transparent text-[13px] text-[#F0F0F0] outline-none placeholder-[#6A6A6A]"
              />
              <button
                type="button"
                aria-label="Fechar busca de modelos"
                onClick={() => setPickerOpen(false)}
                className="text-[#979797] hover:text-[#F0F0F0]"
              >
                <X size={14} />
              </button>
            </div>

            <div
              role="listbox"
              aria-label="Modelos reserva disponíveis"
              className="max-h-56 space-y-1 overflow-y-auto"
            >
              {availableOptions.length === 0 ? (
                <p className="px-2 py-3 text-center text-[12px] text-[#979797]">
                  Nenhum modelo adicional conectado disponível.
                </p>
              ) : (
                availableOptions.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => handleAdd(opt.choice)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-[#242424]"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <ProviderLogo provider={opt.choice.provedor} size={15} />
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-[#F0F0F0]">
                          {opt.rotulo}
                        </p>
                        <p className="truncate font-mono text-[11px] text-[#979797]">
                          {opt.choice.modelo}
                          {opt.contaRotulo ? ` · ${opt.contaRotulo}` : ""}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        opt.status === "pronto"
                          ? "bg-[#31CF76]/15 text-[#31CF76]"
                          : opt.status === "limite"
                            ? "bg-[#FF9412]/15 text-[#FF9412]"
                            : "bg-[#FD2F3B]/15 text-[#FD2F3B]"
                      }`}
                    >
                      {opt.status === "pronto"
                        ? "Pronto"
                        : opt.status === "limite"
                          ? "Em limite"
                          : "Indisponível"}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export interface UsageLimitAskCardProps {
  ask: UsageLimitAskPayload;
  busy?: boolean;
  onResolve: (payload: {
    askId: string;
    choice?: BackupModelChoice;
    remember?: boolean;
    action: "switch" | "wait";
  }) => void | Promise<void>;
}

export function UsageLimitAskCard({ ask, busy = false, onResolve }: UsageLimitAskCardProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [remember, setRemember] = useState(false);

  const selectedChoice = ask.opcoes[selectedIndex] ?? ask.opcoes[0];

  return (
    <div className="flex flex-col gap-[16px] rounded-xl border border-[#FF9412]/30 bg-[#212121] p-[16px]">
      <div className="flex items-start gap-[12px]">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FF9412]/15 text-[#FF9412]">
          <AlertTriangle size={18} />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[14px] font-semibold text-[#F0F0F0]">
            A cota deste modelo atingiu o limite. Escolha um modelo reserva para continuar agora.
          </p>
          <p className="font-mono text-[12px] text-[#979797]">
            Atual: {ask.modelo_atual} ({ask.provedor_atual}) · {ask.motivo}
          </p>
        </div>
      </div>

      {ask.opcoes.length > 0 && (
        <div role="listbox" aria-label="Modelos reserva disponíveis" className="space-y-1.5">
          {ask.opcoes.map((opt, idx) => {
            const active = idx === selectedIndex;
            return (
              <button
                key={`${opt.provedor}:${opt.modelo}:${opt.conta_id ?? idx}`}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => setSelectedIndex(idx)}
                className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition ${
                  active
                    ? "border-[#007CF7] bg-[#007CF7]/10"
                    : "border-white/[0.06] bg-[#1A1A1A] hover:bg-[#242424]"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <ProviderLogo provider={opt.provedor} size={16} />
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[13px] font-semibold text-[#F0F0F0]">
                      {opt.modelo}
                    </p>
                    <p className="truncate text-[11px] text-[#979797]">
                      {opt.provedor}
                      {opt.conta_id ? ` · ${opt.conta_id}` : ""}
                    </p>
                  </div>
                </div>
                {active && (
                  <span className="rounded-full bg-[#007CF7]/20 px-2 py-0.5 text-[11px] font-semibold text-[#42A0FF]">
                    Selecionado
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <label className="flex cursor-pointer items-center gap-[8px] text-[12px] text-[#DCDCDC]">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="h-4 w-4 accent-[#007CF7]"
        />
        <span>Lembrar e alternar automaticamente nas próximas vezes</span>
      </label>

      <div className="flex flex-wrap items-center gap-[8px]">
        <button
          type="button"
          disabled={busy || !selectedChoice}
          onClick={() =>
            selectedChoice &&
            void onResolve({
              askId: ask.ask_id,
              choice: selectedChoice,
              remember,
              action: "switch",
            })
          }
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414] transition hover:bg-white disabled:opacity-50"
        >
          <span>Alternar modelo</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void onResolve({
              askId: ask.ask_id,
              action: "wait",
            })
          }
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#2A2A2A] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0] transition hover:bg-[#333333] disabled:opacity-50"
        >
          <Clock size={14} />
          <span>Aguardar janela</span>
        </button>
      </div>
    </div>
  );
}
