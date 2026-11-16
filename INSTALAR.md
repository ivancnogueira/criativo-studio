# Instalação do Criativo AI Studio Online

O **Criativo AI Studio Online** reúne um **Daemon + Cockpit Web 24/7 (`http://127.0.0.1:3000`)** com 9 agentes base no pacote inicial (e upgrades modulares opcionais em etapas) que também se integram diretamente ao seu agente de código: **Antigravity**, **Claude Code** ou **Codex**. Você instala uma vez e passa a operar tanto pelo Cockpit Web / WhatsApp quanto pelos comandos de barra (`/planejar-conteudo`, `/criar-carrossel`, `/criar-post-individual`, `/configurar-instagram`, etc.).

## Pré-requisitos

- **Node.js 22 ou superior** — [baixar LTS](https://nodejs.org). Confira com `node --version`.
- **Um agente de código** (Antigravity, Claude Code ou Codex/GPT) ou terminal local/VPS.
- **Git** — [baixar](https://git-scm.com), caso faça instalação por clone do repositório.

## Como você recebeu o produto?

| Forma | Quando usar |
|---|---|
| **ZIP** | Você baixou um arquivo da área de membros. É o caminho mais simples e não precisa de conta no GitHub nem de Git. |
| **Clone (GitHub)** | Você tem acesso ao repositório privado `criativo-studio` no GitHub e Git instalado. Recebe atualizações com `npm run atualizar` (`git pull`). |

Nos dois casos o agente conduz tudo passo a passo. Abra o seu agente e cole o prompt do guia correspondente:

| Seu agente | Prompts prontos (A: ZIP, B: Clone GitHub) |
|---|---|
| Antigravity | [INSTALAR-COM-ANTIGRAVITY.md](INSTALAR-COM-ANTIGRAVITY.md) |
| Claude Code | [INSTALAR-COM-CLAUDE.md](INSTALAR-COM-CLAUDE.md) |
| Codex (GPT) | [INSTALAR-COM-CODEX.md](INSTALAR-COM-CODEX.md) |

O agente instala as dependências, prepara as pastas da marca e o `.env` com chave mestra do Cofre, compila o Daemon e o Cockpit Web, instala as **9 skills base** na sua plataforma e conduz os **4 Marcos da Instalação** (Instalação, Perfil da Marca, Identidade Visual & Referências, IA & Credenciais Meta), encerrando com tudo pronto para você criar direto no **Cockpit Web (`http://127.0.0.1:3000`)**.

**Importante:** os comandos de barra e o Cockpit Web ficam vinculados à pasta onde você instalou o sistema. Escolha uma pasta definitiva antes de rodar `npm run instalar`. Se mover a pasta depois, rode `npm run instalar` novamente no novo local.

---

## Instalação manual (Local)

Com o ZIP extraído em uma pasta definitiva, ou após clonar pelo GitHub:

```bash
git clone https://github.com/ivancnogueira/criativo-studio.git criativo-studio-online
cd criativo-studio-online
npm install
npm run instalar
```

Para instalar as skills especificamente para uma plataforma (ou para todas de uma vez):

```bash
npm run instalar -- --plataforma antigravity
# ou: claude | codex | todas
```

O comando `npm run instalar` (alias de `npm run configurar`):
1. Valida o **Node.js 22+**;
2. Cria as pastas locais da instância (`conteudos/`, `recursos/fotos/`, `recursos/logos/`, `recursos/referencias/`, `recursos/brand/`, `saidas/`, `previas/`, `apps/daemon/dados/`) copiando os templates agnósticos apenas quando ausentes;
3. Cria o arquivo `.env` local (se não existir) com chave mestra `CRIATIVO_VAULT_KEY` aleatória para o Cofre AES-256-GCM;
4. Sincroniza as skills instaladas para as pastas globais da(s) plataforma(s) escolhida(s);
5. Compila `apps/daemon` e `apps/web`.

Em seguida, inicie o estúdio:

```bash
npm start
```

Acesse **`http://127.0.0.1:3000`** no navegador e rode `npm run diagnosticar` sempre que quiser conferir a saúde da instalação.

---

## Instalação em VPS (Ubuntu 24.04 LTS)

Veja os detalhes completos em [documentacao/instalacao-comprador.md](documentacao/instalacao-comprador.md):

```bash
sudo bash scripts/install-vps.sh
```

---

## Upgrades em etapas (Agentes Bônus & Criativo Video Studio)

A instalação inicial entrega exclusivamente o **Pacote Base (9 Agentes Especialistas)**. Os módulos adicionais adquiridos são instalados separadamente quando você quiser:

```bash
# Pacote Agentes Bônus (+3 skills: Entregáveis, Engenharia Reversa, Consistência de Personagem)
npm run instalar-upgrade -- --pacote bonus --fonte <caminho-ou-url-git>

# Pacote Criativo Video Studio (+3 skills: Reels Remotion, Roteirista Faceless, Roteirista Talking Head)
npm run instalar-upgrade -- --pacote video --fonte <caminho-ou-url-git>
```

Também é possível ativar pela UI em **Conexões → Habilidades (Skills) → Pacotes de Upgrade**.

---

## Atualizar uma instalação existente

`npm run atualizar` atualiza apenas os arquivos do produto (código do Daemon, Cockpit Web, scripts, skills base e documentação) e **nunca toca nos seus dados**: `.env`, `apps/daemon/dados/` (SQLite + Cofre + histórico), `conteudos/`, `recursos/`, `saidas/`, `previas/`, `logs/`, `video/` e skills de upgrade instaladas.

- **Clone (GitHub):** `npm run atualizar` (executa `git pull --ff-only` somente se nenhum arquivo rastreado do produto tiver alterações locais, recompila e resincroniza as skills).
- **ZIP:** baixe o novo ZIP e rode `npm run atualizar -- --simular --zip caminho/do/arquivo.zip` para revisar as mudanças e depois rode o mesmo comando sem `--simular`. **Nunca** extraia um ZIP novo manualmente por cima da sua pasta instalada.

Os guias `INSTALAR-COM-*.md` incluem um prompt pronto para pedir ao seu agente que faça a atualização com segurança.

---

## Configurar IA, Meta/Instagram e WhatsApp

- **IA (LLM e Imagem):** no Cockpit Web (`http://127.0.0.1:3000` → **Conexões**) você pode conectar o OpenCode gratuito, entrar via OAuth no navegador ou salvar suas chaves no Cofre criptografado AES-256-GCM (Gemini, Claude, OpenAI, Grok, Flux).
- **Instagram (Meta Graph API):** siga [documentacao/configurar-meta.md](documentacao/configurar-meta.md), salve o token e o `META_IG_USER_ID` no Cofre (pela UI em Conexões ou no `.env` local) e confira com:

```bash
npm run validar:integracoes
```

> Nunca cole senhas, chaves de API ou tokens no chat. Use `npm run diagnosticar` e `npm run validar:integracoes` para inspecionar o status sem expor segredos.

---

## Problemas comuns?

```bash
npm run diagnosticar
npm run validar:integracoes
```

Confira também se o Node.js é `22+` (`node --version`), se `npm install` foi executado na raiz e se o Cockpit Web está respondendo em `http://127.0.0.1:3000`.
