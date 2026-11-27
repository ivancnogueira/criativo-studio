# CriativoOS — instruções para o agente

Este repositório implementa o **CriativoOS**, uma plataforma autônoma multi-agente para planejamento editorial, copywriting, design de posts/carrosséis/anúncios/stories, análise de métricas e publicação oficial no Instagram (com upgrades modulares em etapas para Entregáveis/Consistência e Vídeos Remotion). Converse sempre com o usuário em português do Brasil.

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
| `npm run validar:integracoes` | Valida as credenciais Meta API do Cofre/`.env` via Graph API v27.0 sem expor segredos |
| `npm run instalar-upgrade -- --pacote <bonus\|video> --fonte <caminho_ou_git>` | Instala módulos opcionais de upgrade em etapas (`bonus` ou `video`) |
| `npm run atualizar` | Atualiza o produto preservando os dados da instância e resincroniza builds e skills |
| `npm start` | Inicia o Daemon + Cockpit Web integrado em `http://127.0.0.1:3000` |
| `npm run build` | Compila os workspaces `packages/contracts`, `packages/whatsapp` e `apps/daemon` |
| `npm run test:daemon` | Executa a suíte de testes do Daemon (`apps/daemon/tests/*.test.ts`) |

## Fluxo de operação e onboarding guiado (4 Marcos)

Quando o usuário pedir para instalar, configurar ou fazer o setup inicial:
1. Siga o roteiro enxuto de **4 Marcos** em `documentacao/onboarding-guiado.md`, sempre informando o marco atual, o progresso e o resultado verificado — encerrando a instalação no Marco 4 e entregando o uso diário para o **Cockpit Web (`http://127.0.0.1:3000`)**.
2. **Marco 1 (Instalação):** valide Node.js >= 22 (`node --version`), rode `npm install` (se faltar `node_modules`) e `npm run instalar -- --plataforma <plataforma>`, depois `npm run diagnosticar` e inicie/prepare `npm start`.
3. **Marco 2 (Perfil da Marca):** registre posicionamento, nicho, ofertas, público e tom de voz em `conteudos/perfil-da-marca.md` e via `/api/marca/identidade`.
4. **Marco 3 (Identidade Visual & Referências):** gere/atualize `identidade-visual.yml`, `brandbook.md`, `design-system.md` e `tokens.css` e **peça explicitamente para o usuário colocar ou anexar suas referências visuais em `recursos/referencias/`, fotos em `recursos/fotos/` e logo em `recursos/logos/`** (ou enviar na aba **Arquivos** do Cockpit) antes de avançar.
5. **Marco 4 (IA & Credenciais Meta — Fim da Instalação):** oriente o usuário a conectar seu provedor de IA e credenciais Meta no **Cockpit Web (`http://127.0.0.1:3000` → Conexões)** ou `.env` local seguindo `documentacao/configurar-meta.md` (jamais peça tokens no chat), confira com `npm run validar:integracoes`, confirme que o Cockpit está ativo em `http://127.0.0.1:3000` e encerre entregando a operação para os agentes no Cockpit.

## Como os agentes aprendem no Cockpit

- Todos os agentes no Cockpit Web carregam automaticamente `conteudos/perfil-da-marca.md`, `conteudos/identidade-visual.yml`, `recursos/brand/brandbook.md`, `recursos/brand/design-system.md`, os arquivos escaneados de `recursos/referencias/`, `recursos/fotos/` e `recursos/logos/` e as memórias individuais salvas no SQLite.
- A aba **Arquivos** do Cockpit (`GET /api/arquivos`) sincroniza automaticamente as mídias colocadas nessas pastas.

## Colaboração multi-agente e upgrades

- Os agentes do Cockpit colaboram em **Canais em Equipe** (encadeando contribuições de todos os membros na resposta) e em **Handoff 1:1** via `@agente_id` ou marcador `[HANDOFF:agente_id]` gerenciados pelo `HandoffBus`.
- Nunca prometa ferramentas ou skills dos pacotes **`bonus`** ou **`video`** se `npm run diagnosticar` mostrar que o pacote correspondente ainda não foi instalado; caso o usuário queira ativá-los, oriente usar `npm run instalar-upgrade -- --pacote <bonus|video> --fonte <...>`.

## Contratos de Arquitetura, Modularização e Qualidade

Para manter a base de código sustentável durante refatorações e novas fases (`31`–`37`+):

1. **Orçamento de Tamanho por Arquivo (`.ts` / `.tsx` / `.js` / `.mjs`):**
   - **Alvo ideal:** até **`500` linhas** para novos arquivos e módulos extraídos.
   - **Teto rígido (bloqueante):** **`750` linhas** para qualquer arquivo novo ou já modularizado. Arquivos legados registrados em `scripts/file-size-baseline.json` operam sob *ratchet* (nunca podem crescer; só podem diminuir até sair do baseline).
   - **Verificação automática:** execute `npm run check:sizes` após alterações estruturais.
2. **Separação de Responsabilidades (SRP) por Camada:**
   - **Contratos (`packages/contracts/src/`):** tipos e DTOs organizados por domínio em `domains/*.ts` e reexportados via `index.ts`.
   - **Backend (`apps/daemon/src/server/`):** rotas HTTP isoladas por domínio em `routes/*-routes.ts` (despachadas por `studio-routes.ts` como facade fino) e definições/executores de tools isolados em `tools/*.ts` (agregados por `studio-tools-bridge.ts`).
   - **Transporte Web (`apps/web/src/services/`):** cliente HTTP (`http-client.ts`), transporte WebSocket (`ws-transport.ts`) e clientes REST por domínio em `api/*.ts`, preservando `websocket-client.ts` como barrel compatível.
   - **Frontend (`apps/web/src/`):** estado e efeitos em `hooks/use*.ts`, helpers puros em `utils/`, e componentes visuais desacoplados em `features/<dominio>/`.
3. **Cuidados Obrigatórios na Refatoração:**
   - **Zero quebra de contrato:** preservar integralmente URLs `/api/*`, payloads, eventos WebSocket, canais IPC do Electron e assinaturas exportadas usando *barrels/facades* durante a transição.
   - **Execução atômica e validada:** fatiar um módulo por vez, validar imediatamente com `typecheck`, `build:web` (quando tocar `apps/web`), `test:daemon` / testes do workspace e `npm run check:sizes` antes de avançar para o próximo.
   - **Higiene e segurança:** remover scripts temporários imediatamente após o uso, respeitar a diretriz *clean-room* e manter 100% da Regra Anti-Contaminação.
4. **Contrato Obrigatório de Releases e Changelog Público (`criativoos-site` + App):**
   - Sempre que uma nova release/versão do **CriativoOS** for gerada (`npm run release:bump`, nova tag `vX.Y.Z` ou publicação de instaladores), é **obrigatório**:
     1. Atualizar **`../criativoos-site/src/data/changelogData.ts`** inserindo a nova versão no topo (âncora `#vX-Y-Z`, data real, resumo objetivo em pt-BR, aviso pós-atualização quando aplicável e grupos `Novidades`/`Melhorias`/`Correções`/`Segurança`, **sem travessões `—`/`–`**), atualizar `<lastmod>` em `../criativoos-site/public/sitemap.xml`, validar com `npm run typecheck; npm run build; npm run verify` no `criativoos-site` e fazer commit + push do site;
     2. Atualizar o catálogo interno de notas do aplicativo em **`apps/daemon/src/server/release-notes-catalog.ts`** com os mesmos destaques da nova versão para que o banner de novidades dentro do CriativoOS (`VersionWhatsNewBanner`) e a aba `Configurações -> Atualizações` exibam automaticamente as novidades e o link direto `https://criativoos.com.br/changelog#vX-Y-Z`.
