# Onboarding Guiado em 6 Marcos — Criativo AI Studio Online

Roteiro contínuo seguido pelos agentes de código (**Antigravity**, **Claude Code** e **Codex**) e sincronizado com os **6 Marcos do Cockpit Web** (`http://127.0.0.1:3000`). Mostre todos os marcos no início da conversa e, a cada etapa, informe o marco atual, o progresso e a ação seguinte. Nunca encerre apenas perguntando se o usuário deseja continuar.

## Os 6 Marcos

1. **Marco 1 — Instalação:** Node.js 22+, dependências (`npm install`), `.env` com `CRIATIVO_VAULT_KEY`, build Daemon/Web, pastas/templates da marca e **9 skills base** na plataforma escolhida (`--plataforma antigravity|claude|codex|todas`).
2. **Marco 2 — Perfil da Marca:** Nome da marca, `@perfil`, nicho, público-alvo e tom de voz salvos em `conteudos/perfil-da-marca.md` / SQLite (`/api/marca/identidade`).
3. **Marco 3 — Identidade Visual:** Fotos reais em `recursos/fotos/`, logo em `recursos/logos/`, referências visuais em `recursos/referencias/`, brandbook, design system e tokens (`recursos/brand/brandbook.md`, `design-system.md`, `tokens.css`).
4. **Marco 4 — IA & Credenciais Meta (Parada Obrigatória):** Provedor de IA conectado (OpenCode gratuito, OAuth no navegador ou API Key BYOK no Cofre) e, opcionalmente, credenciais Meta Graph API (`META_ACCESS_TOKEN`, `META_IG_USER_ID`) validadas por `npm run validar:integracoes`.
5. **Marco 5 — Primeiro Criativo & Preview Mobile:** Produção do primeiro post, carrossel ou story usando os especialistas base e conferência visual na **Vitrine Mobile Instagram (4:5 ou 9:16)** no Cockpit Web.
6. **Marco 6 — Publicação Oficial Segura:** Opcional; executada apenas mediante aprovação explícita pelo usuário no Cockpit Web, resposta `1` no WhatsApp ou confirmação `PUBLICAR` na conversa (`approved_by_human === true`).

---

## Regras obrigatórias do agente instalador

- **Nunca** abra, exiba ou peça o conteúdo do arquivo `.env`, nem aceite chaves/tokens colados no chat. Use `npm run diagnosticar` e `npm run validar:integracoes`.
- **Preserve sempre** `.env`, `apps/daemon/dados/`, `conteudos/`, `recursos/`, `saidas/`, `previas/` e pacotes de upgrade já instalados.
- **Nunca grave dados pessoais no repositório base:** se estiver trabalhando no template de produto, não comite dados reais da instância.
- **Não prometa skills não instaladas:** confira em `npm run diagnosticar` se os upgrades `bonus` e/ou `video` estão presentes antes de oferecer seus comandos.

---

## Detalhamento de cada marco

### Marco 1 — Instalação
1. Verifique `node --version` (precisa ser `22.0.0` ou superior). Se faltar, oriente o download da versão LTS em <https://nodejs.org> e pare.
2. Se faltar `node_modules`, rode `npm install`.
3. Rode `npm run instalar -- --plataforma <antigravity|claude|codex|todas>`.
   - Explique ao usuário que as skills ficaram vinculadas a esta pasta e que o pacote inicial contém os **9 Agentes Base** (sendo `bonus` e `video` opcionais em etapas).
4. Rode `npm run diagnosticar` e traduza o resultado em linguagem clara para iniciantes.
5. Deixe pronto para iniciar o Cockpit Web com `npm start` (`http://127.0.0.1:3000`).

### Marco 2 — Perfil da Marca
1. Pergunte ao usuário (em português simples) o **Nome da Marca**, **@perfil do Instagram**, **nicho**, **público-alvo** e **tom de voz** — ou oriente preencher diretamente no assistente inicial do Cockpit Web (`http://127.0.0.1:3000`).
2. Atualize os campos locais da instância em `conteudos/perfil-da-marca.md` / `conteudos/estado-do-studio.yml` (ou via API `/api/marca/identidade`).

### Marco 3 — Identidade Visual
1. Peça ao usuário para salvar fotos reais em `recursos/fotos/`, logo em `recursos/logos/` e referências visuais em `recursos/referencias/` (ou anexar via Cockpit Web).
2. Caso ainda não exista uma identidade definida, conduza a definição das cores/tipografia e gere/atualize `recursos/brand/brandbook.md`, `recursos/brand/design-system.md` e `recursos/brand/tokens.css` com `/criar-identidade-visual`.

### Marco 4 — IA & Credenciais Meta (Parada Obrigatória)
1. Mostre o status atual de `npm run diagnosticar` e `npm run validar:integracoes`.
2. Explique o que cada integração habilita:
   - **Provedor de IA (OpenCode gratuito, OAuth ou API Key BYOK):** inteligência dos 9 agentes e geração de artes. Configure pelo Cockpit Web em **Conexões**.
   - **Meta Graph API (Instagram Professional):** validação da conta e publicação oficial. Opcional caso o usuário queira apenas baixar as artes e postar manualmente. Siga [configurar-meta.md](configurar-meta.md).
3. Peça ao usuário para salvar suas chaves no **Cockpit Web (Conexões)** ou diretamente no arquivo `.env` local (informando o caminho completo da pasta).
4. Após o usuário avisar que concluiu, rode `npm run validar:integracoes` (ou use `validar_integracao_meta`) e mostre o status (`✅`/`❌` e estágio `1..5`) sem jamais revelar tokens.
5. Só avance para o Marco 5 quando o usuário confirmar que configurou ou optar por pular a Meta API neste momento.

### Marco 5 — Primeiro Criativo & Preview Mobile
1. Inicie o Daemon/Cockpit Web (`npm start` → `http://127.0.0.1:3000`) se ainda não estiver rodando.
2. Pergunte o tema do primeiro conteúdo (ou sugira 3 ideias alinhadas ao perfil da marca) e acione `/planejar-conteudo`, `/copywriter-instagram` e `/criar-post-individual` (ou `/criar-carrossel` / `/gerar-stories`).
3. Entregue os caminhos das artes geradas em `saidas/` e oriente a conferir na **Vitrine Mobile (4:5 ou 9:16)** dentro do Cockpit Web antes de publicar.

### Marco 6 — Publicação Oficial Segura
1. Somente se o usuário quiser publicar automaticamente e a integração Meta estiver válida no Marco 4.
2. Exija aprovação humana explícita pelo botão **Aprovar e Publicar** no Cockpit Web, pela resposta **`1`** no WhatsApp ou escrevendo **`PUBLICAR`** na conversa.
3. Ao final, lembre o usuário de abrir uma nova sessão no seu agente (`Antigravity`, `Claude Code` ou `Codex`) caso os comandos de barra `/...` recém-sincronizados ainda não apareçam na lista.
