#!/usr/bin/env bash
set -euo pipefail

# Instalador automatizado do CriativoOS para Ubuntu 24.04 LTS / Debian
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

safe_apt_update() {
  apt-get -o Acquire::AllowReleaseInfoChange=true -o Acquire::AllowReleaseInfoChange::Label=true update -y \
    || apt-get --allow-releaseinfo-change update -y \
    || true
}

echo "==> [1/6] Atualizando pacotes base do sistema (FFmpeg, Chromium, SQLite, Build Tools)..."
export DEBIAN_FRONTEND=noninteractive
safe_apt_update
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
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get -o Dir::Etc::sourcelist="sources.list.d/nodesource.list" -o Dir::Etc::sourceparts="-" -o APT::Get::List-Cleanup="0" update -y || safe_apt_update
  apt-get install -y nodejs
fi

echo "==> [3/6] Criando usuario de sistema sem privilegios ('$APP_USER') e diretorios..."
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
fi

mkdir -p "$APP_DIR" "$DATA_DIR" "$ENV_DIR" /run/criativo
chown -R "$APP_USER:$APP_USER" "$DATA_DIR" /run/criativo

echo "==> [4/6] Copiando e compilando CriativoOS..."
cp -a "$REPO_SOURCE_DIR"/. "$APP_DIR"/
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

su -s /bin/bash "$APP_USER" -c "cd '$APP_DIR' && npm ci --omit=dev && npm run build && npm run build --workspace=apps/web && node scripts/configurar-local.mjs"

# Pré-instala em best-effort o binário standalone oficial do Antigravity CLI para descoberta real de modelos via ACP
(
  ARCH_RAW="$(uname -m)"
  if [[ "$ARCH_RAW" == "aarch64" || "$ARCH_RAW" == "arm64" ]]; then
    AGY_ARCH="linux-arm64"
    AGY_CDN_ARCH="arm64"
    AGY_ASSET="agy_cli_linux_arm64.tar.gz"
  else
    AGY_ARCH="linux-x64"
    AGY_CDN_ARCH="amd64"
    AGY_ASSET="agy_cli_linux_x64.tar.gz"
  fi
  AGY_HOME="/home/${APP_USER}/.config"
  AGY_VER="$(curl -fsSL https://api.github.com/repos/google-antigravity/antigravity-cli/releases/latest 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(String(j.tag_name||'').replace(/^v/i,''))}catch{}})" || true)"
  AGY_TMP="$(mktemp -d /tmp/criativo-agy-XXXXXX)"
  AGY_BIN=""
  if curl -fsSL "https://github.com/google-antigravity/antigravity-cli/releases/latest/download/${AGY_ASSET}" -o "${AGY_TMP}/agy.tar.gz" 2>/dev/null; then
    tar -xzf "${AGY_TMP}/agy.tar.gz" -C "${AGY_TMP}" 2>/dev/null || true
    AGY_BIN="$(find "${AGY_TMP}" -type f \( -name "antigravity" -o -name "agy" \) | head -n 1 || true)"
  fi
  if [[ -z "$AGY_BIN" || ! -s "$AGY_BIN" ]]; then
    MANIFEST_JSON="$(curl -fsSL "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/linux_${AGY_CDN_ARCH}.json" 2>/dev/null || true)"
    CDN_URL="$(printf '%s' "$MANIFEST_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).url||'')}catch{}})" || true)"
    CDN_VER="$(printf '%s' "$MANIFEST_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(String(JSON.parse(d).version||'').replace(/^v/i,''))}catch{}})" || true)"
    if [[ -n "$CDN_URL" ]] && curl -fsSL "$CDN_URL" -o "${AGY_TMP}/agy-cdn.tar.gz" 2>/dev/null; then
      mkdir -p "${AGY_TMP}/cdn-out"
      tar -xzf "${AGY_TMP}/agy-cdn.tar.gz" -C "${AGY_TMP}/cdn-out" 2>/dev/null || true
      AGY_BIN="$(find "${AGY_TMP}/cdn-out" -type f \( -name "antigravity" -o -name "agy" \) | head -n 1 || true)"
      if [[ -n "$CDN_VER" ]]; then AGY_VER="$CDN_VER"; fi
    fi
  fi
  AGY_VER="${AGY_VER:-latest}"
  AGY_DEST="${AGY_HOME}/CriativoStudio/provider-runtimes/antigravity/${AGY_ARCH}/${AGY_VER}/bin"
  if [[ -n "$AGY_BIN" && -s "$AGY_BIN" ]]; then
    mkdir -p "$AGY_DEST"
    cp "$AGY_BIN" "${AGY_DEST}/antigravity"
    chmod +x "${AGY_DEST}/antigravity"
    chown -R "$APP_USER:$APP_USER" "${AGY_HOME}/CriativoStudio"
  fi
  rm -rf "$AGY_TMP"
) || true

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
