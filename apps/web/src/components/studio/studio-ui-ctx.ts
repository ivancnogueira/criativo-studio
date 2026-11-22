import type { StudioAppState } from "../../hooks/useStudioState";
import type { StudioBootstrapActions } from "../../hooks/useStudioBootstrap";
import type { StudioServerActions } from "../../hooks/useStudioServerActions";
import type { StudioTabsAndNavActions } from "../../hooks/useStudioTabsAndNavigation";
import type { StudioDerivedData } from "../../hooks/useStudioDerivedData";
import type { StudioChatSendActions } from "../../hooks/useChatSendActions";
import type { StudioThreadQueueAndChannelActions } from "../../hooks/useThreadQueueAndChannelActions";

export interface StudioUiCtx {
  state: StudioAppState;
  boot: StudioBootstrapActions;
  serverActions: StudioServerActions;
  nav: StudioTabsAndNavActions;
  derived: StudioDerivedData;
  chatSend: StudioChatSendActions;
  threadActions: StudioThreadQueueAndChannelActions;
}
