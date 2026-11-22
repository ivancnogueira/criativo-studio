import {
  ArrowUp,
  Check,
  ExternalLink,
  Pin,
  PinOff,
  Plus,
  Settings,
  Smartphone,
  X,
} from "lucide-react";
import {
  MascoteAvatar,
  resolveAgentAvatarConfig,
} from "../../components/MascoteAvatar";
import {
  getCriativoDesktopBridge,
} from "../../types/desktop-bridge";
import { CompactDockMarkdown } from "./floating-dock-helpers";
import type { FloatingDockController } from "./useFloatingDockController";

export function FloatingDesktopDockView({ ctrl }: { ctrl: FloatingDockController }) {
  const {
    agentes,
    dockSettings,
    selectedAgentId,
    pickerOpen,
    side,
    dockPinned,
    workingAgentIds,
    progressByAgent,
    draft,
    setDraft,
    sending,
    rosterError,
    activeServerName,
    pillRef,
    messagesEndRef,
    refreshRoster,
    eligibleAgents,
    includedIds,
    dockAgents,
    cancelScheduledCollapse,
    handleExpandPeek,
    handleLeaveDock,
    handleToggleDockPin,
    handleToggleAgentChat,
    handleToggleAgentPicker,
    handleToggleAgentInDock,
    handleCloseDrawer,
    beginDrag,
    moveDrag,
    endDrag,
    selectedAgent,
    selectedMessages,
    handleSendMessage,
    selectedVis,
    showExpandedPill,
    edgeRoundedClass,
    avatarSizePx,
    pillWidthPx,
  } = ctrl;
  return (
    <div
      data-testid="floating-desktop-dock"
      onMouseEnter={cancelScheduledCollapse}
      onMouseLeave={handleLeaveDock}
      className={`h-screen w-screen bg-transparent flex items-center justify-end p-0 gap-2 select-none overflow-hidden ${
        side === "left" ? "flex-row-reverse" : "flex-row"
      }`}
    >
      {/* Seletor de agentes existentes no dock (+) */}
      {pickerOpen && !selectedAgent && (
        <div
          data-testid="floating-dock-agent-picker"
          onPointerDown={(e) => e.stopPropagation()}
          className="w-[300px] max-h-[440px] rounded-[20px] border border-white/[0.08] bg-[#0F1012] flex flex-col overflow-hidden text-[#F0F0F0]"
        >
          <div className="h-[46px] shrink-0 px-3.5 border-b border-white/[0.06] flex items-center justify-between gap-2">
            <div>
              <div className="text-[13px] font-semibold text-white leading-tight">
                Agentes no dock
              </div>
              <div className="text-[10.5px] text-[#8E8E93]">
                Adicionar ou remover agentes existentes
              </div>
            </div>
            <button
              type="button"
              title="Fechar seletor"
              aria-label="Fechar seletor de agentes"
              onClick={() => void handleCloseDrawer()}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-[#979797] hover:bg-[#242429] hover:text-white transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {eligibleAgents.length === 0 ? (
              <div className="px-3 py-6 text-center space-y-2.5">
                <div className="text-[12px] text-[#8E8E93]">
                  {rosterError || `Nenhum agente disponível em ${activeServerName}.`}
                </div>
                <button
                  type="button"
                  onClick={() => void refreshRoster()}
                  className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] hover:bg-white/[0.12] px-3 py-1 text-[11px] font-medium text-white transition-colors"
                >
                  Tentar novamente
                </button>
              </div>
            ) : (
              eligibleAgents.map((ag) => {
                const vis = resolveAgentAvatarConfig(ag);
                const included = includedIds.includes(ag.agente_id);
                return (
                  <button
                    key={ag.agente_id}
                    type="button"
                    onClick={() => void handleToggleAgentInDock(ag.agente_id, !included)}
                    className="w-full flex items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 hover:bg-white/[0.06] transition-colors text-left"
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <MascoteAvatar
                        avatar={vis}
                        agentKey={ag.agente_id}
                        size={28}
                        hoverAnimate={false}
                      />
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-medium text-white truncate">
                          {ag.nome}
                        </span>
                        <span className="block text-[10.5px] text-[#8E8E93] truncate">
                          {ag.papel}
                        </span>
                      </span>
                    </span>
                    <span
                      className={`h-5 w-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                        included
                          ? "border-[#007CF7] bg-[#007CF7] text-white"
                          : "border-white/20 bg-transparent text-transparent"
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <button
            type="button"
            onClick={() =>
              void getCriativoDesktopBridge()?.openMainWindow?.({ action: "open-dock-settings" })
            }
            className="shrink-0 px-3.5 py-2.5 border-t border-white/[0.06] bg-[#141519] hover:bg-[#1D1E24] text-[12px] font-medium text-[#A8A8B2] hover:text-white flex items-center justify-between transition-colors"
          >
            <span className="flex items-center gap-2">
              <Settings className="h-3.5 w-3.5" />
              <span>Configurações do dock</span>
            </span>
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      )}
      {/* Card Flutuante de Chat Inline (limpo, sem halo de sombra DWM) */}
      {selectedAgent && (
        <div
          data-testid="floating-dock-chat-card"
          className="w-[370px] h-[556px] rounded-[20px] border border-white/[0.08] bg-[#0F1012] flex flex-col overflow-hidden text-[#F0F0F0]"
        >
          {/* Header do Card */}
          <div
            onPointerDown={beginDrag}
            onPointerMove={moveDrag}
            onPointerUp={() => void endDrag()}
            className="h-[46px] shrink-0 px-3.5 border-b border-white/[0.06] flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing"
          >
            <div className="flex items-center gap-2 min-w-0">
              <MascoteAvatar
                avatar={selectedVis}
                agentKey={selectedAgent.agente_id}
                size={26}
                animated={
                  workingAgentIds.has(selectedAgent.agente_id) ||
                  selectedAgent.status === "trabalhando"
                }
                mood={
                  workingAgentIds.has(selectedAgent.agente_id) ||
                  selectedAgent.status === "trabalhando"
                    ? "working"
                    : "idle"
                }
                activity={progressByAgent[selectedAgent.agente_id] ?? null}
              />
              <span className="text-[13px] font-semibold truncate">{selectedAgent.nome}</span>
            </div>

            <div
              className="flex items-center gap-1 shrink-0"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                title="Abrir na janela principal"
                aria-label="Abrir na janela principal"
                onClick={() =>
                  void getCriativoDesktopBridge()?.openMainWindow?.({
                    agenteId: selectedAgent.agente_id,
                  })
                }
                className="h-7 w-7 rounded-lg flex items-center justify-center text-[#979797] hover:bg-[#242429] hover:text-white transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Recolher chat flutuante"
                aria-label="Recolher chat flutuante"
                onClick={() => void handleCloseDrawer()}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-[#979797] hover:bg-[#242429] hover:text-white transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Lista de mensagens */}
          <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-2.5 select-text">
            {selectedMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-4">
                <MascoteAvatar
                  avatar={selectedVis}
                  agentKey={selectedAgent.agente_id}
                  size={44}
                  mood="idle"
                />
                <p className="mt-2.5 text-[13px] font-semibold text-white">
                  {selectedAgent.nome}
                </p>
                <p className="mt-1 text-[11.5px] text-[#979797]">
                  Envie uma mensagem rápida sem abrir a janela principal.
                </p>
              </div>
            ) : (
              selectedMessages.map((msg) => {
                const isUser = msg.autor === "usuario";
                const isWpp =
                  (msg.metadados as Record<string, unknown> | undefined)?.origem === "whatsapp";
                return (
                  <div
                    key={msg.mensagem_id}
                    className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[86%] rounded-2xl px-3.5 py-2 text-[12.5px] leading-relaxed ${
                        isUser
                          ? "bg-[#262629] text-white border border-white/[0.08]"
                          : "bg-[#1A1B1F] text-[#E8E8ED] border border-white/[0.05]"
                      }`}
                    >
                      {isWpp && (
                        <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-[#31CF76]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#31CF76]">
                          <Smartphone className="h-2.5 w-2.5" />
                          <span>WhatsApp</span>
                        </div>
                      )}
                      {isUser ? (
                        <p className="whitespace-pre-wrap break-words">{msg.conteudo_markdown}</p>
                      ) : (
                        <CompactDockMarkdown text={msg.conteudo_markdown} />
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {(workingAgentIds.has(selectedAgent.agente_id) ||
              progressByAgent[selectedAgent.agente_id]) && (
              <div className="flex items-center gap-2 text-[11.5px] text-[#979797] px-1">
                <span className="h-2 w-2 rounded-full bg-[#31CF76] animate-pulse" />
                <span className="truncate">
                  {progressByAgent[selectedAgent.agente_id] || "Processando resposta..."}
                </span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input de envio rápido */}
          <form
            onSubmit={(e) => void handleSendMessage(e)}
            className="shrink-0 p-3 pt-2 border-t border-white/[0.06] bg-[#121316]"
          >
            <div className="flex items-center gap-2 rounded-full border border-white/[0.1] bg-[#1C1C20] px-3 py-1.5 focus-within:border-[#007CF7]">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Mensagem para ${selectedAgent.nome}`}
                className="flex-1 min-w-0 bg-transparent text-[12.5px] text-white outline-none placeholder:text-[#7E7E85]"
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending}
                aria-label={`Enviar para ${selectedAgent.nome}`}
                className="h-7 w-7 rounded-full bg-[#F0F0F0] hover:bg-white text-[#141414] flex items-center justify-center transition disabled:opacity-35 shrink-0"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lingueta discreta colada à borda quando configurada para recolher */}
      {!showExpandedPill ? (
        <button
          type="button"
          data-testid="floating-dock-peek-handle"
          aria-label="Expandir ilha de agentes"
          title="Expandir ilha de agentes"
          onMouseEnter={() => void handleExpandPeek()}
          onClick={() => void handleExpandPeek()}
          className={`h-24 ${
            dockSettings.mostrar_faixa_borda !== false
              ? "w-4 border border-white/[0.07] bg-[#0E0F12] hover:w-5"
              : "w-2 border-transparent bg-transparent opacity-10 hover:opacity-100 hover:w-4 hover:bg-[#0E0F12]"
          } ${edgeRoundedClass} flex items-center justify-center transition-all cursor-pointer`}
        >
          {dockSettings.mostrar_faixa_borda !== false && (
            <span
              className={`h-9 w-1 rounded-full ${
                workingAgentIds.size > 0 ? "bg-[#31CF76] animate-pulse" : "bg-[#42A0FF]/70"
              }`}
            />
          )}
        </button>
      ) : (
        /* Aba Lateral Limpa colada à borda (sem barra de nome, sem grip ruidoso e sem sombra difusa) */
        <div
          ref={pillRef}
          data-testid="floating-dock-pill"
          style={{ width: `${pillWidthPx}px` }}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={() => void endDrag()}
          className={`${edgeRoundedClass} border border-white/[0.06] bg-[#0E0F12] py-2.5 px-1.5 flex flex-col items-center gap-2 cursor-grab active:cursor-grabbing`}
        >
          <div className="flex flex-col items-center gap-1.5">
            {dockAgents.map((ag) => {
              const vis = resolveAgentAvatarConfig(ag);
              const working = workingAgentIds.has(ag.agente_id) || ag.status === "trabalhando";
              const isSelected = selectedAgentId === ag.agente_id;

              return (
                <button
                  key={ag.agente_id}
                  type="button"
                  title={ag.nome}
                  aria-label={`Conversar com ${ag.nome}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    beginDrag(e);
                  }}
                  onPointerMove={moveDrag}
                  onPointerUp={() => void endDrag()}
                  onClick={() => void handleToggleAgentChat(ag.agente_id)}
                  className={`relative rounded-xl p-1 transition-colors ${
                    isSelected ? "bg-[#007CF7]/20 ring-1 ring-[#007CF7]" : "hover:bg-white/[0.06]"
                  }`}
                >
                  <MascoteAvatar
                    avatar={vis}
                    agentKey={ag.agente_id}
                    size={avatarSizePx}
                    animated={working}
                    mood={working ? "working" : "idle"}
                    activity={progressByAgent[ag.agente_id] ?? null}
                  />
                </button>
              );
            })}
          </div>

          <button
            type="button"
            data-testid="floating-dock-add-agents-btn"
            title="Adicionar agentes ao dock"
            aria-label="Adicionar agentes ao dock"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void handleToggleAgentPicker()}
            className={`h-8 w-8 rounded-xl flex items-center justify-center transition-colors ${
              pickerOpen
                ? "bg-[#007CF7]/25 text-white ring-1 ring-[#007CF7]"
                : "text-[#9A9AA2] hover:bg-white/[0.06] hover:text-white"
            }`}
          >
            <Plus className="h-4 w-4" />
          </button>

          <button
            type="button"
            data-testid="floating-dock-pin-toggle"
            title={dockPinned ? "Recolher ilha na borda" : "Manter ilha fixa na borda"}
            aria-label={dockPinned ? "Recolher ilha na borda" : "Manter ilha fixa na borda"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void handleToggleDockPin()}
            className="h-6 w-6 rounded-lg flex items-center justify-center text-[#7E7E85] hover:bg-white/[0.06] hover:text-white transition-colors"
          >
            {dockPinned ? (
              <PinOff className="h-3 w-3" />
            ) : (
              <Pin className="h-3 w-3 text-[#42A0FF]" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}
