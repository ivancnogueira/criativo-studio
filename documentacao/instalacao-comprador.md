# Instalação do Comprador — Criativo AI Studio Online (Local & VPS)

## 1. Instalação Local (Windows, macOS ou Linux)

**Pré-requisitos:** Node.js 22+ instalado.

```bash
npm install
npm run configurar
npm run build
npm run build --workspace=apps/web
npm run start:daemon
```

O comando `npm run configurar` prepara:
- Arquivo `.env` local com chave mestra aleatória `CRIATIVO_VAULT_KEY`;
- Pastas locais da marca (`conteudos/`, `recursos/fotos/`, `recursos/logos/`, `recursos/referencias/`, `recursos/brand/`, `saidas/`) preenchidas com templates agnósticos;
- Instalação das **9 skills base** em `.agents/skills/` e `~/.gemini/config/skills/`.

Acesse o Cockpit em `http://127.0.0.1:3000`.

---

## 2. Instalação em VPS (Ubuntu 24.04 LTS)

```bash
sudo bash scripts/install-vps.sh
```

Comandos úteis na VPS via CLI:
- `criativo status` — saúde do serviço e fila
- `criativo diagnosticar` — checagem de skills, upgrades e banco SQLite
- `criativo validar` — valida a integração Meta/Instagram sem expor segredos
- `criativo upgrade bonus` / `criativo upgrade video` — instala pacotes de upgrade em etapas

---

## 3. Upgrades Modulares (Entregues em Etapas)

A instalação inicial traz o **Pacote Base (9 Agentes Especialistas)**. Quando você adquirir os módulos adicionais:
- **Pacote Agentes Bônus:** `npm run instalar-upgrade -- --pacote bonus --fonte <caminho_ou_url_git>`
- **Pacote Criativo Video Studio:** `npm run instalar-upgrade -- --pacote video --fonte <caminho_ou_url_git>`

Ou instale diretamente pela interface em **Conexões → Habilidades (Skills) → Pacotes de Upgrade**.
