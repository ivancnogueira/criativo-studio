import React, { useEffect, useMemo, useState } from "react";
import type { BrowserProfileInfo, BrowserTabSummary } from "@criativo/contracts";
import { daemonApi, WebSocketClient } from "../../services/websocket-client";
import { InAppBrowserPanel, type BrowserLiveFrame } from "./InAppBrowserPanel";

/**
 * Shell enxuto para as rotas `?detachedBrowser=1` e `?browserPip=1`: mostra apenas o navegador
 * do agente, sincronizado em tempo real via WebSocket com a janela principal.
 */
export const DetachedBrowserWindowView: React.FC = () => {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialTabId = params.get("tabId");
  const agentId = params.get("agent");

  const [tabs, setTabs] = useState<BrowserTabSummary[]>([]);
  const [frames, setFrames] = useState<Record<string, BrowserLiveFrame>>({});
  const [activeTabId, setActiveTabId] = useState<string | null>(initialTabId);
  const [profiles, setProfiles] = useState<BrowserProfileInfo[]>([]);
  const [agentName, setAgentName] = useState("Criativo");
  const [takeoverTabs, setTakeoverTabs] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    void daemonApi
      .getBrowserStatus()
      .then((status) => {
        if (!alive) return;
        const list = status.tabs ?? [];
        setTabs(list);
        setActiveTabId((prev) => prev ?? list[0]?.tabId ?? null);
      })
      .catch(() => {});
    void daemonApi.listBrowserProfiles().then((p) => alive && setProfiles(p)).catch(() => {});
    if (agentId) {
      void daemonApi
        .listAgents()
        .then((list) => {
          const found = list.find((a) => a.agente_id === agentId);
          if (alive && found) setAgentName(found.nome);
        })
        .catch(() => {});
    }

    const ws = new WebSocketClient();
    const unsubs = [
      ws.on("browser:frame", (evt) => {
        setFrames((prev) => ({
          ...prev,
          [evt.tabId]: {
            tabId: evt.tabId,
            dataUrl: evt.dataUrl,
            width: evt.width,
            height: evt.height,
            url: evt.url,
            title: evt.title,
            userControl: evt.userControl,
          },
        }));
        setTabs((prev) =>
          prev.map((t) =>
            t.tabId === evt.tabId
              ? { ...t, url: evt.url, title: evt.title, userControl: evt.userControl }
              : t
          )
        );
      }),
      ws.on("browser:tabs_updated", (evt) => {
        const next = Array.isArray(evt.tabs) ? evt.tabs : [];
        setTabs(next);
        setActiveTabId((prev) => {
          if (evt.activeTabId && next.some((t) => t.tabId === evt.activeTabId)) return evt.activeTabId;
          if (prev && next.some((t) => t.tabId === prev)) return prev;
          return next[0]?.tabId ?? null;
        });
      }),
      ws.on("browser:tab_unloaded", (evt) => {
        setTabs((prev) =>
          prev.map((t) =>
            t.tabId === evt.tabId
              ? {
                  ...t,
                  url: evt.url || t.url,
                  title: evt.title || t.title,
                  unloaded: true,
                  unloadedAt: evt.unloadedAt,
                  unloadReason: evt.reason,
                }
              : t
          )
        );
        setFrames((prev) => {
          if (!(evt.tabId in prev)) return prev;
          const next = { ...prev };
          delete next[evt.tabId];
          return next;
        });
      }),
      ws.on("browser:takeover_requested", (evt) => {
        setTakeoverTabs((prev) => ({ ...prev, [evt.tabId]: true }));
        setActiveTabId(evt.tabId);
      }),
      ws.on("browser:takeover_resolved", (evt) => {
        setTakeoverTabs((prev) => ({ ...prev, [evt.tabId]: false }));
        setTabs((prev) => prev.map((t) => (t.tabId === evt.tabId ? { ...t, userControl: false } : t)));
      }),
    ];

    return () => {
      alive = false;
      unsubs.forEach((u) => u());
      ws.disconnect();
    };
  }, [agentId]);

  const activeTab = tabs.find((t) => t.tabId === activeTabId) ?? tabs[0] ?? null;

  return (
    <InAppBrowserPanel
      mode="expanded"
      detached
      tabs={tabs}
      activeTabId={activeTabId}
      framesByTab={frames}
      agentName={agentName}
      takeoverPending={Boolean(activeTab && takeoverTabs[activeTab.tabId])}
      profileLabel={
        profiles.find((p) => p.perfil_id === activeTab?.perfilId)?.nome ?? "Perfil Compartilhado"
      }
      onSelectTab={(id) => setActiveTabId(id)}
      onNewTab={async () => {
        const res = (await daemonApi.runBrowserSessionAction({
          action: "open",
          agenteId: agentId ?? undefined,
          url: "https://www.google.com",
        })) as { tabId?: string; result?: { tabId?: string } };
        const id = res?.result?.tabId ?? res?.tabId;
        if (id) setActiveTabId(id);
      }}
      onCloseTab={async (id) => {
        await daemonApi.runBrowserSessionAction({ action: "close_tab", tabId: id });
      }}
      onNavigate={async (id, url) => {
        await daemonApi.runBrowserSessionAction({ action: "navigate", tabId: id, url });
      }}
      onGoBack={async (id) => {
        await daemonApi.runBrowserSessionAction({ action: "go_back", tabId: id });
      }}
      onGoForward={async (id) => {
        await daemonApi.runBrowserSessionAction({ action: "go_forward", tabId: id });
      }}
      onReload={async (id) => {
        await daemonApi.runBrowserSessionAction({ action: "reload", tabId: id });
      }}
      onExpand={() => undefined}
      onCollapseToChat={() => window.close()}
      onClosePanel={() => window.close()}
      onAssumeControl={async (id) => {
        await daemonApi.startBrowserTakeover(id, { agenteId: agentId, reason: "manual" });
      }}
      onCompleteControl={async (id) => {
        await daemonApi.respondBrowserTakeover(id, "complete");
      }}
      onSendInput={async (id, input, autoAssume) => {
        await daemonApi.sendBrowserInput(id, { ...input, autoAssume });
      }}
    />
  );
};
