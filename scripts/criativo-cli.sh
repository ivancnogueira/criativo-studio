#!/usr/bin/env bash
set -euo pipefail

SOCKET_PATH="${CRIATIVO_SOCKET_PATH:-/run/criativo/control.sock}"
if [[ ! -S "$SOCKET_PATH" && -S "/tmp/criativo-control.sock" ]]; then
  SOCKET_PATH="/tmp/criativo-control.sock"
fi

INDIGO="\033[0;36m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

call_socket() {
  local method="$1"
  local route="$2"
  if [[ ! -S "$SOCKET_PATH" ]]; then
    echo -e "${RED}Erro: socket de controle não encontrado em $SOCKET_PATH.${RESET}"
    echo "Verifique se o daemon está rodando: systemctl status criativo.service"
    exit 1
  fi
  curl -fsS --unix-socket "$SOCKET_PATH" -X "$method" "http://localhost${route}"
}

cmd="${1:-help}"

case "$cmd" in
  status)
    echo -e "${INDIGO}=== Criativo AI Studio Online — Status do Sistema ===${RESET}"
    json="$(call_socket GET /status)"
    node -e '
      const d = JSON.parse(process.argv[1]);
      console.log(`Status:           ${d.status}`);
      console.log(`Versão:           v${d.version}`);
      console.log(`Uptime:           ${d.uptime_sec}s`);
      console.log(`CPU Load (1m):    ${d.cpu_load_1m}`);
      console.log(`Memória RSS:      ${d.memoria_rss_mb} MB`);
      console.log(`Agentes Ativos:   ${d.agentes_ativos}/15`);
      console.log(`Fila Pendente:    ${d.tarefas_pendentes}`);
      console.log(`Executando Agora: ${d.tarefas_executando}`);
      console.log(`WhatsApp:         ${d.whatsapp?.status ?? "desconectado"}`);
    ' "$json"
    ;;
  fila)
    echo -e "${INDIGO}=== Fila FIFO de Tarefas Criativas ===${RESET}"
    json="$(call_socket GET /queue)"
    node -e '
      const d = JSON.parse(process.argv[1]);
      if (!d.tarefas || d.tarefas.length === 0) {
        console.log("Nenhuma tarefa registrada na fila.");
      } else {
        console.table(d.tarefas.map(t => ({
          ID: t.tarefa_id.slice(0, 8),
          Prioridade: t.prioridade,
          Status: t.status,
          Tipo: t.tipo,
          Canal: t.canal_origem,
          Agente: t.agente_id || "-",
          Titulo: t.titulo.slice(0, 40)
        })));
      }
    ' "$json"
    ;;
  whatsapp)
    echo -e "${GREEN}=== Status da Conexão WhatsApp (Baileys) ===${RESET}"
    call_socket GET /whatsapp-status
    echo ""
    ;;
  logs)
    echo -e "${YELLOW}Abrindo logs em tempo real (Ctrl+C para sair)...${RESET}"
    journalctl -u criativo.service -f -n 100
    ;;
  reiniciar)
    echo -e "${YELLOW}Solicitando reinicialização graciosa do Daemon...${RESET}"
    if systemctl is-active --quiet criativo.service 2>/dev/null; then
      sudo systemctl restart criativo.service
    else
      call_socket POST /restart
      echo ""
    fi
    ;;
  *)
    echo -e "${INDIGO}Criativo AI Studio CLI${RESET}"
    echo "Uso: criativo <comando>"
    echo ""
    echo "Comandos disponíveis:"
    echo "  status     Exibe uptime, CPU, memória, fila e status WhatsApp"
    echo "  fila       Lista tarefas na fila FIFO"
    echo "  whatsapp   Consulta estado da conexão WhatsApp"
    echo "  logs       Exibe logs ao vivo do serviço systemd"
    echo "  reiniciar  Reinicia o daemon com segurança"
    ;;
esac
