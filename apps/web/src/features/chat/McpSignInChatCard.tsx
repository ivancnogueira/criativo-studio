import { Check, Loader2 } from "lucide-react";
import { AppBrandIcon } from "../../components/ui/CarbonControls";

export interface McpSignInCardState {
  mcpId: string;
  nome: string;
  appSlug?: string | null;
  status: "pending" | "signing_in" | "connected" | "error";
  errorMessage?: string | null;
}

export interface MarketplaceAppSuggestionItem {
  slug: string;
  name: string;
  tagline: string;
}

export interface McpSignInChatCardProps {
  mcpId: string;
  nome: string;
  appSlug?: string | null;
  status: "pending" | "signing_in" | "connected" | "error";
  errorMessage?: string | null;
  onAuthenticate: (mcpId: string) => void;
  onOpenAppPage?: (appSlug: string) => void;
  onRetryContinue?: (mcpId: string) => void;
}

/**
 * Cartão inline no chat disparado por `mcp.oauth_solicitado` e atualizado por `mcp.oauth_concluido`.
 */
export function McpSignInChatCard({
  mcpId,
  nome,
  appSlug,
  status,
  errorMessage,
  onAuthenticate,
  onOpenAppPage,
  onRetryContinue,
}: McpSignInChatCardProps) {
  const borderClass =
    status === "connected"
      ? "border-[#31CF76]/60"
      : status === "signing_in"
        ? "border-[#007CF7]"
        : status === "error"
          ? "border-[#FD2F3B]/60"
          : "border-[#2A2A2A]";

  return (
    <div
      data-testid={`mcp-signin-card-${mcpId}`}
      className={`max-w-[820px] rounded-[12px] border ${borderClass} bg-[#212121] p-4 flex flex-wrap items-center justify-between gap-4`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <AppBrandIcon slug={appSlug} name={nome} size={32} kind="mcp" />
        <div className="min-w-0 space-y-0.5">
          {onOpenAppPage && (appSlug || mcpId) ? (
            <button
              type="button"
              onClick={() => onOpenAppPage(appSlug || mcpId)}
              className="text-[14px] font-semibold text-[#42A0FF] hover:underline text-left truncate block"
            >
              {nome}
            </button>
          ) : (
            <p className="text-[14px] font-semibold text-[#42A0FF] truncate">{nome}</p>
          )}
          {status === "error" ? (
            <p className="text-[14px] text-[#FD2F3B]">
              {errorMessage || "Autenticação recusada ou expirada no navegador."}
            </p>
          ) : status === "connected" ? (
            <p className="text-[14px] text-[#31CF76] font-semibold">
              Conectado — Ferramentas liberadas para o agente continuar.
            </p>
          ) : (
            <p className="text-[14px] text-[#DCDCDC]">
              Conecte sua conta para liberar as ferramentas solicitadas nesta conversa.
            </p>
          )}
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-2">
        {status === "connected" ? (
          onRetryContinue ? (
            <button
              type="button"
              onClick={() => onRetryContinue(mcpId)}
              className="rounded-full border border-[#31CF76]/50 bg-[#31CF76]/15 px-4 py-1.5 text-[14px] font-semibold text-[#31CF76] hover:bg-[#31CF76]/25"
            >
              Continuar execução
            </button>
          ) : (
            <span className="rounded-full bg-[#31CF76]/20 px-3 py-1 text-[12px] font-semibold text-[#31CF76]">
              Conectado
            </span>
          )
        ) : status === "signing_in" ? (
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-2 rounded-full border border-[#007CF7]/60 bg-[#007CF7]/15 px-4 py-1.5 text-[14px] font-semibold text-[#F0F0F0]"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#007CF7]" />
            Aguardando autenticação...
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onAuthenticate(mcpId)}
            className="rounded-full bg-[#F0F0F0] px-4 py-1.5 text-[14px] font-semibold text-[#141414] hover:bg-white"
          >
            {status === "error" ? "Tentar novamente — Autenticar no navegador" : "Autenticar no navegador"}
          </button>
        )}
      </div>
    </div>
  );
}

