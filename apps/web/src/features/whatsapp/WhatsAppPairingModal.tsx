import type {
  AgenteRegistro,
  StatusMensageria,
  WhatsAppContaResumo,
} from "@criativo/contracts";
import {
  QrCode,
  X,
} from "lucide-react";
import { WhatsAppIntegrationPanel } from "./WhatsAppIntegrationPanel";

export { type WhatsAppIntegrationPanelProps } from "./whatsapp-pairing-helpers";
export { WhatsAppIntegrationPanel } from "./WhatsAppIntegrationPanel";

interface WhatsAppPairingModalProps {
  open: boolean;
  status: StatusMensageria;
  qrcodeBase64: string | null;
  onClose: () => void;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  accounts?: WhatsAppContaResumo[];
  agentes?: AgenteRegistro[];
  onRefreshAccounts?: () => Promise<void>;
}

/**
 * Dialog modal completo do WhatsApp preservando compatibilidade com props legadas.
 */
export function WhatsAppPairingModal({
  open,
  status,
  qrcodeBase64,
  onClose,
  onConnect,
  onDisconnect,
  accounts,
  agentes,
  onRefreshAccounts,
}: WhatsAppPairingModalProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Conexão WhatsApp do Estúdio"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D0D0D]/80 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[16px] border border-[#2A2A2A] bg-[#1A1A1A] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#2A2A2A] bg-[#212121] px-6 py-4">
          <div className="flex items-center gap-2">
            <QrCode size={18} className="text-[#31CF76]" />
            <h2 className="text-[20px] font-semibold text-[#F0F0F0]">
              Pareamento Nativo WhatsApp
            </h2>
          </div>
          <button
            type="button"
            aria-label="Fechar modal"
            onClick={onClose}
            className="rounded-[8px] p-1 text-[#979797] hover:bg-[#2A2A2A] hover:text-[#F0F0F0]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <WhatsAppIntegrationPanel
            accounts={accounts}
            fallbackStatus={status}
            fallbackQrCode={qrcodeBase64}
            agentes={agentes}
            onRefreshAccounts={onRefreshAccounts}
            onConnect={async () => {
              await onConnect();
            }}
            onDisconnect={async () => {
              await onDisconnect();
            }}
          />
        </div>
      </div>
    </div>
  );
}

