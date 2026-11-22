import {
  BookOpen,
  Search,
  X,
} from "lucide-react";
import type { ConnectorsPageProps } from "./connectors-types";
import type { ConnectorsController } from "./useConnectorsController";

export function ConnectorsSkillsTab({
  ctrl,
  props,
}: {
  ctrl: ConnectorsController;
  props: ConnectorsPageProps;
}) {
  const {
    agentes = [],
    habilidades = [],
    upgrades = [],
    onInstallUpgrade,
  } = props;
  const {
    hubTab,
    skillQuery,
    setSkillQuery,
    skillFilter,
    setSkillFilter,
    inspectedSkill,
    setInspectedSkill,
    showToast,
    filteredSkills,
  } = ctrl;

  return (
    <>
        {/* ABA 3: HABILIDADES (Catálogo real de SKILL.md instalados + Upgrades em etapas) */}
        {hubTab === "habilidades" && (
          <div className="space-y-4">
            {upgrades.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {upgrades.map((up) => (
                  <div
                    key={up.id}
                    className="rounded-2xl bg-[#1C1C20] border border-white/[0.08] p-4 flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13.5px] font-semibold text-white">{up.nome}</span>
                        <span
                          className={`text-[10.5px] px-2 py-0.5 rounded-full font-medium ${
                            up.instalado
                              ? "bg-[#31CF76]/15 text-[#31CF76]"
                              : "bg-white/[0.07] text-[#B5B5B5]"
                          }`}
                        >
                          {up.instalado ? "Instalado" : "Upgrade modular"}
                        </span>
                      </div>
                      <p className="text-[12px] text-[#979797]">{up.descricao}</p>
                      <p className="text-[11px] text-[#787878]">
                        Agentes: {up.agentes.join(", ")}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.05]">
                      <code className="text-[10.5px] text-[#787878] truncate">{up.comando_cli}</code>
                      {!up.instalado && onInstallUpgrade && (
                        <button
                          type="button"
                          onClick={async () => {
                            await onInstallUpgrade(up.id);
                            showToast(`${up.nome} desbloqueado nos seus agentes!`);
                          }}
                          className="rounded-lg bg-[#F0F0F0] hover:bg-white text-[#141414] px-3 py-1 text-[11.5px] font-semibold shrink-0"
                        >
                          Ativar pacote
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="h-3.5 w-3.5 text-[#6A6A6A] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="conn-filter-skills"
                  name="conn_filter_skills"
                  aria-label="Buscar skill instalada"
                  type="text"
                  value={skillQuery}
                  onChange={(e) => setSkillQuery(e.target.value)}
                  placeholder="Buscar skill instalada (ex: carrossel, copywriter, reels)..."
                  className="w-full rounded-xl bg-[#202020] border border-white/10 pl-8 pr-3 py-2 text-[12.5px] text-white placeholder-[#6A6A6A]"
                />
              </div>

              <div className="flex items-center gap-1.5">
                {[
                  { id: "todas", rotulo: "Todas" },
                  { id: "criativo", rotulo: "Criativo AI Studio" },
                  { id: "sistema", rotulo: "Engenharia & GSD" },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSkillFilter(f.id as typeof skillFilter)}
                    className={`px-3 py-1.5 rounded-xl text-[12px] transition-colors ${
                      skillFilter === f.id
                        ? "bg-[#2A2A2A] text-white border border-white/10"
                        : "text-[#888] hover:text-white bg-[#1D1D1D]"
                    }`}
                  >
                    {f.rotulo}
                  </button>
                ))}
              </div>
            </div>

            {filteredSkills.length === 0 ? (
              <div className="rounded-2xl bg-[#202020] border border-white/[0.07] p-6 text-center text-[12.5px] text-[#888]">
                Nenhuma skill correspondente encontrada em <code className="text-[#DCDCDC]">~/.gemini/config/skills/</code>.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredSkills.map((sk) => (
                  <div
                    key={sk.id}
                    className="rounded-2xl bg-[#202020] border border-white/[0.07] p-4 flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13.5px] font-semibold text-white flex items-center gap-1.5">
                          <BookOpen className="h-3.5 w-3.5 text-[#31CF76]" />
                          {sk.nome}
                        </span>
                        <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-white/[0.06] text-[#B5B5B5]">
                          {sk.categoria}
                        </span>
                      </div>
                      <p className="text-[12px] text-[#888] line-clamp-2">{sk.descricao}</p>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.05] text-[11px]">
                      <span className="text-[#787878] truncate">
                        {sk.agentes_vinculados.length > 0
                          ? `Agentes: ${sk.agentes_vinculados.join(", ")}`
                          : sk.id}
                      </span>
                      <button
                        type="button"
                        onClick={() => setInspectedSkill(sk)}
                        className="text-[#42A0FF] hover:underline shrink-0"
                      >
                        Inspecionar SKILL.md
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      {/* Modal de inspeção do SKILL.md real */}
      {inspectedSkill && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setInspectedSkill(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[80vh] rounded-2xl bg-[#212121] border border-white/15 p-5 flex flex-col gap-3 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
              <div>
                <h3 className="text-[15px] font-semibold text-white">{inspectedSkill.nome}</h3>
                <p className="text-[11px] text-[#787878] truncate">{inspectedSkill.caminho}</p>
              </div>
              <button
                type="button"
                onClick={() => setInspectedSkill(null)}
                className="text-[#888] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <pre className="flex-1 overflow-y-auto rounded-xl bg-[#141414] border border-white/[0.06] p-3.5 text-[11.5px] text-[#DCDCDC] whitespace-pre-wrap font-mono leading-relaxed">
              {inspectedSkill.conteudo_preview}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}
