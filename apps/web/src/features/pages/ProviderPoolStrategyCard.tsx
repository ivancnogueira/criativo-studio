import React from "react";
import type { PoolEstrategiaContas } from "@criativo/contracts";

export interface ProviderPoolStrategyCardProps {
  strategy: PoolEstrategiaContas;
  disabled?: boolean;
  onChangeStrategy: (next: PoolEstrategiaContas) => void | Promise<void>;
}

const OPTIONS: Array<{
  value: PoolEstrategiaContas;
  title: string;
  description: string;
}> = [
  {
    value: "fill_first",
    title: "Preencher primeiro",
    description: "Usa a conta principal até chegar perto do limite antes de trocar.",
  },
  {
    value: "spread",
    title: "Distribuir",
    description: "Divide os Criativos automaticamente entre as contas com maior folga de cota.",
  },
];

export const ProviderPoolStrategyCard: React.FC<ProviderPoolStrategyCardProps> = ({
  strategy,
  disabled = false,
  onChangeStrategy,
}) => {
  return (
    <div className="px-4 py-3 border-t border-white/[0.06] space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-[#DCDCDC]">
          Estratégia do grupo de contas
        </span>
        <span className="text-[11px] text-[#8E8E93]">
          {strategy === "spread" ? "Modo Spread ativo" : "Modo Fill first ativo"}
        </span>
      </div>

      <div
        role="radiogroup"
        aria-label="Estratégia do grupo de contas"
        className="grid grid-cols-1 sm:grid-cols-2 gap-2"
      >
        {OPTIONS.map((opt) => {
          const active = strategy === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              data-strategy={opt.value}
              onClick={() => {
                if (!active) void onChangeStrategy(opt.value);
              }}
              className={`rounded-xl border p-2.5 text-left transition disabled:opacity-50 ${
                active
                  ? "border-[#42A0FF]/60 bg-[#42A0FF]/12 text-white"
                  : "border-white/[0.07] bg-[#141417] text-[#B8B8C2] hover:border-white/15 hover:text-white"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-semibold">{opt.title}</span>
                <span
                  className={`h-2 w-2 rounded-full ${
                    active ? "bg-[#42A0FF]" : "bg-white/15"
                  }`}
                />
              </div>
              <p className="mt-1 text-[11px] leading-snug text-[#8E8E93]">
                {opt.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
};
