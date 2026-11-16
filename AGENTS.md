# Criativo AI Studio Online — instruções para o agente

Este repositório implementa o **Criativo AI Studio Online**, uma plataforma autônoma multi-agente para planejamento editorial, copywriting, design de posts/carrosséis/anúncios/stories, análise de métricas e publicação oficial no Instagram (com upgrades modulares em etapas para Entregáveis/Consistência e Vídeos Remotion). Converse sempre com o usuário em português do Brasil.

## Estrutura

- `produto.json` e `package.json` — metadados e scripts principais do produto.
- `.agents/skills/` — skills empacotadas do produto. O **Pacote Base (9 skills)** vem no produto inicial:
  - `planejar-conteudo`, `copywriter-instagram`, `criar-post-individual`, `criar-carrossel`, `criar-post-anuncio`, `gerar-stories`, `criar-identidade-visual`, `configurar-instagram`, `analise-metricas`.
  - Upgrades opcionais (`bonus`: 3 skills; `video`: 3 skills) são entregues em etapas via `npm run instalar-upgrade` e ignorados no Git do produto.
- `templates/marca/` — templates agnósticos com placeholders (`perfil-da-marca.md`, `identidade-visual.yml`, `estado-do-studio.yml`, `brandbook.md`, `design-system.md`, `tokens.css`), copiados na instalação para `conteudos/` e `recursos/brand/` quando ainda não existem.
- `conteudos/` — dados operacionais da marca da instância (`perfil-da-marca.md`, `identidade-visual.yml`, `estado-do-studio.yml`, `relatorios/`).
- `recursos/` — fotos reais (`fotos/`), logo (`logos/`), referências visuais (`referencias/`), personagens (`personagens/`), uploads e documentos de marca (`brand/`).
- `saidas/` e `previas/` — artes finais, carrosséis, stories e vitrines locais geradas durante a operação.
- `.env` — variáveis locais e chave mestra `CRIATIVO_VAULT_KEY` do Cofre AES-256-GCM. **Nunca** abra, exiba ou peça o conteúdo de `.env` nem chaves/tokens no chat; use `npm run diagnosticar` e `npm run validar:integracoes`.
- `apps/daemon/` — Daemon Node 22 (`SQLite WAL` + Cofre `AES-256-GCM` em `apps/daemon/dados/criativo.db`, Fila FIFO, Runner multi-provedor, `HandoffBus`, bridge WhatsApp/Telegram e rotas `/api/*`).
- `apps/web/` — Cockpit Web React + Vite servido pelo Daemon em `http://127.0.0.1:3000`.
- `scripts/` — instalador multi-plataforma (`configurar-local.mjs`, `instalar-skills.mjs`, `lib/plataformas.mjs`), upgrades (`instalar-upgrade.mjs`), atualização (`atualizar.mjs`), validação (`validar-integracoes.mjs`), diagnóstico (`diagnosticar.mjs`) e setup VPS (`install-vps.sh`).
- `documentacao/` — guias operacionais (`instalacao-comprador.md`, `onboarding-guiado.md`, `configurar-meta.md`).
- `INSTALAR.md`, `INSTALAR-COM-ANTIGRAVITY.md`, `INSTALAR-COM-CLAUDE.md` e `INSTALAR-COM-CODEX.md` — guias de instalação e atualização guiados por plataforma.

## Produto e instância

Esta pasta pode representar o **produto** (template genérico distribuído para compradores) ou uma **instância** (cópia instalada na máquina ou VPS de um cliente). Considera-se instância quando existe `.env`, `apps/daemon/dados/criativo.db` ou arquivos preenchidos em `conteudos/` e `recursos/`.

- **Regra Anti-Contaminação no produto:** nunca grave nomes reais de clientes, `@handles` reais, tokens, bancos `.db`, fotos/logos reais ou conteúdos específicos nos arquivos rastreados pelo Git. Use sempre placeholders (`[NOME_DA_MARCA]`, `[@SEU_PERFIL]`, `[A PREENCHER]`).
- **Atualização segura de instância:** rode `npm run atualizar` (clone Git) ou `npm run atualizar -- --simular --zip <arquivo.zip>` e depois sem `--simular`. Isso atualiza apenas arquivos do produto preservando `.env`, `apps/daemon/dados/`, `conteudos/`, `recursos/`, `saidas/`, `previas/`, `logs/`, `video/` e skills de upgrade. Nunca extraia um ZIP novo sobrescrevendo arquivos manualmente.

## Comandos operacionais

| Comando | O que faz |
|---|---|
| `npm install` | Instala as dependências do monorepo (Node.js >= 22) |
| `npm run instalar` | Alias de `configurar`: prepara pastas, templates, `.env`, build inicial e instala skills na(s) plataforma(s) detectada(s) |
| `npm run instalar -- --plataforma <claude\|codex\|antigravity\|todas>` | Instala as skills especificamente para a plataforma escolhida |
| `npm run instalar-skills -- --plataforma <...>` | Sincroniza apenas as skills nas pastas globais (`~/.claude/skills`, `~/.codex/skills`, `~/.gemini/config/skills`) |
| `npm run desinstalar-skills` | Remove apenas as skills marcadas por este produto nas pastas globais |
| `npm run diagnosticar` | Verifica Node, `.env`, builds, 9 skills base, upgrades instalados, SQLite e estado do Cofre Meta |
| `npm run validar:integracoes` | Valida as credenciais Meta API do Cofre/`.env` via Graph API v21.0 sem expor segredos |
| `npm run instalar-upgrade -- --pacote <bonus\|video> --fonte <caminho_ou_git>` | Instala módulos opcionais de upgrade em etapas (`bonus` ou `video`) |
| `npm run atualizar` | Atualiza o produto preservando os dados da instância e resincroniza builds e skills |
| `npm start` | Inicia o Daemon + Cockpit Web integrado em `http://127.0.0.1:3000` |
| `npm run build` | Compila os workspaces `packages/contracts`, `packages/whatsapp` e `apps/daemon` |
| `npm run test:daemon` | Executa a suíte de testes do Daemon (`apps/daemon/tests/*.test.ts`) |

## Fluxo de operação e onboarding guiado

Quando o usuário pedir para instalar, configurar ou fazer o primeiro uso:
1. Siga o roteiro em `documentacao/onboarding-guiado.md` (6 Marcos contínuos), sempre informando o marco atual, o progresso e o resultado verificado.
2. **Marco 1 (Instalação):** valide Node.js >= 22 (`node --version`), rode `npm install` (se faltar `node_modules`) e `npm run instalar -- --plataforma <plataforma>`, depois `npm run diagnosticar` e `npm start` (ou deixe pronto para abrir `http://127.0.0.1:3000`).
3. **Marco 2 e 3 (Marca & Identidade Visual):** colete ou oriente o preenchimento dos arquivos em `conteudos/` e `recursos/` (via Cockpit Web `/api/marca/identidade` ou ferramentas `atualizar_memorias_marca` / `ler_memorias_marca`) sem expor ou commitar dados reais no produto.
4. **Marco 4 (IA & Meta API):** o provedor de IA (OpenCode gratuito, OAuth no navegador ou API Key BYOK) e os tokens da Meta (`META_ACCESS_TOKEN`, `META_IG_USER_ID`) ficam cifrados no Cofre SQLite (`POST /api/conectores/:id/configurar` ou UI em **Conexões**). Nunca peça chaves secretas no chat; use `documentacao/configurar-meta.md` como guia e confira com `npm run validar:integracoes` ou pela ferramenta `validar_integracao_meta`.
5. **Marcos 5 e 6 (Primeiro Criativo & Publicação):** use as skills base para gerar roteiro/copy/arte, envie para revisão na Vitrine Mobile do Cockpit (`http://127.0.0.1:3000`) e **jamais publique automaticamente** sem aprovação humana explícita (`approved_by_human === true` pelo Cockpit ou resposta `1` no WhatsApp / confirmação `PUBLICAR`).

## Colaboração multi-agente e upgrades

- Os agentes do Cockpit colaboram em **Canais em Equipe** (encadeando contribuições de todos os membros na resposta) e em **Handoff 1:1** via `@agente_id` ou marcador `[HANDOFF:agente_id]` gerenciados pelo `HandoffBus`.
- Nunca prometa ferramentas ou skills dos pacotes **`bonus`** ou **`video`** se `npm run diagnosticar` mostrar que o pacote correspondente ainda não foi instalado; caso o usuário queira ativá-los, oriente usar `npm run instalar-upgrade -- --pacote <bonus|video> --fonte <...>`.
