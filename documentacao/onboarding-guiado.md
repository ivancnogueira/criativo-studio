# Onboarding Guiado de Instalação em 4 Marcos — Criativo AI Studio Online

Roteiro enxuto seguido pelos agentes instaladores (**Antigravity**, **Claude Code** e **Codex**) até deixar o ambiente 100% pronto e conectado, entregando a operação de criação e publicação diretamente no **Cockpit Web (`http://127.0.0.1:3000`)**. Mostre todos os 4 marcos no início da conversa e, a cada etapa, informe o marco atual, o progresso e a ação seguinte. Nunca encerre apenas perguntando se o usuário deseja continuar.

## Os 4 Marcos da Instalação

1. **Marco 1 — Instalação:** Node.js 22+, dependências (`npm install`), `.env` com `CRIATIVO_VAULT_KEY`, build Daemon/Web, pastas locais e **9 skills base** na plataforma escolhida (`--plataforma antigravity|claude|codex|todas`).
2. **Marco 2 — Perfil da Marca:** Nome da marca, `@perfil`, nicho, público-alvo, ofertas e tom de voz salvos em `conteudos/perfil-da-marca.md` e sincronizados com o Cockpit (`/api/marca/identidade`).
3. **Marco 3 — Identidade Visual & Referências (Coleta de Ativos):** Paleta, tipografia, `brandbook.md`, `design-system.md`, `tokens.css` e **coleta explícita de referências visuais em `recursos/referencias/`, fotos reais em `recursos/fotos/` e logo em `recursos/logos/`** para os agentes aprenderem o padrão visual da marca.
4. **Marco 4 — IA & Credenciais Meta (Conclusão da Instalação):** Provedor de IA conectado (OpenCode gratuito, OAuth no navegador ou API Key BYOK no Cofre) e, opcionalmente, credenciais Meta Graph API (`META_ACCESS_TOKEN`, `META_IG_USER_ID`) validadas por `npm run validar:integracoes`, finalizando o setup e abrindo o **Cockpit Web (`http://127.0.0.1:3000`)**.

> Após o Marco 4, a instalação termina e você trabalha diretamente com os agentes especialistas dentro do **Cockpit Web (`http://127.0.0.1:3000`)** ou pelo **WhatsApp**.

---

## Como os Agentes Aprendem no Cockpit Web

Tudo o que você salvar nos Marcos 2 e 3 é injetado automaticamente no contexto vivo de todos os agentes no Cockpit:
- **`conteudos/perfil-da-marca.md`:** posicionamento, método, ofertas, dores e tom de voz;
- **`conteudos/identidade-visual.yml`, `recursos/brand/brandbook.md` e `design-system.md`:** cores, fontes, proporções e regras visuais;
- **`recursos/referencias/`, `recursos/fotos/` e `recursos/logos/`:** indexados automaticamente na aba **Arquivos** do Cockpit e enviados como referência visual (`ImagePaths`) sempre que os designers geram novas peças;
- **Memórias individuais do agente** (aba direita do Cockpit): regras específicas que você fixar para cada especialista.

---

## Regras obrigatórias do agente instalador

- **Nunca** abra, exiba ou peça o conteúdo do arquivo `.env`, nem aceite chaves/tokens colados no chat. Use `npm run diagnosticar` e `npm run validar:integracoes`.
- **Preserve sempre** `.env`, `apps/daemon/dados/`, `conteudos/`, `recursos/`, `saidas/`, `previas/` e pacotes de upgrade já instalados.
- **Nunca pule o pedido de referências no Marco 3:** antes de avançar para o Marco 4, peça explicitamente ao usuário para salvar ou anexar referências de posts/carrosséis em `recursos/referencias/` (e fotos em `recursos/fotos/`, logo em `recursos/logos/`), leia os arquivos se forem anexados/salvos e registre as regras estéticas em `identidade-visual.yml` / `brandbook.md`.
- **Encerre no Marco 4:** depois de validar as conexões (`npm run diagnosticar` e `npm run validar:integracoes`), deixar o servidor rodando (`npm start`) e marcar os marcos de setup no Cockpit, encerre o onboarding entregando o endereço `http://127.0.0.1:3000` (e orientando como conectar o WhatsApp por QR Code lá dentro, se desejar). Não tente gerar posts nem publicar durante o instalador.

---

## Detalhamento de cada marco

### Marco 1 — Instalação
1. Verifique `node --version` (`22.0.0` ou superior). Se faltar, oriente o download LTS em <https://nodejs.org> e pare.
2. Se faltar `node_modules`, rode `npm install`.
3. Rode `npm run instalar -- --plataforma <antigravity|claude|codex|todas>`.
   - Explique ao usuário que as 9 skills base foram sincronizadas e vinculadas a esta pasta (e que `bonus`/`video` são módulos opcionais em etapas).
4. Rode `npm run diagnosticar` e explique o resultado em linguagem simples.
5. Inicie ou deixe pronto o Cockpit Web via `npm start` (`http://127.0.0.1:3000`).

### Marco 2 — Perfil da Marca
1. Peça ao usuário a Ficha Estratégica ou as informações principais: **Nome da Marca**, **@perfil do Instagram**, **nicho**, **público-alvo**, **ofertas** e **tom de voz** (ou oriente preencher direto no Cockpit Web).
2. Grave o material completo em `conteudos/perfil-da-marca.md` e sincronize via `/api/marca/identidade` sem perder seções ricas.

### Marco 3 — Identidade Visual & Referências
1. Configure cores, fontes, `conteudos/identidade-visual.yml`, `recursos/brand/brandbook.md`, `recursos/brand/design-system.md` e `recursos/brand/tokens.css` (se o usuário ainda não tiver paleta, sugira e alinhe antes).
2. **Coleta obrigatória de referências e ativos (com parada para resposta):**
   - Peça explicitamente ao usuário para copiar/salvar na pasta da instalação ou enviar na aba **Arquivos** do Cockpit (`http://127.0.0.1:3000`):
     - Imagens de referência de estilo/posts que admira em **`recursos/referencias/`**;
     - Fotos próprias da marca/especialista em **`recursos/fotos/`**;
     - Arquivo oficial do logo (PNG/SVG) em **`recursos/logos/`** (ou confirmar uso provisório).
   - Se o usuário adicionar imagens agora, inspecione-as e atualize as observações de estilo em `identidade-visual.yml` / `brandbook.md` (e confirme via `GET /api/arquivos` que já aparecem no Cockpit).
   - Se preferir subir depois pela aba **Arquivos** do Cockpit Web, registre essa pendência e avance ao Marco 4 quando ele responder.

### Marco 4 — IA & Credenciais Meta (Conclusão da Instalação)
1. Mostre o status atual de `npm run diagnosticar` e `npm run validar:integracoes`.
2. Oriente configurar no **Cockpit Web (`http://127.0.0.1:3000` → Conexões)**:
   - **Provedor de IA:** OpenCode gratuito, OAuth no navegador (Google, Claude, ChatGPT) ou API Key BYOK no Cofre.
   - **Meta Graph API (Instagram Professional — opcional):** siga [configurar-meta.md](configurar-meta.md) para salvar `META_ACCESS_TOKEN` e `META_IG_USER_ID` no Cofre ou no `.env`.
   - *(Opcional)* **WhatsApp:** conecte pelo botão **Conectar WhatsApp** (QR Code) dentro do Cockpit Web.
3. Após o usuário avisar que configurou (ou que deixará a Meta API para depois), rode `npm run validar:integracoes` (e `npm run diagnosticar`) sem jamais exibir tokens, e atualize `/api/onboarding` / `/api/marca/identidade` marcando `configuracoes: "concluido"` e `onboarding_concluido: true`.
4. **Encerramento oficial:** confirme que `http://127.0.0.1:3000` está ativo (`npm start`), informe os próximos passos dentro do próprio Cockpit (conversar com `@estrategista` ou nos **Canais em Equipe**, subir referências na aba **Arquivos** se faltarem e aprovar postagens na **Vitrine Mobile**) e lembre que, para usar os comandos `/...` no agente de código, basta abrir uma nova conversa nesta pasta.
