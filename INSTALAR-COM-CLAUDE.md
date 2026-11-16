# Instalação assistida pelo Claude Code

Escolha a opção conforme a forma como você recebeu o **Criativo AI Studio Online**.

## A) Recebi um arquivo ZIP (mais simples)

1. Instale o **Node.js** (versão **22 ou superior**, LTS) em <https://nodejs.org>. Se não tiver certeza se já tem, pule: o agente confere.
2. Extraia o ZIP em uma pasta definitiva, por exemplo `Documentos\criativo-studio-online`. **Não mova essa pasta depois**, porque os comandos de barra e o ambiente local ficam ligados a ela.
3. Abra o **Claude Code** dentro da pasta extraída: no terminal, entre na pasta (`cd`) e digite `claude` (ou abra a pasta no app desktop do Claude Code).
4. Cole este prompt no chat:

```text
Inicie a instalação guiada do Criativo AI Studio Online nesta pasta, que veio de um arquivo ZIP. Leia integralmente AGENTS.md, README.md, INSTALAR.md e documentacao/onboarding-guiado.md. Você está autorizado a executar npm install, npm run instalar -- --plataforma claude, npm run build e preparar o ambiente. Conduza a instalação e o onboarding como um único processo contínuo, sem encerrar entre etapas.

Antes da primeira pergunta, mostre estes seis marcos:
1) Instalação (Node.js 22+, dependências, .env com Cofre AES-256-GCM, build Daemon/Web e 9 skills base no Claude Code)
2) Perfil da Marca (nome, @perfil, nicho, público e tom de voz em conteudos/perfil-da-marca.md ou no Cockpit Web)
3) Identidade Visual (fotos em recursos/fotos/, logo em recursos/logos/, referências em recursos/referencias/ e brandbook)
4) IA & Credenciais Meta (provedor de IA no Cofre + credenciais Instagram/Meta validadas sem expor segredos)
5) Primeiro Criativo & Preview Mobile (gerar o primeiro post/carrossel/story e revisar na Vitrine Mobile 4:5 ou 9:16 em http://127.0.0.1:3000)
6) Publicação Oficial Segura (opcional; só com aprovação explícita no Cockpit/WhatsApp ou escrevendo PUBLICAR)

Em cada interação, mostre o marco atual, o progresso, a decisão que estamos tomando e o resultado da próxima etapa. Nunca termine apenas perguntando se quero continuar.

Regras fundamentais:
- Fale comigo em português simples, sem jargão: eu posso ser iniciante e não conhecer terminal, Node.js ou git. Explique o que vai fazer antes de cada comando.
- No marco Instalação, confira node --version (precisa ser 22 ou superior). Se faltar, me diga o que é, de onde baixar e pare até eu instalar. Depois rode npm install e npm run instalar -- --plataforma claude (que copia as 9 skills base para ~/.claude/skills sem incluir pacotes de upgrade). Depois rode npm run diagnosticar e explique o resultado em linguagem simples.
- Avise que os comandos de barra ficam ligados a esta pasta e que eu não devo movê-la nem apagá-la; se eu mover, rode npm run instalar -- --plataforma claude de novo na pasta nova.
- Nunca abra, mostre ou peça o conteúdo do .env, nem peça chaves ou tokens no chat. Use npm run diagnosticar e npm run validar:integracoes para checar o que está configurado. Para IA e Meta API, me oriente a usar o Cockpit Web (http://127.0.0.1:3000 -> Conexões) ou o .env local seguindo documentacao/configurar-meta.md.
- O marco IA & Credenciais Meta é uma parada obrigatória: não pule e não avance sem a minha resposta. Mostre o que cada integração libera, espere eu salvar no Cockpit ou no .env, rode npm run validar:integracoes e me mostre o resultado sem exibir segredos. Só avance quando eu disser que terminei ou que quero pular a publicação Meta por agora.
- Preserve sempre .env, apps/daemon/dados/, conteudos/, recursos/, saidas/ e upgrades já instalados; não sobrescreva minhas respostas anteriores.
- Nunca prometa skills dos pacotes Bônus ou Vídeo se npm run diagnosticar mostrar que não estão instalados; caso eu queira adicioná-los depois, me explique o comando npm run instalar-upgrade.
- No marco Publicação, nunca publique nada automaticamente: exija aprovação explícita pelo Cockpit, resposta 1 no WhatsApp ou a palavra PUBLICAR.
- Ao final, avise que preciso fechar e reabrir a conversa do Claude Code nesta pasta para os novos comandos /planejar-conteudo, /copywriter-instagram, /criar-carrossel e demais skills base aparecerem, e mostre como abrir o Cockpit Web em http://127.0.0.1:3000.
```

---

## B) Tenho acesso ao repositório no GitHub (clone)

Precisa de **Git** instalado (<https://git-scm.com>) e acesso ao repositório `criativo-studio`. Em uma pasta vazia, abra o terminal com o Claude Code e cole:

```text
Instale o Criativo AI Studio Online a partir de https://github.com/ivancnogueira/criativo-studio.git em uma nova pasta criativo-studio-online no diretório atual. Depois do clone, entre na pasta e leia integralmente AGENTS.md, README.md, INSTALAR.md e documentacao/onboarding-guiado.md. Você está autorizado a executar npm install, npm run instalar -- --plataforma claude e preparar o ambiente. Conduza a instalação e o onboarding como um único processo contínuo, sem encerrar entre etapas.

Antes da primeira pergunta, mostre estes seis marcos:
1) Instalação (clone GitHub, Node.js 22+, dependências, .env com Cofre AES-256-GCM, build Daemon/Web e 9 skills base no Claude Code)
2) Perfil da Marca (nome, @perfil, nicho, público e tom de voz em conteudos/perfil-da-marca.md ou no Cockpit Web)
3) Identidade Visual (fotos em recursos/fotos/, logo em recursos/logos/, referências em recursos/referencias/ e brandbook)
4) IA & Credenciais Meta (provedor de IA no Cofre + credenciais Instagram/Meta validadas sem expor segredos)
5) Primeiro Criativo & Preview Mobile (gerar o primeiro post/carrossel/story e revisar na Vitrine Mobile 4:5 ou 9:16 em http://127.0.0.1:3000)
6) Publicação Oficial Segura (opcional; só com aprovação explícita no Cockpit/WhatsApp ou escrevendo PUBLICAR)

Em cada interação, mostre o marco atual, o progresso, a decisão que estamos tomando e o resultado da próxima etapa. Nunca termine apenas perguntando se quero continuar.

Regras fundamentais:
- Fale comigo em português simples, sem jargão. Explique o que vai fazer antes de cada comando.
- Se o git clone pedir login ou falhar por falta de acesso, pare e me explique como autenticar no Git (por exemplo gh auth login) ou usar a opção ZIP. Nunca peça token no chat.
- No marco Instalação, confira node --version (22 ou superior), rode npm install e npm run instalar -- --plataforma claude, depois npm run diagnosticar e explique em linguagem simples.
- Nunca abra, mostre ou peça o conteúdo do .env nem chaves/tokens no chat. Oriente o preenchimento pelo Cockpit Web (http://127.0.0.1:3000 -> Conexões) ou pelo .env seguindo documentacao/configurar-meta.md, e comprove com npm run validar:integracoes.
- O marco IA & Credenciais Meta é uma parada obrigatória: só avance quando eu confirmar que concluí ou que quero pular por enquanto.
- Preserve sempre .env, apps/daemon/dados/, conteudos/, recursos/, saidas/ e upgrades existentes.
- No marco Publicação, nunca publique sem aprovação explícita no Cockpit/WhatsApp ou a palavra PUBLICAR.
- Ao final, avise para reiniciar o Claude Code dentro da pasta criativo-studio-online para carregar os comandos de barra e informe o endereço http://127.0.0.1:3000 do Cockpit Web.
```

---

## C) Instalar Upgrades em Etapas (quando adquirir Bônus ou Vídeo)

Quando tiver os módulos adicionais, abra o Claude Code na pasta da instalação e cole:

```text
Instale o pacote de upgrade <bonus ou video> no Criativo AI Studio Online usando:
npm run instalar-upgrade -- --pacote <bonus ou video> --fonte <CAMINHO-OU-URL-GIT> --plataforma claude
Depois rode npm run diagnosticar e me informe as novas skills instaladas.
```

---

## Atualizar depois

As atualizações trocam só o produto (código, skills base e documentação). **Seus dados nunca são tocados**: `.env`, `apps/daemon/dados/`, `conteudos/`, `recursos/`, `saidas/`, `previas/` e upgrades instalados. Abra o Claude Code na pasta e cole:

```text
Atualize o Criativo AI Studio Online nesta pasta. Se ela for um clone do git, rode npm run atualizar -- --plataforma claude. Se eu tiver baixado um ZIP novo, rode npm run atualizar -- --simular --zip CAMINHO-DO-ARQUIVO --plataforma claude, me mostre o relatório e, com a minha confirmação, rode sem --simular. Nunca apague nem sobrescreva .env, apps/daemon/dados, conteudos, recursos, saidas, previas ou meus upgrades, e nunca abra o .env. Ao final, rode npm run diagnosticar e explique em português simples o que mudou.
```

---

## Comportamento obrigatório do agente

1. **Preservação:** manter `.env`, `apps/daemon/dados/`, `conteudos/`, `recursos/`, `saidas/` e upgrades existentes.
2. **Segurança de credenciais:** nunca receber, exibir ou solicitar chaves ou tokens no chat, em comandos ou em commits.
3. **Separação Produto vs. Instância:** nunca gravar dados pessoais nos templates/arquivos rastreados pelo Git.
4. **Publicação com aprovação explícita:** somente a aprovação humana no Cockpit/WhatsApp ou a palavra `PUBLICAR` autoriza a publicação oficial.
