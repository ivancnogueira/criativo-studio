import React, { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { CarbonSelect } from "../../components/ui/CarbonControls";
import { getCriativoDesktopBridge } from "../../types/desktop-bridge";

export interface BrowserWindowActionsBarProps {
  tabId: string | null;
  agenteId?: string | null;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMoveTab: (direction: "left" | "right") => void;
}

/**
 * Ações do navegador integrado: destacar em janela separada (multi-monitor) e reordenar abas.
 */
export const BrowserWindowActionsBar: React.FC<BrowserWindowActionsBarProps> = ({
  tabId,
  agenteId = null,
  canMoveLeft,
  canMoveRight,
  onMoveTab,
}) => {
  const bridge = getCriativoDesktopBridge();
  const [displays, setDisplays] = useState<Array<{ id: string; label: string; primary: boolean }>>([]);
  const [displayId, setDisplayId] = useState<string>("");
  const [detached, setDetached] = useState(false);

  useEffect(() => {
    if (!bridge?.listDetachedBrowserDisplays) return;
    let alive = true;
    void bridge
      .listDetachedBrowserDisplays()
      .then((list) => {
        if (!alive) return;
        setDisplays(list);
        setDisplayId((prev) => prev || list.find((d) => d.primary)?.id || list[0]?.id || "");
      })
      .catch(() => {});
    const unsub = bridge.onDetachedBrowserClosed?.(() => setDetached(false));
    return () => {
      alive = false;
      unsub?.();
    };
  }, [bridge]);

  const handleDetach = async (): Promise<void> => {
    if (bridge?.openDetachedBrowser) {
      const ok = await bridge.openDetachedBrowser({ tabId, agenteId, displayId: displayId || null });
      setDetached(Boolean(ok));
      return;
    }
    const qs = new URLSearchParams({ detachedBrowser: "1" });
    if (tabId) qs.set("tabId", tabId);
    if (agenteId) qs.set("agent", agenteId);
    window.open(`/?${qs.toString()}`, "_blank", "noopener,width=1180,height=780");
  };

  return (
    <div className="flex items-center gap-1" data-testid="browser-window-actions">
      <button
        type="button"
        disabled={!canMoveLeft}
        onClick={() => onMoveTab("left")}
        title="Mover aba para esquerda"
        aria-label="Mover aba para esquerda"
        className="h-[30px] w-[26px] rounded-lg flex items-center justify-center text-[#979797] hover:text-white hover:bg-[#242428] disabled:opacity-30"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={!canMoveRight}
        onClick={() => onMoveTab("right")}
        title="Mover aba para direita"
        aria-label="Mover aba para direita"
        className="h-[30px] w-[26px] rounded-lg flex items-center justify-center text-[#979797] hover:text-white hover:bg-[#242428] disabled:opacity-30"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
      {displays.length > 1 && (
        <CarbonSelect
          ariaLabel="Monitor da janela destacada"
          value={displayId}
          onChange={setDisplayId}
          options={displays.map((d) => ({ value: d.id, label: d.label }))}
          placeholder="Monitor"
          className="w-[140px]"
        />
      )}
      <button
        type="button"
        onClick={() => void handleDetach()}
        title="Abrir o navegador em uma janela separada"
        className={`inline-flex items-center gap-1 h-[30px] px-2.5 rounded-lg text-[11.5px] font-medium border transition-colors ${
          detached
            ? "bg-[#42A0FF]/15 border-[#42A0FF]/40 text-[#42A0FF]"
            : "bg-[#1C1C20] border-white/10 text-[#CCCCCC] hover:text-white"
        }`}
      >
        <ExternalLink className="h-3.5 w-3.5" />
        <span>Destacar janela</span>
      </button>
    </div>
  );
};
