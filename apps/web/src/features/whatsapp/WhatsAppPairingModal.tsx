import type { StatusMensageria } from "@criativo/contracts";
import { CheckCircle2, Loader2, PowerOff, QrCode, X } from "lucide-react";

interface WhatsAppPairingModalProps {
  open: boolean;
  status: StatusMensageria;
  qrcodeBase64: string | null;
  onClose: () => void;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}

export function WhatsAppPairingModal({
  open,
  status,
  qrcodeBase64,
  onClose,
  onConnect,
  onDisconnect,
}: WhatsAppPairingModalProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Conexão WhatsApp do Estúdio"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#212121] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-white/[0.06] pb-3">
          <div className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-[#31CF76]" />
            <h2 className="text-base font-semibold text-white">
              Pareamento Nativo WhatsApp
            </h2>
          </div>
          <button
            type="button"
            aria-label="Fechar modal"
            onClick={onClose}
            className="rounded-lg p-1 text-[#979797] hover:bg-[#2A2A2A] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {status === "conectado" ? (
          <div className="space-y-4 py-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#31CF76]/20 text-[#31CF76]">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <div>
              <span className="inline-block rounded-full border border-[#31CF76]/40 bg-[#31CF76]/15 px-3 py-1 text-xs font-semibold text-[#31CF76]">
                WhatsApp Conectado com Sucesso
              </span>
              <p className="mt-2 text-xs text-[#979797]">
                Envie áudios ou comandos de texto no WhatsApp do estúdio e aprove publicações respondendo com &ldquo;1&rdquo;.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void onDisconnect()}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 px-4 py-2 text-xs font-semibold text-[#FF6069] hover:bg-[#FD2F3B]/20"
            >
              <PowerOff className="h-3.5 w-3.5" />
              Encerrar Sessão Baileys
            </button>
          </div>
        ) : (
          <div className="space-y-4 text-center">
            {qrcodeBase64 ? (
              <div className="mx-auto inline-block rounded-2xl bg-white p-4 shadow-lg">
                <img
                  src={qrcodeBase64}
                  alt="QR Code de pareamento WhatsApp"
                  className="h-56 w-56"
                />
              </div>
            ) : (
              <div className="mx-auto flex h-56 w-56 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#141414] p-4 text-xs text-[#979797]">
                {status === "aguardando_qrcode" ? (
                  <>
                    <Loader2 className="mb-2 h-6 w-6 animate-spin text-[#42A0FF]" />
                    Gerando QR Code na sessão Baileys...
                  </>
                ) : (
                  <>Clique abaixo para gerar um novo QR Code de pareamento.</>
                )}
              </div>
            )}

            <p className="text-xs text-[#979797]">
              Abra o WhatsApp &gt; Aparelhos Conectados &gt; Conectar Aparelho
            </p>

            <button
              type="button"
              onClick={() => void onConnect()}
              className="openbot-btn-primary w-full py-2.5 text-[13px]"
            >
              {status === "aguardando_qrcode" ? "Atualizar QR Code" : "Gerar QR Code Agora"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
