import type {
  AgenteRegistro,
  StatusMensageria,
  WhatsAppContaResumo,
  WhatsAppContatoAutorizado,
  WhatsAppMetodoPareamento,
  WhatsAppPairingRequest,
} from "@criativo/contracts";
import {
  CarbonSelect,
} from "../../components/ui/CarbonControls";

export interface WhatsAppIntegrationPanelProps {
  accounts?: WhatsAppContaResumo[];
  activeAccountId?: string;
  onSelectAccount?: (contaId: string) => void;
  fallbackStatus?: StatusMensageria;
  fallbackQrCode?: string | null;
  agentes?: AgenteRegistro[];
  pairings?: WhatsAppPairingRequest[];
  contacts?: WhatsAppContatoAutorizado[];
  onRefreshAccounts?: () => Promise<void>;
  onConnect?: (opts?: { mode?: WhatsAppMetodoPareamento; phoneNumber?: string }) => Promise<void>;
  onDisconnect?: (limparSessao?: boolean) => Promise<void>;
}

export function statusBadgeMeta(status: StatusMensageria): { label: string; color: string } {
  if (status === "conectado") return { label: "Conectado", color: "#31CF76" };
  if (status === "aguardando_qrcode") return { label: "Aguardando leitura", color: "#FF9412" };
  return { label: "Desconectado", color: "#979797" };
}

/**
 * Painel completo multi-número do WhatsApp Baileys:
 * - Seletor multi-número (`CarbonSelect` + `Adicionar número`)
 * - Pareamento via `QR Code` ou `Código no telefone` (8 dígitos E.164)
 * - Política `Número dedicado` vs `Número próprio` + switches de aprovações/menção
 * - Aprovações de pareamento 6 chars, Contatos/Grupos autorizados (nota 9º dígito BR) e Agente Orquestrador
 */
