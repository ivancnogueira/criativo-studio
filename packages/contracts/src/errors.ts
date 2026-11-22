/**
 * Catálogo oficial de erros amigáveis (`CRV-*`) e logs estruturados redigidos (Fase 31 / G-05).
 */

export type CriativoErrorDomain =
  | "auth"
  | "meta"
  | "whatsapp"
  | "provider"
  | "vault"
  | "vps"
  | "browser"
  | "system";

export type CriativoErrorSeverity = "info" | "warning" | "error" | "critical";

export interface CriativoUserError {
  code: string;
  domain: CriativoErrorDomain;
  title: string;
  userMessage: string;
  suggestedAction: string;
  severity: CriativoErrorSeverity;
}

export interface CriativoMappedError extends CriativoUserError {
  traceId: string;
  rawSummary?: string;
}

export interface StructuredLogEntry {
  id: string;
  ts: string;
  level: "info" | "warn" | "error";
  domain: CriativoErrorDomain | string;
  code?: string;
  message: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

export const CRIATIVO_ERROR_CATALOG: Record<string, CriativoUserError> = {
  "CRV-AUTH-001": {
    code: "CRV-AUTH-001",
    domain: "auth",
    title: "Sessão ou Token de Acesso Inválido",
    userMessage: "A autenticação falhou ou sua sessão expirou neste servidor.",
    suggestedAction: "Reconecte a conta em Provedores/Integrações ou confira o token de acesso do servidor.",
    severity: "error",
  },
  "CRV-AUTH-002": {
    code: "CRV-AUTH-002",
    domain: "auth",
    title: "Origem ou Permissão Não Autorizada",
    userMessage: "A operação foi bloqueada por validação de origem ou política de acesso.",
    suggestedAction: "Execute a ação diretamente no Cockpit oficial autenticado ou verifique as permissões do agente.",
    severity: "critical",
  },
  "CRV-AUTH-003": {
    code: "CRV-AUTH-003",
    domain: "auth",
    title: "Fluxo OAuth Interrompido",
    userMessage: "O login OAuth não pôde ser concluído ou o código de confirmação expirou.",
    suggestedAction: "Inicie uma nova tentativa de autenticação e conclua o consentimento no navegador dentro da janela.",
    severity: "warning",
  },
  "CRV-META-001": {
    code: "CRV-META-001",
    domain: "meta",
    title: "Credenciais Instagram / Meta Ausentes",
    userMessage: "O Access Token ou Business Account ID do Instagram ainda não está salvo no Cofre.",
    suggestedAction: "Acesse Loja → Instagram / Meta e salve suas credenciais oficiais criptografadas no Cofre.",
    severity: "warning",
  },
  "CRV-META-002": {
    code: "CRV-META-002",
    domain: "meta",
    title: "Falha na Meta Graph API",
    userMessage: "A Meta Graph API recusou a solicitação por token expirado, escopo ausente ou erro temporário.",
    suggestedAction: "Valide a conexão em Loja → Instagram / Meta e confirme as permissões instagram_basic / instagram_manage_insights.",
    severity: "error",
  },
  "CRV-META-003": {
    code: "CRV-META-003",
    domain: "meta",
    title: "Publicação Meta Bloqueada ou Limitada",
    userMessage: "A publicação oficial no Instagram foi bloqueada por segurança (sem aprovação humana) ou atingiu limite da API.",
    suggestedAction: "Aprove explicitamente o criativo antes de publicar e verifique o formato/URL da mídia.",
    severity: "warning",
  },
  "CRV-WA-001": {
    code: "CRV-WA-001",
    domain: "whatsapp",
    title: "WhatsApp Desconectado ou QR Expirado",
    userMessage: "A sessão do WhatsApp precisa ser pareada novamente via QR Code ou código de pareamento.",
    suggestedAction: "Abra o modal WhatsApp no trilho lateral e escaneie o novo QR Code para reconectar.",
    severity: "warning",
  },
  "CRV-WA-002": {
    code: "CRV-WA-002",
    domain: "whatsapp",
    title: "Remetente WhatsApp Não Autorizado",
    userMessage: "A mensagem foi ignorada porque o contato ou grupo não está na lista de autorização do estúdio.",
    suggestedAction: "Autorize o contato ou grupo nas configurações do WhatsApp caso queira permitir comandos por lá.",
    severity: "info",
  },
  "CRV-PROV-001": {
    code: "CRV-PROV-001",
    domain: "provider",
    title: "Provedor de IA Desconectado ou Sem Chave",
    userMessage: "O provedor selecionado não possui CLI autenticada nem API Key configurada no Cofre.",
    suggestedAction: "Conecte o provedor em Configurações / Integrações ou selecione outro modelo conectado.",
    severity: "error",
  },
  "CRV-PROV-002": {
    code: "CRV-PROV-002",
    domain: "provider",
    title: "Limite de Cota ou Rate Limit Atingido",
    userMessage: "A conta atual do provedor atingiu o limite temporário de requisições ou janela de uso.",
    suggestedAction: "Configure Modelos Reserva automáticos ou aguarde a renovação da janela de cota.",
    severity: "warning",
  },
  "CRV-PROV-003": {
    code: "CRV-PROV-003",
    domain: "provider",
    title: "Provedor Indisponível ou Timeout",
    userMessage: "O modelo de IA ou runtime local (CLI / Ollama / LM Studio) demorou para responder ou está offline.",
    suggestedAction: "Verifique sua conexão, o daemon local do provedor ou tente reenviar com um modelo alternativo.",
    severity: "error",
  },
  "CRV-VAULT-001": {
    code: "CRV-VAULT-001",
    domain: "vault",
    title: "Chave Mestra do Cofre Ausente em Produção",
    userMessage: "O daemon em produção exige CRIATIVO_VAULT_KEY configurada para proteger o Cofre AES-256-GCM.",
    suggestedAction: "Defina CRIATIVO_VAULT_KEY no arquivo .env (Docker/VPS) ou inicie via aplicativo Desktop oficial.",
    severity: "critical",
  },
  "CRV-VAULT-002": {
    code: "CRV-VAULT-002",
    domain: "vault",
    title: "Falha ao Decifrar Segredo do Cofre",
    userMessage: "Não foi possível decifrar uma credencial salva no Cofre SQLite (chave mestra alterada ou dado inválido).",
    suggestedAction: "Restaure a mesma CRIATIVO_VAULT_KEY original ou salve novamente as chaves de API em Integrações.",
    severity: "error",
  },
  "CRV-VPS-001": {
    code: "CRV-VPS-001",
    domain: "vps",
    title: "Token de Pareamento / Claim Inválido",
    userMessage: "O ticket CRIATIVO_CLAIM ou token de pareamento remoto expirou ou já foi consumido.",
    suggestedAction: "Gere um novo comando de conexão em Servidores → Conectar Servidor VPS.",
    severity: "warning",
  },
  "CRV-VPS-002": {
    code: "CRV-VPS-002",
    domain: "vps",
    title: "Servidor Remoto Inacessível",
    userMessage: "Não foi possível alcançar o endpoint do servidor VPS na rede.",
    suggestedAction: "Confirme se o serviço daemon está ativo na VPS e se a porta/firewall permite acesso.",
    severity: "error",
  },
  "CRV-BROWSER-001": {
    code: "CRV-BROWSER-001",
    domain: "browser",
    title: "Intervenção Humana Necessária no Navegador",
    userMessage: "A página exibiu uma verificação anti-bot, CAPTCHA, 2FA ou tela de login.",
    suggestedAction: "Assuma o navegador pelo modal/janela de takeover ou PiP para concluir a verificação manualmente.",
    severity: "warning",
  },
  "CRV-SYS-500": {
    code: "CRV-SYS-500",
    domain: "system",
    title: "Erro Interno Inesperado",
    userMessage: "Ocorreu uma falha inesperada ao processar a solicitação no estúdio.",
    suggestedAction: "Consulte os logs redigidos em Configurações → Diagnóstico usando o Trace ID.",
    severity: "error",
  },
};

export function listCriativoErrorCatalog(): CriativoUserError[] {
  return Object.values(CRIATIVO_ERROR_CATALOG);
}

export function getCriativoErrorByCode(code: string): CriativoUserError | null {
  const key = code.trim().toUpperCase();
  return CRIATIVO_ERROR_CATALOG[key] ?? null;
}
