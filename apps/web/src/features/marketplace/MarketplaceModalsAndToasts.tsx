import {
  AlertTriangle,
  ArrowLeft,
  Blocks,
  Bot,
  Check,
  Copy,
  Download,
  ExternalLink,
  Github,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { daemonApi } from "../../services/websocket-client";
import type { MarketplacePageController, MarketplacePageProps } from "./useMarketplacePageController";
import { CustomMcpModal } from "./CustomMcpModal";
import { CreateSkillModal } from "./CreateSkillModal";
import { AddToAgentsDialog } from "./AddToAgentsDialog";

export function MarketplaceModalsAndToasts({
  ctrl,
  props,
}: {
  ctrl: MarketplacePageController;
  props: MarketplacePageProps;
}) {
  const { agentes, onCreateSkillWithAgent } = props;
  const {
    setQuery,
    customMcpModalOpen,
    setCustomMcpModalOpen,
    editingServer,
    setEditingServer,
    createSkillModalOpen,
    setCreateSkillModalOpen,
    batchSkillTarget,
    setBatchSkillTarget,
    skillPendingDelete,
    setSkillPendingDelete,
    githubModalOpen,
    setGithubModalOpen,
    githubUrlInput,
    setGithubUrlInput,
    undoState,
    unlockedAgents,
    loadCatalogAndApps,
    handleConfirmSkillBatch,
    handleUndoSkillBatch,
  } = ctrl;

  return (
    <>
      {/* Modal Excluir Habilidade */}
      {skillPendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D0D0D]/80 p-4"
        >
          <div className="w-full max-w-md rounded-[16px] border border-[#2A2A2A] bg-[#212121] p-6 space-y-4">
            <h3 className="text-[20px] font-semibold text-[#F0F0F0]">
              Excluir habilidade {skillPendingDelete.name}?
            </h3>
            <p className="text-[14px] text-[#979797]">
              Os Criativos vinculados perderão acesso imediato às instruções desta habilidade.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSkillPendingDelete(null)}
                className="rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0]"
              >
                Manter registro
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = skillPendingDelete.skillId;
                  setSkillPendingDelete(null);
                  void daemonApi.deleteLojaSkill(id).then(() => loadCatalogAndApps());
                }}
                className="rounded-full bg-[#FD2F3B] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0]"
              >
                Excluir habilidade
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Importar Repositório GitHub (Agentes/Skills) */}
      {githubModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Importar repositório do GitHub"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D0D0D]/80 p-4"
        >
          <div className="w-full max-w-md rounded-[16px] border border-[#2A2A2A] bg-[#212121] p-6 space-y-4">
            <h3 className="text-[20px] font-semibold text-[#F0F0F0]">Importar repositório</h3>
            <p className="text-[12px] text-[#FF9412]">
              Origem externa do GitHub: este pacote não foi auditado pela equipe do estúdio. Revise as instruções antes de vincular aos seus Criativos.
            </p>
            <input
              type="url"
              value={githubUrlInput}
              onChange={(e) => setGithubUrlInput(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="w-full rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 font-mono text-[12px] text-[#F0F0F0]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setGithubModalOpen(false)}
                className="rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0]"
              >
                Descartar alterações
              </button>
              <button
                type="button"
                onClick={() => {
                  setQuery(githubUrlInput);
                  setGithubModalOpen(false);
                }}
                className="rounded-full bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414]"
              >
                Inspecionar repositório
              </button>
            </div>
          </div>
        </div>
      )}

      <CustomMcpModal
        open={customMcpModalOpen}
        editingServer={editingServer}
        agentes={unlockedAgents}
        onClose={() => {
          setCustomMcpModalOpen(false);
          setEditingServer(null);
        }}
        onSaved={() => void loadCatalogAndApps()}
        onDeleted={() => void loadCatalogAndApps()}
      />

      <CreateSkillModal
        open={createSkillModalOpen}
        agentes={unlockedAgents}
        defaultAgentId={unlockedAgents[0]?.agente_id ?? agentes[0]?.agente_id ?? "estrategista"}
        onClose={() => setCreateSkillModalOpen(false)}
        onCreated={() => void loadCatalogAndApps()}
        onCreateWithAgent={onCreateSkillWithAgent}
      />

      <AddToAgentsDialog
        skill={batchSkillTarget}
        agentes={unlockedAgents}
        onClose={() => setBatchSkillTarget(null)}
        onConfirmBatch={handleConfirmSkillBatch}
      />

      {/* Toast de Undo (6 segundos) */}
      {undoState && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-[12px] border border-[#2A2A2A] bg-[#212121] px-4 py-3 shadow-2xl"
        >
          <span className="text-[14px] text-[#F0F0F0]">
            Vínculos de <strong>{undoState.skillName}</strong> atualizados.
          </span>
          <button
            type="button"
            onClick={() => void handleUndoSkillBatch()}
            className="inline-flex items-center gap-1 rounded-full bg-[#007CF7] px-3 py-1 text-[12px] font-semibold text-[#F0F0F0]"
          >
            <Undo2 size={12} /> Desfazer vínculo
          </button>
        </div>
      )}
    </>
  );
}
