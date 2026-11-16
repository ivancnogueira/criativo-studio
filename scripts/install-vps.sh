#!/usr/bin/env bash
set -euo pipefail

# Instalador automatizado do Criativo AI Studio Online para Ubuntu 24.04 LTS / Debian
# Uso recomendado: sudo bash scripts/install-vps.sh

APP_USER="criativo"
APP_DIR="/opt/criativo-ai-studio-online"
DATA_DIR="/var/lib/criativo"
ENV_DIR="/etc/criativo"
ENV_FILE="$ENV_DIR/criativo.env"
SERVICE_DEST="/etc/systemd/system/criativo.service"
REPO_SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Erro: execute este instalador como root (ex.: sudo bash scripts/install-vps.sh)."
  exit 1
fi

echo "==> [1/6] Atualizando pacotes base do sistema (FFmpeg, Chromium, SQLite, Build Tools)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  git \
  gnupg \
  build-essential \
  ffmpeg \
  sqlite3 \
  chromium-browser || apt-get install -y --no-install-recommends chromium

echo "==> [2/6] Verificando/instalando Node.js 22 LTS..."
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 22 ]]; then
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi

echo "==> [3/6] Criando usuario de sistema sem privilegios ('$APP_USER') e diretorios..."
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
fi

mkdir -p "$APP_DIR" "$DATA_DIR" "$ENV_DIR" /run/criativo
chown -R "$APP_USER:$APP_USER" "$DATA_DIR" /run/criativo

echo "==> [4/6] Copiando e compilando Criativo AI Studio Online..."
cp -a "$REPO_SOURCE_DIR"/. "$APP_DIR"/
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

su -s /bin/bash "$APP_USER" -c "cd '$APP_DIR' && npm ci --omit=dev && npm run build && npm run build --workspace=apps/web"

echo "==> [5/6] Configurando Cofre Mestre e variaveis de ambiente..."
if [[ ! -f "$ENV_FILE" ]]; then
  MASTER_KEY="$(openssl rand -hex 32)"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
CRIATIVO_DB_PATH=/var/lib/criativo/criativo.db
CRIATIVO_SOCKET_PATH=/run/criativo/control.sock
CRIATIVO_VAULT_KEY=$MASTER_KEY
EOF
  chmod 600 "$ENV_FILE"
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
fi

echo "==> [6/6] Instalando CLI 'criativo' e servico systemd..."
install -m 0755 "$APP_DIR/scripts/criativo-cli.sh" /usr/local/bin/criativo
install -m 0644 "$APP_DIR/scripts/criativo.service" "$SERVICE_DEST"

systemctl daemon-reload
systemctl enable criativo.service
systemctl restart criativo.service

echo ""
echo "Instalacao concluida com sucesso!"
echo "- Cockpit Web: http://localhost:3000"
echo "- Status CLI:  criativo status"
echo "- Logs live:   criativo logs"
