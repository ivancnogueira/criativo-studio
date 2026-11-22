import React, { useEffect, useState } from "react";
import { PictureInPicture2, Square, Video } from "lucide-react";
import { daemonApi } from "../../services/websocket-client";
import { getCriativoDesktopBridge } from "../../types/desktop-bridge";

export interface InAppBrowserRecorderPipControlsProps {
  tabId: string | null;
  agenteId?: string | null;
}

export const InAppBrowserRecorderPipControls: React.FC<InAppBrowserRecorderPipControlsProps> = ({
  tabId,
  agenteId = null,
}) => {
  const [recording, setRecording] = useState(false);
  const [framesCount, setFramesCount] = useState(0);
  const [pipOpen, setPipOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const desktopBridge = getCriativoDesktopBridge();

  useEffect(() => {
    if (!tabId) return;
    let active = true;
    daemonApi
      .getBrowserSessionRecordingStatus(tabId)
      .then((res) => {
        if (!active) return;
        setRecording(res.state.recording);
        setFramesCount(res.state.framesCount);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [tabId]);

  if (!tabId) return null;

  const handleToggleRecording = async () => {
    setBusy(true);
    setHint(null);
    try {
      if (recording) {
        const res = await daemonApi.stopBrowserSessionRecording(tabId);
        setRecording(false);
        setFramesCount(res.state.framesCount);
        setHint(
          res.state.lastVideoPath
            ? "Vídeo salvo em saidas/browser-gravacoes"
            : res.state.lastError ?? "Gravação finalizada."
        );
      } else {
        const res = await daemonApi.startBrowserSessionRecording(tabId);
        setRecording(res.state.recording);
        setFramesCount(res.state.framesCount);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePip = async () => {
    if (!desktopBridge?.openBrowserPip) return;
    if (pipOpen) {
      await desktopBridge.closeBrowserPip?.();
      setPipOpen(false);
    } else {
      const ok = await desktopBridge.openBrowserPip({ tabId, agenteId });
      setPipOpen(Boolean(ok));
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleToggleRecording()}
        title={hint ?? (recording ? "Parar gravação da sessão" : "Gravar sessão em MP4")}
        className={`inline-flex items-center gap-1 h-[30px] px-2.5 rounded-lg text-[11.5px] font-medium border transition-colors ${
          recording
            ? "bg-[#FD2F3B]/15 border-[#FD2F3B]/40 text-[#FF7675]"
            : "bg-[#1C1C20] border-white/10 text-[#CCCCCC] hover:text-white"
        }`}
      >
        {recording ? <Square className="h-3 w-3" /> : <Video className="h-3.5 w-3.5" />}
        <span>{recording ? `Parar (${framesCount})` : "Gravar"}</span>
      </button>

      {desktopBridge?.openBrowserPip && (
        <button
          type="button"
          onClick={() => void handleTogglePip()}
          title="Abrir navegador em janela flutuante PiP"
          className={`inline-flex items-center gap-1 h-[30px] px-2.5 rounded-lg text-[11.5px] font-medium border transition-colors ${
            pipOpen
              ? "bg-[#42A0FF]/15 border-[#42A0FF]/40 text-[#42A0FF]"
              : "bg-[#1C1C20] border-white/10 text-[#CCCCCC] hover:text-white"
          }`}
        >
          <PictureInPicture2 className="h-3.5 w-3.5" />
          <span>PiP</span>
        </button>
      )}
    </div>
  );
};
