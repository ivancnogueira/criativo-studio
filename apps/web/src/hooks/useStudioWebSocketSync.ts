import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  daemonApi,
  getActiveServerId,
  setActiveServerId,
  setOnLicenseRequiredHandler,
  WebSocketClient,
} from "../services/websocket-client";
import type { StudioAppState } from "./useStudioState";
import type { StudioBootstrapActions } from "./useStudioBootstrap";
import { registerChatWsHandlers } from "./ws/registerChatWsHandlers";
import { registerSystemWsHandlers } from "./ws/registerSystemWsHandlers";

export function useStudioWebSocketSync(
  state: StudioAppState,
  boot: StudioBootstrapActions
): void {
  const { wsRef } = state;
  const { hydrateAll, refreshAgentThreadsState, refreshRoutineCounts } = boot;

  useEffect(() => {
    const ws = new WebSocketClient();
    wsRef.current = ws;
    const unsubChat = registerChatWsHandlers(ws, state, boot);
    const unsubSystem = registerSystemWsHandlers(ws, state, boot);

    return () => {
      unsubChat();
      unsubSystem();
      wsRef.current = null;
      ws.disconnect();
    };
  }, [hydrateAll, refreshAgentThreadsState, refreshRoutineCounts]);
}
