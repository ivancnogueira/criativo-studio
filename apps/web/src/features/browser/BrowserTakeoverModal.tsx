import React, { useRef, useState } from "react";
import type { BrowserSecretRequest, BrowserTakeoverReason } from "@criativo/contracts";
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  Monitor,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { BrowserTeachBar } from "./BrowserTeachBar";

const REASON_LABELS: Record<BrowserTakeoverReason, string> = {
  login: "Login",
  "2fa": "2FA",
  captcha: "CAPTCHA",
  passkey: "Passkey",
  payment: "Pagamento",
  "sign-in-blocked": "Bloqueio de rede",
  manual: "Manual",
};

export interface BrowserTakeoverCardProps {
  takeoverId: string;
  tabId: string;
  reason: BrowserTakeoverReason;
  url: string;
  title: string;
  previewDataUrl?: string | null;
  busy?: boolean;
  onAssume: (tabId: string) => void;
  onCancel: (tabId: string) => void | Promise<void>;
}

export function BrowserTakeoverCard({
  tabId,
  reason,
  url,
  title,
  previewDataUrl,
  busy = false,
  onAssume,
  onCancel,
}: BrowserTakeoverCardProps) {
  let hostLabel = url;
  try {
    hostLabel = new URL(url).hostname;
  } catch {
    hostLabel = url;
  }

  return (
    <div className="flex flex-col gap-[16px] rounded-xl border border-white/[0.06] bg-[#212121] p-[16px]">
      <div className="flex items-start justify-between gap-[8px]">
        <div className="flex min-w-0 items-center gap-[8px]">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#141414] text-[#42A0FF]">
            <Globe size={16} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-[#F0F0F0]">
              {title || hostLabel}
            </p>
            <p className="truncate font-mono text-[12px] text-[#979797]">{hostLabel}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-[#FF9412]/15 px-2.5 py-0.5 text-[12px] font-semibold text-[#FF9412]">
          {REASON_LABELS[reason] ?? "Manual"}
        </span>
      </div>

      <p className="text-[14px] text-[#DCDCDC]">
        O Criativo pausou para você concluir a autenticação nesta página.
      </p>

      {previewDataUrl && previewDataUrl.startsWith("data:image/") && (
        <div className="overflow-hidden rounded-lg border border-white/[0.06] bg-[#141414]">
          <img
            src={previewDataUrl}
            alt={`Prévia da página ${hostLabel}`}
            className="aspect-video w-full object-contain"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-[8px]">
        <button
          type="button"
          disabled={busy}
          onClick={() => onAssume(tabId)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414] transition hover:bg-white disabled:opacity-50"
        >
          <Monitor size={15} />
          <span>Assumir navegador</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onCancel(tabId)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#2A2A2A] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0] transition hover:bg-[#333333] disabled:opacity-50"
        >
          <X size={15} />
          <span>Interromper controle</span>
        </button>
      </div>
    </div>
  );
}

export interface BrowserTakeoverModalProps {
  open: boolean;
  tabId: string;
  agentName: string;
  url: string;
  title: string;
  profileLabel?: string;
  proxyLabel?: string | null;
  frameDataUrl?: string | null;
  frameWidth?: number;
  frameHeight?: number;
  teachRecording: boolean;
  teachStartedAt: number | null;
  teachStepsCount: number;
  busy?: boolean;
  onClose: () => void;
  onCompleteSession: (tabId: string) => void | Promise<void>;
  onCancelSession: (tabId: string) => void | Promise<void>;
  onSendInput: (
    tabId: string,
    input: {
      type:
        | "mousePressed"
        | "mouseReleased"
        | "mouseMoved"
        | "wheel"
        | "keyDown"
        | "keyUp"
        | "insertText";
      x?: number;
      y?: number;
      button?: "left" | "right" | "middle";
      clickCount?: number;
      deltaX?: number;
      deltaY?: number;
      key?: string;
      code?: string;
      text?: string;
      modifiers?: number;
    }
  ) => void | Promise<void>;
  onStartTeach: () => void | Promise<void>;
  onStopTeach: (action: "save" | "discard") => void | Promise<void>;
}

export function BrowserTakeoverModal({
  open,
  tabId,
  agentName,
  url,
  title,
  profileLabel = "Perfil Compartilhado",
  proxyLabel,
  frameDataUrl,
  frameWidth = 1280,
  frameHeight = 720,
  teachRecording,
  teachStartedAt,
  teachStepsCount,
  busy = false,
  onClose,
  onCompleteSession,
  onCancelSession,
  onSendInput,
  onStartTeach,
  onStopTeach,
}: BrowserTakeoverModalProps) {
  const [teachBarVisible, setTeachBarVisible] = useState(true);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const lastMoveAtRef = useRef<number>(0);

  if (!open) return null;

  const isHttps = url.startsWith("https://");

  const mapPointerCoords = (event: React.PointerEvent<HTMLDivElement> | React.WheelEvent<HTMLDivElement>) => {
    const el = surfaceRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const normX = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const normY = Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)));
    return {
      x: Math.round(normX * frameWidth),
      y: Math.round(normY * frameHeight),
    };
  };

  const resolveButton = (btn: number): "left" | "right" | "middle" => {
    if (btn === 2) return "right";
    if (btn === 1) return "middle";
    return "left";
  };

  const computeModifiers = (e: {
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }): number => {
    return (
      (e.altKey ? 1 : 0) |
      (e.ctrlKey ? 2 : 0) |
      (e.metaKey ? 4 : 0) |
      (e.shiftKey ? 8 : 0)
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/75">
      {/* Header #0D0D0D h-[48px] px-[16px] */}
      <header className="flex h-[48px] shrink-0 items-center justify-between gap-[16px] border-b border-white/[0.06] bg-[#0D0D0D] px-[16px]">
        <div className="flex min-w-0 items-center gap-[8px]">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#242424] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0] transition hover:bg-[#2A2A2A]"
          >
            <ArrowLeft size={14} />
            <span>Voltar ao estúdio</span>
          </button>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#007CF7]/50 bg-[#007CF7]/10 px-2.5 py-0.5 text-[12px] font-semibold text-[#42A0FF]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#007CF7]" />
            <span>Controle humano ativo</span>
          </span>
        </div>

        {/* Barra de URL somente leitura #141414 */}
        <div className="hidden min-w-0 flex-1 items-center gap-[8px] rounded-lg border border-white/[0.06] bg-[#141414] px-3 py-1.5 md:flex">
          {isHttps ? (
            <Lock size={13} className="shrink-0 text-[#31CF76]" />
          ) : (
            <Globe size={13} className="shrink-0 text-[#979797]" />
          )}
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[#F0F0F0]">
            {url || title}
          </span>
          <span className="shrink-0 rounded bg-[#242424] px-2 py-0.5 text-[12px] text-[#979797]">
            {profileLabel}
            {proxyLabel ? ` · ${proxyLabel}` : ""}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-[8px]">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onCancelSession(tabId)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2A2A2A] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0] transition hover:bg-[#333333] disabled:opacity-50"
          >
            <X size={14} />
            <span>Interromper controle</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onCompleteSession(tabId)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#F0F0F0] px-4 py-1.5 text-[12px] font-semibold text-[#141414] transition hover:bg-white disabled:opacity-50"
          >
            <Check size={14} />
            <span>Concluir sessão</span>
          </button>
        </div>
      </header>

      <BrowserTeachBar
        agentName={agentName}
        recording={teachRecording}
        startedAt={teachStartedAt}
        stepsCount={teachStepsCount}
        visible={teachBarVisible}
        busy={busy}
        onStartRecording={onStartTeach}
        onStopRecording={onStopTeach}
        onHideBar={() => setTeachBarVisible(false)}
      />

      {/* Área Central #1A1A1A + Viewport #141414 */}
      <div className="flex flex-1 flex-col items-center justify-center overflow-hidden bg-[#1A1A1A] p-[16px]">
        <div
          ref={surfaceRef}
          tabIndex={0}
          aria-label="Viewport interativa do navegador CDP"
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            surfaceRef.current?.focus();
            const coords = mapPointerCoords(e);
            void onSendInput(tabId, {
              type: "mousePressed",
              x: coords.x,
              y: coords.y,
              button: resolveButton(e.button),
              clickCount: 1,
              modifiers: computeModifiers(e),
            });
          }}
          onPointerUp={(e) => {
            const coords = mapPointerCoords(e);
            void onSendInput(tabId, {
              type: "mouseReleased",
              x: coords.x,
              y: coords.y,
              button: resolveButton(e.button),
              clickCount: 1,
              modifiers: computeModifiers(e),
            });
          }}
          onPointerMove={(e) => {
            const now = Date.now();
            if (now - lastMoveAtRef.current < 60) return;
            lastMoveAtRef.current = now;
            const coords = mapPointerCoords(e);
            void onSendInput(tabId, {
              type: "mouseMoved",
              x: coords.x,
              y: coords.y,
            });
          }}
          onWheel={(e) => {
            const coords = mapPointerCoords(e);
            void onSendInput(tabId, {
              type: "wheel",
              x: coords.x,
              y: coords.y,
              deltaX: Math.round(e.deltaX),
              deltaY: Math.round(e.deltaY),
            });
          }}
          onKeyDown={(e) => {
            e.preventDefault();
            const modifiers = computeModifiers(e);
            void onSendInput(tabId, {
              type: "keyDown",
              key: e.key,
              code: e.code,
              modifiers,
            });
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
              void onSendInput(tabId, {
                type: "insertText",
                text: e.key,
              });
            }
          }}
          onKeyUp={(e) => {
            e.preventDefault();
            void onSendInput(tabId, {
              type: "keyUp",
              key: e.key,
              code: e.code,
              modifiers: computeModifiers(e),
            });
          }}
          className="relative flex h-full w-full max-w-[1280px] items-center justify-center overflow-hidden rounded-xl border border-white/[0.06] bg-[#141414] outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
        >
          {frameDataUrl && frameDataUrl.startsWith("data:image/") ? (
            <img
              src={frameDataUrl}
              alt={title || "Transmissão ao vivo Chromium"}
              draggable={false}
              className="max-h-full max-w-full select-none object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-[8px] p-[24px] text-center">
              <Monitor size={32} className="text-[#42A0FF]" />
              <p className="text-[14px] font-semibold text-[#F0F0F0]">
                Transmitindo sessão Chromium ao vivo. Clique ou digite diretamente na página.
              </p>
              <p className="max-w-md text-[12px] text-[#979797]">
                Se o navegador remoto estiver aguardando o primeiro frame JPEG, clique aqui e interaja
                ou conclua a sessão quando finalizar.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export interface BrowserSecretCardProps {
  request: BrowserSecretRequest;
  busy?: boolean;
  onSubmitSecret: (
    tabId: string,
    payload: {
      username?: string;
      secret: string;
      saveToVault?: boolean;
      loginLabel?: string;
    }
  ) => void | Promise<void>;
  onAssumeManually?: (tabId: string) => void;
}

export function BrowserSecretCard({
  request,
  busy = false,
  onSubmitSecret,
  onAssumeManually,
}: BrowserSecretCardProps) {
  const [username, setUsername] = useState(request.username ?? "");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saveToVault, setSaveToVault] = useState(false);
  const [loginLabel, setLoginLabel] = useState(request.host);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret.trim()) {
      setErrorMsg("Informe a credencial ou código OTP antes de preencher.");
      return;
    }
    setErrorMsg(null);
    const val = secret;
    try {
      await onSubmitSecret(request.tabId, {
        username: username.trim() || undefined,
        secret: val,
        saveToVault,
        loginLabel: saveToVault ? loginLabel.trim() || request.host : undefined,
      });
    } finally {
      setSecret("");
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="flex flex-col gap-[16px] rounded-xl border border-white/[0.06] bg-[#212121] p-[16px]"
    >
      <div className="flex items-start justify-between gap-[8px]">
        <div className="flex items-center gap-[8px]">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#141414] text-[#42A0FF]">
            <KeyRound size={16} />
          </div>
          <div>
            <p className="text-[14px] font-semibold text-[#F0F0F0]">
              Credencial segura — {request.host}
            </p>
            <p className="text-[12px] text-[#979797]">
              Autorize o preenchimento direto em {request.host} sem revelar o segredo ao Criativo.
            </p>
          </div>
        </div>
        <span className="rounded-full bg-[#42A0FF]/15 px-2.5 py-0.5 text-[12px] font-semibold text-[#42A0FF]">
          {request.method === "otp"
            ? `OTP ${request.digits ?? 6} dígitos`
            : request.method === "authenticator"
              ? "Autenticador"
              : "Senha"}
        </span>
      </div>

      {request.method === "password" && (
        <label className="flex flex-col gap-1 text-[12px] text-[#979797]">
          <span>Usuário ou e-mail (opcional)</span>
          <input
            type="text"
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="nome@empresa.invalid"
            className="rounded-lg border border-white/[0.06] bg-[#141414] px-3 py-2 text-[14px] text-[#F0F0F0] outline-none focus:border-[#007CF7]"
          />
        </label>
      )}

      <label className="flex flex-col gap-1 text-[12px] text-[#979797]">
        <span>
          {request.method === "password" ? "Senha da conta" : "Código de verificação"}
        </span>
        <div className="relative flex items-center">
          <input
            type={showSecret ? "text" : "password"}
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={request.method === "password" ? "••••••••••••" : "000000"}
            className="w-full rounded-lg border border-white/[0.06] bg-[#141414] py-2 pl-3 pr-10 text-[14px] text-[#F0F0F0] outline-none focus:border-[#007CF7]"
          />
          <button
            type="button"
            aria-label="Alternar visibilidade do segredo"
            onClick={() => setShowSecret((prev) => !prev)}
            className="absolute right-2.5 text-[#979797] hover:text-[#F0F0F0]"
          >
            {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </label>

      <div className="space-y-2">
        <label className="flex cursor-pointer items-center gap-[8px] text-[12px] text-[#DCDCDC]">
          <input
            type="checkbox"
            checked={saveToVault}
            onChange={(e) => setSaveToVault(e.target.checked)}
            className="h-4 w-4 accent-[#007CF7]"
          />
          <span>Guardar credencial no Cofre local</span>
        </label>

        {saveToVault && (
          <input
            type="text"
            value={loginLabel}
            onChange={(e) => setLoginLabel(e.target.value)}
            placeholder="Rótulo do login no Cofre"
            className="w-full rounded-lg border border-white/[0.06] bg-[#141414] px-3 py-1.5 text-[12px] text-[#F0F0F0] outline-none focus:border-[#007CF7]"
          />
        )}
      </div>

      {errorMsg && (
        <p className="text-[12px] text-[#FD2F3B]">{errorMsg}</p>
      )}

      <div className="flex flex-wrap items-center gap-[8px]">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414] transition hover:bg-white disabled:opacity-50"
        >
          <ShieldCheck size={15} />
          <span>Preencher credencial</span>
        </button>
        {onAssumeManually && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAssumeManually(request.tabId)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2A2A2A] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0] transition hover:bg-[#333333] disabled:opacity-50"
          >
            <Monitor size={15} />
            <span>Assumir manualmente</span>
          </button>
        )}
      </div>
    </form>
  );
}

export interface CaptureScreenConsentCardProps {
  captureId: string;
  agentName: string;
  purpose: string;
  targetHint?: string;
  busy?: boolean;
  onAuthorizeCapture: (
    captureId: string,
    payload: { dataUrl: string; width: number; height: number }
  ) => void | Promise<void>;
  onDeclineCapture: (captureId: string, reason?: string) => void | Promise<void>;
}

export function CaptureScreenConsentCard({
  captureId,
  agentName,
  purpose,
  targetHint,
  busy = false,
  onAuthorizeCapture,
  onDeclineCapture,
}: CaptureScreenConsentCardProps) {
  const [capturing, setCapturing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAuthorize = async () => {
    setErrorMsg(null);
    setCapturing(true);
    let stream: MediaStream | null = null;
    try {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getDisplayMedia !== "function"
      ) {
        throw new Error("Seu navegador não suporta captura de tela via getDisplayMedia().");
      }

      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor" } as MediaTrackConstraints,
        audio: false,
      });

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();

      if (video.readyState < 2) {
        await new Promise<void>((resolve) => {
          video.onloadeddata = () => resolve();
        });
      }

      const rawWidth = Math.max(1, video.videoWidth || 1280);
      const rawHeight = Math.max(1, video.videoHeight || 720);
      const scale = Math.min(1, 1600 / Math.max(rawWidth, rawHeight));
      const width = Math.max(1, Math.round(rawWidth * scale));
      const height = Math.max(1, Math.round(rawHeight * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Contexto Canvas 2D indisponível para gerar captura.");
      }
      ctx.drawImage(video, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/png");

      await onAuthorizeCapture(captureId, { dataUrl, width, height });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Captura cancelada ou não autorizada pelo navegador.";
      setErrorMsg(msg);
    } finally {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      setCapturing(false);
    }
  };

  return (
    <div className="flex flex-col gap-[16px] rounded-xl border border-white/[0.06] bg-[#212121] p-[16px]">
      <div className="flex items-start gap-[12px]">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#42A0FF]/15 text-[#42A0FF]">
          <Monitor size={18} />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[14px] font-semibold text-[#F0F0F0]">
            {agentName} solicitou uma captura única da sua tela para diagnosticar o layout.
          </p>
          <p className="text-[14px] text-[#DCDCDC]">{purpose}</p>
          {targetHint && (
            <p className="font-mono text-[12px] text-[#979797]">Alvo sugerido: {targetHint}</p>
          )}
          <p className="text-[12px] text-[#979797]">
            Apenas um quadro único é capturado após sua seleção na janela do navegador.
          </p>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-[8px] rounded-lg border border-[#FF9412]/30 bg-[#FF9412]/10 px-3 py-2 text-[12px] text-[#FF9412]">
          <ShieldAlert size={14} />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-[8px]">
        <button
          type="button"
          disabled={busy || capturing}
          onClick={() => void handleAuthorize()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414] transition hover:bg-white disabled:opacity-50"
        >
          <Monitor size={15} />
          <span>{capturing ? "Capturando quadro..." : "Autorizar captura"}</span>
        </button>
        <button
          type="button"
          disabled={busy || capturing}
          onClick={() => void onDeclineCapture(captureId, "Recusado pelo usuário no chat.")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#2A2A2A] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0] transition hover:bg-[#333333] disabled:opacity-50"
        >
          <X size={15} />
          <span>Recusar captura</span>
        </button>
      </div>
    </div>
  );
}
