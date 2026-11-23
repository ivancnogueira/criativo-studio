# Instalação do Comprador — CriativoOS (Local & VPS)

> **Instalação guiada pelo seu agente de código:** consulte [INSTALAR.md](../INSTALAR.md) para prompts prontos para **Antigravity**, **Claude Code** e **Codex (GPT)**.

## 1. Instalação Local (Windows, macOS ou Linux)

**Pré-requisitos:** Node.js 22+ instalado.

```bash
npm install
npm run instalar -- --plataforma todas   # ou antigravity | claude | codex
npm run start
```

O comando `npm run instalar` (alias de `npm run configurar`) prepara:
- Arquivo `.env` local com chave mestra aleatória `CRIATIVO_VAULT_KEY`;
- Pastas locais da marca (`conteudos/`, `recursos/fotos/`, `recursos/logos/`, `recursos/referencias/`, `recursos/brand/`, `saidas/`, `previas/`) preenchidas com templates agnósticos;
- Sincronização das **9 skills base** em `.agents/skills/` e nas pastas globais das plataformas selecionadas (`~/.gemini/config/skills`, `~/.claude/skills`, `~/.codex/skills`);
- Build inicial do Daemon e Cockpit Web (`apps/daemon` e `apps/web`).

Acesse o Cockpit em `http://127.0.0.1:3000`.

### Atualização segura da instância
```bash
# Via clone Git:
npm run atualizar

# Via ZIP baixado (simule antes):
npm run atualizar -- --simular --zip caminho/do/pacote.zip
npm run atualizar -- --zip caminho/do/pacote.zip
```
O atualizador preserva `.env`, `apps/daemon/dados/`, `conteudos/`, `recursos/`, `saidas/`, `previas/` e upgrades instalados.

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
