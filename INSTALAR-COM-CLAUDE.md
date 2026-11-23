# Instalação assistida pelo Claude Code

Escolha a opção conforme a forma como você recebeu o **CriativoOS**.

## A) Recebi um arquivo ZIP (mais simples)

1. Instale o **Node.js** (versão **22 ou superior**, LTS) em <https://nodejs.org>. Se não tiver certeza de que já tem, pule: o agente confere.
2. Extraia o ZIP em uma pasta definitiva, por exemplo `Documentos\criativo-studio-online`. **Não mova essa pasta depois**, porque os comandos de barra e o ambiente local ficam ligados a ela.
3. Abra o **Claude Code** dentro da pasta extraída: no terminal, entre na pasta (`cd`) e digite `claude` (ou abra a pasta no app desktop do Claude Code).
4. Cole este prompt no chat:

```text
Inicie a instalação guiada do CriativoOS nesta pasta, que veio de um arquivo ZIP. Leia integralmente AGENTS.md, README.md, INSTALAR.md e documentacao/onboarding-guiado.md. Você está autorizado a executar npm install, npm run instalar -- --plataforma claude, npm run build e preparar o ambiente. Conduza os 4 Marcos da instalação como um único processo contínuo, encerrando após validar as credenciais e entregar o Cockpit Web funcionando em http://127.0.0.1:3000.

Antes da primeira pergunta, mostre estes quatro marcos:
1) Instalação (Node.js 22+, dependências, .env com Cofre AES-256-GCM, build Daemon/Web e 9 skills base no Claude Code)
2) Perfil da Marca (nome, @perfil, nicho, público e tom de voz em conteudos/perfil-da-marca.md e no Cockpit Web)
3) Identidade Visual & Referências (paleta, brandbook, design system e coleta de referências em recursos/referencias/, fotos em recursos/fotos/ e logo em recursos/logos/)
4) IA & Credenciais Meta — Conclusão da Instalação (provedor de IA no Cofre + credenciais Instagram/Meta opcionais validadas sem expor segredos, entregando o Cockpit Web pronto em http://127.0.0.1:3000)

Em cada interação, mostre o marco atual, o progresso, a decisão que estamos tomando e o resultado da próxima etapa. Nunca termine apenas perguntando se quero continuar.

Regras fundamentais:
- Fale comigo em português simples, sem jargão: eu posso ser iniciante e não conhecer terminal, Node.js ou git. Explique o que vai fazer antes de cada comando.
- No Marco 1 (Instalação), confira node --version (precisa ser 22 ou superior). Se faltar, me diga o que é, de onde baixar e pare até eu instalar. Depois rode npm install e npm run instalar -- --plataforma claude (que copia as 9 skills base para ~/.claude/skills sem incluir pacotes de upgrade). Depois rode npm run diagnosticar e explique o resultado em linguagem simples.
- Avise que os comandos de barra ficam ligados a esta pasta e que eu não devo movê-la nem apagá-la; se eu mover, rode npm run instalar -- --plataforma claude de novo na pasta nova.
- No Marco 3 (Identidade Visual & Referências), além de gerar/atualizar identidade-visual.yml, brandbook.md e tokens.css, PARE e me peça explicitamente para salvar referências visuais em recursos/referencias/, fotos em recursos/fotos/ e logo em recursos/logos/ (ou confirmar se subirei depois na aba Arquivos do Cockpit), analisando as referências fornecidas para alimentar os agentes.
- Nunca abra, mostre ou peça o conteúdo do .env, nem peça chaves ou tokens no chat. Use npm run diagnosticar e npm run validar:integracoes para checar o que está configurado. Para IA e Meta API, me oriente a usar o Cockpit Web (http://127.0.0.1:3000 -> Conexões) ou o .env local seguindo documentacao/configurar-meta.md.
- O Marco 4 (IA & Credenciais Meta) é uma parada obrigatória e o último marco do instalador: espere eu confirmar que salvei (ou que deixarei a Meta para depois), rode npm run validar:integracoes e npm run diagnosticar sem exibir segredos, deixe o Cockpit Web rodando via npm start (http://127.0.0.1:3000), marque o setup concluído no Cockpit e encerre entregando o Cockpit pronto para eu operar direto com os agentes (avisando para reiniciar o Claude Code se eu quiser usar /... no terminal).
- Preserve sempre .env, apps/daemon/dados/, conteudos/, recursos/, saidas/ e upgrades já instalados.
```

---

## B) Tenho acesso ao repositório no GitHub (clone)

Precisa de **Git** instalado (<https://git-scm.com>) e acesso ao repositório `criativo-studio`. Em uma pasta vazia, abra o terminal com o Claude Code e cole:

```text
Instale o CriativoOS a partir de https://github.com/ivancnogueira/criativo-studio.git em uma nova pasta criativo-studio-online no diretório atual. Depois do clone, entre na pasta e leia integralmente AGENTS.md, README.md, INSTALAR.md e documentacao/onboarding-guiado.md. Você está autorizado a executar npm install, npm run instalar -- --plataforma claude e preparar o ambiente. Conduza os 4 Marcos da instalação como um único processo contínuo, encerrando após validar as credenciais e entregar o Cockpit Web funcionando em http://127.0.0.1:3000.

Antes da primeira pergunta, mostre estes quatro marcos:
1) Instalação (clone GitHub, Node.js 22+, dependências, .env com Cofre AES-256-GCM, build Daemon/Web e 9 skills base no Claude Code)
2) Perfil da Marca (nome, @perfil, nicho, público e tom de voz em conteudos/perfil-da-marca.md e no Cockpit Web)
3) Identidade Visual & Referências (paleta, brandbook, design system e coleta de referências em recursos/referencias/, fotos em recursos/fotos/ e logo em recursos/logos/)
4) IA & Credenciais Meta — Conclusão da Instalação (provedor de IA no Cofre + credenciais Instagram/Meta opcionais validadas sem expor segredos, entregando o Cockpit Web pronto em http://127.0.0.1:3000)

Em cada interação, mostre o marco atual, o progresso, a decisão que estamos tomando e o resultado da próxima etapa. Nunca termine apenas perguntando se quero continuar.

Regras fundamentais:
- Fale comigo em português simples, sem jargão. Explique o que vai fazer antes de cada comando.
- Se o git clone pedir login ou falhar por falta de acesso, pare e me explique como autenticar no Git (por exemplo gh auth login) ou usar a opção ZIP. Nunca peça token no chat.
- No Marco 1 (Instalação), confira node --version (22 ou superior), rode npm install e npm run instalar -- --plataforma claude, depois npm run diagnosticar e explique em linguagem simples.
- No Marco 3 (Identidade Visual & Referências), me peça explicitamente para salvar ou enviar referências visuais em recursos/referencias/, fotos em recursos/fotos/ e logo em recursos/logos/ (ou avisar se subirei depois pela aba Arquivos do Cockpit), registrando os padrões visuais das referências em identidade-visual.yml e brandbook.md.
- Nunca abra, mostre ou peça o conteúdo do .env nem chaves/tokens no chat. Oriente o preenchimento pelo Cockpit Web (http://127.0.0.1:3000 -> Conexões) ou pelo .env seguindo documentacao/configurar-meta.md, e comprove com npm run validar:integracoes.
- O Marco 4 (IA & Credenciais Meta) é o último marco da instalação: espere eu confirmar que concluí (ou pulei a Meta por enquanto), valide com npm run validar:integracoes, inicie o Cockpit Web com npm start (http://127.0.0.1:3000), marque o onboarding concluído no Cockpit e encerre entregando acesso direto ao Cockpit.
- Preserve sempre .env, apps/daemon/dados/, conteudos/, recursos/, saidas/ e upgrades existentes.
```

---

## C) Instalar Upgrades em Etapas (quando adquirir Bônus ou Vídeo)

Quando tiver os módulos adicionais, abra o Claude Code na pasta da instalação e cole:

```text
Instale o pacote de upgrade <bonus ou video> no CriativoOS usando:
npm run instalar-upgrade -- --pacote <bonus ou video> --fonte <CAMINHO-OU-URL-GIT> --plataforma claude
Depois rode npm run diagnosticar e me informe as novas skills instaladas.
```

---

## Atualizar depois

As atualizações trocam só o produto (código, skills base e documentação). **Seus dados nunca são tocados**: `.env`, `apps/daemon/dados/`, `conteudos/`, `recursos/`, `saidas/`, `previas/` e upgrades instalados. Abra o Claude Code na pasta e cole:

```text
Atualize o CriativoOS nesta pasta. Se ela for um clone do git, rode npm run atualizar -- --plataforma claude. Se eu tiver baixado um ZIP novo, rode npm run atualizar -- --simular --zip CAMINHO-DO-ARQUIVO --plataforma claude, me mostre o relatório e, com a minha confirmação, rode sem --simular. Nunca apague nem sobrescreva .env, apps/daemon/dados, conteudos, recursos, saidas, previas ou meus upgrades, e nunca abra o .env. Ao final, rode npm run diagnosticar e explique em português simples o que mudou.
```

---

## Comportamento obrigatório do agente

1. **Preservação:** manter `.env`, `apps/daemon/dados/`, `conteudos/`, `recursos/`, `saidas/` e upgrades existentes.
2. **Segurança de credenciais:** nunca receber, exibir ou solicitar chaves ou tokens no chat, em comandos ou em commits.
3. **Separação Produto vs. Instância:** nunca gravar dados pessoais nos templates/arquivos rastreados pelo Git.
4. **Publicação com aprovação explícita:** somente a aprovação humana no Cockpit/WhatsApp ou a palavra `PUBLICAR` autoriza a publicação oficial.
