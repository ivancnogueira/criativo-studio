# Criativo AI Studio Desktop (`@criativo/desktop`)

Aplicativo desktop instalável para **Windows (`.exe` NSIS)**, **macOS (`.dmg` universal)** e **Linux (`.AppImage`)**.

## Arquitetura de Segurança e Isolamento
1. **Zero Terminal na Máquina do Cliente:** Sobe o Daemon compilado (`apps/daemon/dist/server/daemon-server.js`) em processo filho oculto utilizando `ELECTRON_RUN_AS_NODE=1` do runtime embutido no Electron.
2. **Separação Física (`productRoot` vs `userDataRoot`):**
   - Os binários compilados (`app-product/`) ficam protegidos dentro dos recursos da instalação.
   - Os dados da marca, `.env`, `criativo.db`, artes, vídeos e servidores filhos locais ficam exclusivamente em:
     - Windows: `%APPDATA%/CriativoAIStudio`
     - macOS: `~/Library/Application Support/CriativoAIStudio`
     - Linux: `~/.config/CriativoAIStudio`
3. **Janela Segura:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` e bloqueio de navegação arbitrária para fora de `127.0.0.1:<porta>`.
4. **Operação 24/7 em Segundo Plano (*System Tray*):** Ao fechar a janela, o app permanece ativo na bandeja do sistema mantendo WhatsApp, rotinas e webhooks ligados.

## Como Gerar os Instaladores Nativos

1. Na raiz do repositório, compile o monorepo e o frontend web:
   ```bash
   npm run build
   npm run build --workspace=@criativo/web
   ```
2. Dentro de `apps/desktop` (requer conexão à internet na máquina de build para baixar binários do Electron):
   ```bash
   npm install
   npm run build
   npm run dist:win   # Gera CriativoAIStudio-Setup-<versao>.exe
   npm run dist:mac   # Gera CriativoAIStudio-<versao>-universal.dmg
   npm run dist:linux # Gera CriativoAIStudio-<versao>-x86_64.AppImage
   ```
