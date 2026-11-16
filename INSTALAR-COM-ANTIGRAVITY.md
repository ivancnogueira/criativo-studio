# Instalação assistida pelo Antigravity

Escolha a opção conforme a forma como você recebeu o **Criativo AI Studio Online**.

## A) Recebi um arquivo ZIP (mais simples)

1. Instale o **Node.js** (versão **22 ou superior**, LTS) em <https://nodejs.org>. Se não tiver certeza se já tem, pule: o agente confere.
2. Extraia o ZIP em uma pasta definitiva, por exemplo `Documentos\criativo-studio-online`. **Não mova essa pasta depois**, porque os comandos de barra e o ambiente local ficam apontando para ela.
3. Abra essa pasta como workspace no **Antigravity**.
4. Cole este prompt no chat:

```text
Inicie a instalação guiada do Criativo AI Studio Online nesta pasta, que veio de um arquivo ZIP. Leia integralmente AGENTS.md, README.md, INSTALAR.md e documentacao/onboarding-guiado.md. Você está autorizado a executar npm install, npm run instalar -- --plataforma antigravity, npm run build e preparar o ambiente. Conduza a instalação e o onboarding como um único processo contínuo, sem encerrar entre etapas.

Antes da primeira pergunta, mostre estes seis marcos:
1) Instalação (Node.js 22+, dependências, .env com Cofre AES-256-GCM, build Daemon/Web e 9 skills base no Antigravity)
2) Perfil da Marca (nome, @perfil, nicho, público e tom de voz em conteudos/perfil-da-marca.md ou no Cockpit Web)
3) Identidade Visual (fotos em recursos/fotos/, logo em recursos/logos/, referências em recursos/referencias/ e brandbook)
4) IA & Credenciais Meta (provedor de IA no Cofre + credenciais Instagram/Meta validadas sem expor segredos)
5) Primeiro Criativo & Preview Mobile (gerar o primeiro post/carrossel/story e revisar na Vitrine Mobile 4:5 ou 9:16 em http://127.0.0.1:3000)
6) Publicação Oficial Segura (opcional; só com aprovação explícita no Cockpit/WhatsApp ou escrevendo PUBLICAR)

Em cada interação, mostre o marco atual, o progresso, a decisão que estamos tomando e o resultado da próxima etapa. Nunca termine apenas perguntando se quero continuar.

Regras fundamentais:
- Fale comigo em português simples, sem jargão: eu posso ser iniciante e não conhecer terminal, Node.js ou git. Explique o que vai fazer antes de cada comando.
- No marco Instalação, confira node --version (precisa ser 22 ou superior). Se faltar, me diga de onde baixar e pare até eu instalar. Depois rode npm install e npm run instalar -- --plataforma antigravity (e explique que isso sincroniza as 9 skills base sem incluir upgrades pagos/opcionais de vídeo ou bônus). Em seguida rode npm run diagnosticar e explique o resultado.
- Avise que os comandos de barra ficam ligados a esta pasta e que eu não devo movê-la depois; se mover, basta rodar npm run instalar -- --plataforma antigravity novamente.
- Nunca abra, mostre ou peça o conteúdo do .env, nem peça tokens ou chaves de API no chat. Use npm run diagnosticar e npm run validar:integracoes para verificar o que está configurado. Para salvar IA ou Meta API, me oriente a usar o Cockpit Web (http://127.0.0.1:3000 -> Conexões) ou o .env local seguindo documentacao/configurar-meta.md.
- O marco IA & Credenciais Meta é uma parada obrigatória: não pule e não avance sem a minha resposta (se configurei ou se quero deixar a publicação Meta para depois). Rode npm run validar:integracoes para comprovar.
- Preserve sempre .env, apps/daemon/dados/, conteudos/, recursos/, saidas/ e upgrades já instalados; não sobrescreva minhas respostas nem ativos anteriores.
- Nunca prometa skills dos pacotes Bônus ou Vídeo se npm run diagnosticar indicar que não estão instalados; caso eu queira ativá-los depois, me explique como usar npm run instalar-upgrade.
- No marco Publicação, nunca publique nada automaticamente: exija aprovação explícita pelo Cockpit, resposta 1 no WhatsApp ou a palavra PUBLICAR.
- Ao concluir a instalação, inicie ou mostre como iniciar o Cockpit Web com npm start (http://127.0.0.1:3000) e avise se eu devo iniciar um novo chat para recarregar os comandos /planejar-conteudo, /copywriter-instagram, /criar-carrossel e demais skills base.
```

---

## B) Tenho acesso ao repositório no GitHub (clone)

Precisa de **Git** instalado (<https://git-scm.com>) e acesso ao repositório `criativo-studio`. Em uma pasta vazia (ex.: `Documentos`), abra o Antigravity e cole:

```text
Instale o Criativo AI Studio Online a partir de https://github.com/ivancnogueira/criativo-studio.git em uma nova pasta criativo-studio-online no diretório atual. Depois do clone, entre na pasta e leia integralmente AGENTS.md, README.md, INSTALAR.md e documentacao/onboarding-guiado.md. Você está autorizado a executar npm install, npm run instalar -- --plataforma antigravity e preparar o ambiente. Conduza a instalação e o onboarding como um único processo contínuo, sem encerrar entre etapas.

Antes da primeira pergunta, mostre estes seis marcos:
1) Instalação (clone GitHub, Node.js 22+, dependências, .env com Cofre AES-256-GCM, build Daemon/Web e 9 skills base no Antigravity)
2) Perfil da Marca (nome, @perfil, nicho, público e tom de voz em conteudos/perfil-da-marca.md ou no Cockpit Web)
3) Identidade Visual (fotos em recursos/fotos/, logo em recursos/logos/, referências em recursos/referencias/ e brandbook)
4) IA & Credenciais Meta (provedor de IA no Cofre + credenciais Instagram/Meta validadas sem expor segredos)
5) Primeiro Criativo & Preview Mobile (gerar o primeiro post/carrossel/story e revisar na Vitrine Mobile 4:5 ou 9:16 em http://127.0.0.1:3000)
6) Publicação Oficial Segura (opcional; só com aprovação explícita no Cockpit/WhatsApp ou escrevendo PUBLICAR)

Em cada interação, mostre o marco atual, o progresso, a decisão que estamos tomando e o resultado da próxima etapa. Nunca termine apenas perguntando se quero continuar.

Regras fundamentais:
- Fale comigo em português simples, sem jargão. Explique o que vai fazer antes de cada comando.
- Se o git clone pedir login ou falhar por falta de permissão, pare e me explique como autenticar no GitHub (por exemplo gh auth login ou login no navegador) ou sugerir usar o ZIP. Nunca peça token ou senha no chat.
- No marco Instalação, confira node --version (22 ou superior). Rode npm install e npm run instalar -- --plataforma antigravity, depois npm run diagnosticar e me explique o resultado.
- Nunca abra, mostre ou peça o conteúdo do .env nem chaves/tokens no chat. Para IA e Meta API, me guie até o Cockpit Web (http://127.0.0.1:3000 -> Conexões) ou .env local seguindo documentacao/configurar-meta.md, e valide com npm run validar:integracoes.
- O marco IA & Credenciais Meta é uma parada obrigatória: só avance quando eu confirmar que configurei ou que vou deixar a publicação Meta para depois.
- Preserve .env, apps/daemon/dados/, conteudos/, recursos/, saidas/ e upgrades existentes.
- No marco Publicação, nunca publique sem aprovação explícita no Cockpit/WhatsApp ou a palavra PUBLICAR.
- Ao final, deixe o Cockpit Web pronto via npm start (http://127.0.0.1:3000) e me avise para abrir uma nova conversa caso os novos comandos /... ainda não apareçam no menu.
```

---

## C) Instalar Upgrades em Etapas (quando adquirir Bônus ou Vídeo)

Quando tiver adquirido os módulos adicionais, abra o Antigravity na pasta da instalação e cole:

```text
Instale o pacote de upgrade <bonus ou video> no Criativo AI Studio Online usando:
npm run instalar-upgrade -- --pacote <bonus ou video> --fonte <CAMINHO-OU-URL-GIT> --plataforma antigravity
Depois rode npm run diagnosticar e me confirme quais novos agentes e skills ficaram ativos.
```

---

## Atualizar depois

As atualizações trocam somente o código e os recursos do produto. **Seus dados nunca são tocados**: `.env`, banco SQLite + Cofre (`apps/daemon/dados/`), marca e pautas (`conteudos/`), fotos e logos (`recursos/`), criativos (`saidas/`, `previas/`) e upgrades instalados. Abra o Antigravity na pasta e cole:

```text
Atualize o Criativo AI Studio Online nesta pasta. Se ela for um clone do git, rode npm run atualizar -- --plataforma antigravity. Se eu tiver baixado um ZIP novo, rode npm run atualizar -- --simular --zip CAMINHO-DO-ARQUIVO --plataforma antigravity, me mostre o relatório e, com a minha confirmação, rode sem --simular. Nunca apague nem sobrescreva .env, apps/daemon/dados, conteudos, recursos, saidas, previas ou meus upgrades, e nunca abra o .env. Ao final, rode npm run diagnosticar e explique em português simples o que mudou.
```

---

## Comportamento obrigatório do agente

1. **Preservação:** nunca sobrescrever `.env`, `apps/daemon/dados/`, `conteudos/`, `recursos/`, `saidas/` ou upgrades já instalados.
2. **Segurança de credenciais:** nunca solicitar, ler ou exibir tokens, senhas ou chaves de API no chat.
3. **Separação Produto vs. Instância:** nunca gravar dados pessoais da marca nos arquivos base/templates rastreados pelo Git.
4. **Publicação com aprovação explícita:** jamais acionar `meta_publicar` sem aprovação explícita do usuário.
