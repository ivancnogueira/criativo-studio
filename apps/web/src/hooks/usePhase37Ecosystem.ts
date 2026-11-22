import { useCallback, useEffect } from "react";
import { daemonApi } from "../services/websocket-client";
import { applyExternalThemePalette } from "../theme/theme-palette";
import { getCriativoDesktopBridge } from "../types/desktop-bridge";
import type { StudioAppState } from "./useStudioState";
import type { StudioBootstrapActions } from "./useStudioBootstrap";
import type { useStudioTabsAndNavigation } from "./useStudioTabsAndNavigation";

/**
 * Conecta temas externos JSON, status CUA e deep links `criativo://` no ciclo principal da UI (Fase 37).
 */
export function usePhase37Ecosystem(
  state: StudioAppState,
  boot: StudioBootstrapActions,
  nav: ReturnType<typeof useStudioTabsAndNavigation>,
): { abortCuaNow: () => void } {
  const {
    userSettings,
    setActiveSection,
    setJoinServerModalOpen,
    setCuaStatus,
  } = state;

  useEffect(() => {
    const selectedId = userSettings.aparencia.tema_externo_id;
    if (!selectedId) return;
    void daemonApi
      .listExternalThemes()
      .then((res) => {
        const found = res.themes.find((item) => item.id === selectedId);
        if (found) applyExternalThemePalette(found);
      })
      .catch(() => {});
  }, [userSettings.aparencia.tema_externo_id]);

  useEffect(() => {
    if (userSettings.aparencia.desktop_vibrancy === undefined) return;
    void getCriativoDesktopBridge()?.setWindowVibrancy?.(
      Boolean(userSettings.aparencia.desktop_vibrancy),
    );
  }, [userSettings.aparencia.desktop_vibrancy]);

  useEffect(() => {
    const bridge = getCriativoDesktopBridge();
    if (!bridge?.onDeepLink) return;
    return bridge.onDeepLink((route) => {
      if (route.kind === "agent" && route.agenteId) {
        setActiveSection("agentes");
        nav.handleSelectAgent(route.agenteId);
      } else if (route.kind === "workflow") {
        setActiveSection("fluxos");
      } else if (route.kind === "oauth_callback") {
        setActiveSection("conexoes");
      } else if (route.kind === "server_connect") {
        setJoinServerModalOpen(true);
      } else if (route.kind === "template_install") {
        if (route.sourceUrl) {
          void daemonApi
            .installAgentTemplate({ sourceUrl: route.sourceUrl })
            .then(() => boot.hydrateAll())
            .catch(() => {});
        } else if (route.templateJson) {
          try {
            const parsed = JSON.parse(route.templateJson);
            void daemonApi
              .installAgentTemplate({ package: parsed })
              .then(() => boot.hydrateAll())
              .catch(() => {});
          } catch {
            // JSON inválido ignorado
          }
        }
      }
    });
  }, [boot, nav, setActiveSection, setJoinServerModalOpen]);

  const abortCuaNow = useCallback(() => {
    void daemonApi
      .abortCua("Parada acionada pelo usuário na Barra de Pulso.")
      .then((res) => setCuaStatus(res.status))
      .catch(() => {});
    void getCriativoDesktopBridge()?.cuaAbort?.("Parada acionada na Barra de Pulso.");
  }, [setCuaStatus]);

  return { abortCuaNow };
}
