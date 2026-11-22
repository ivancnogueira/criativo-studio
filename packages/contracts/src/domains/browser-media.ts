/**
 * Contratos de automacao de navegador CDP, perfis, proxies, takeover e leitura de midia.
 */

export type BrowserProxyProtocol = "http" | "https" | "socks5";

export interface BrowserProxyConfig {
  proxy_id: string;
  nome: string;
  servidor: string;
  protocolo?: BrowserProxyProtocol;
  usuario?: string | null;
  senha_configurada?: boolean;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
}

export interface BrowserProfileProxyPayload {
  proxy_id?: string | null;
  server?: string | null;
  username?: string | null;
  password_vault_key?: string | null;
}

export interface BrowserProfileInfo {
  perfil_id: string;
  nome: string;
  cor_hex: string;
  user_data_dir: string;
  cdp_porta?: number | null;
  proxy_url?: string | null;
  proxy?: BrowserProfileProxyPayload;
  agentes_count?: number;
  abas_count?: number;
  compartilhado?: boolean;
  criado_em?: string | null;
  ultimo_uso_em?: string | null;
}

export type BrowserTargetSelector =
  | { kind: "ref"; ref: string; revision?: number }
  | { kind: "role"; role: string; name?: string; exact?: boolean; nth?: number }
  | { kind: "text"; text: string; exact?: boolean; nth?: number }
  | { kind: "css"; selector: string; nth?: number }
  | { kind: "point"; x: number; y: number };

export interface BrowserSnapshotElement {
  ref: string;
  role: string;
  tag: string;
  name: string;
  value?: string;
  placeholder?: string;
  href?: string;
  checked?: boolean;
  disabled?: boolean;
  isSensitive?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface BrowserSnapshotResult {
  tabId: string;
  perfilId: string;
  url: string;
  title: string;
  revision: number;
  elements: BrowserSnapshotElement[];
  textSummary: string;
  truncated: boolean;
  imageDataUrl?: string | null;
}

export interface BrowserTabSummary {
  tabId: string;
  perfilId: string;
  agenteId: string | null;
  url: string;
  title: string;
  revision: number;
  userControl: boolean;
  screencastActive: boolean;
  lastActivityAt: string;
}

export interface BrowserStatusReport {
  available: boolean;
  executablePath: string | null;
  reason?: string | null;
  activeContexts: number;
  activeTabs: number;
  tabs: BrowserTabSummary[];
}

export type BrowserTakeoverReason =
  | "login"
  | "2fa"
  | "captcha"
  | "passkey"
  | "payment"
  | "sign-in-blocked"
  | "manual";

export interface BrowserTakeoverSession {
  takeoverId: string;
  tabId: string;
  perfilId?: string;
  agenteId: string | null;
  canalId?: string | null;
  reason: BrowserTakeoverReason;
  url: string;
  title: string;
  status: "pending" | "active" | "completed" | "cancelled";
  previewDataUrl?: string | null;
  criadoEm: string;
}

export interface BrowserSecretRequest {
  requestId: string;
  tabId: string;
  agenteId: string | null;
  canalId?: string | null;
  host: string;
  method: "password" | "otp" | "authenticator";
  targets: BrowserTargetSelector[];
  digits?: number;
  loginId?: string | null;
  username?: string | null;
  submission?: "enter" | "click" | "none";
  submitTarget?: BrowserTargetSelector | null;
}

export interface UserBrowsingStep {
  log_id: string;
  agente_id: string;
  kind: "page" | "click";
  host: string;
  path: string;
  title?: string | null;
  role?: string | null;
  name?: string | null;
  revisado: boolean;
  criado_em: number;
}

export interface ReadVideoResult {
  url: string;
  title: string;
  uploader?: string | null;
  webpage_url?: string | null;
  durationSeconds?: number | null;
  uploadDate?: string | null;
  viewCount?: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
  description?: string | null;
  transcript: Array<{ seconds: number; text: string }>;
  frames: string[];
  transcriptNote?: string;
  framesNote?: string;
}

export interface ReadImageResult {
  path: string;
  dataUrl: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  mimeType: string;
  bytes: number;
}

export interface CaptureScreenConsentRequest {
  captureId: string;
  agenteId: string;
  canalId: string;
  purpose: string;
  targetHint?: string | null;
  status: "pending" | "granted" | "declined" | "expired";
  criadoEm: string;
}
