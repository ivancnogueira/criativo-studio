# Instalação em 1 Clique — Criativo AI Studio Online

## 1. Instalação Local Assistida (Antigravity IDE / Terminal)

Em uma pasta vazia no Antigravity IDE, envie este prompt no chat:

```text
Instale o Criativo AI Studio Online a partir de https://github.com/ivancnogueira/criativo-studio.git na pasta criativo-studio no diretório atual.
Depois do clone:
1. Leia README.md, documentacao/instalacao-comprador.md e documentacao/onboarding-guiado.md.
2. Execute npm install ; npm run configurar (que cria .env com CRIATIVO_VAULT_KEY, prepara os templates agnósticos, instala as 9 skills base e compila o projeto).
3. Execute npm run diagnosticar para confirmar que Node 22+, build, skills base e estrutura estão prontos.
4. Inicie o servidor com npm start e me instrua a acessar http://127.0.0.1:3000 para conectar meu provedor de IA e concluir os 6 Marcos do Onboarding.
```

---

## 2. Instalação Manual em Terminal (Windows / macOS / Linux)

```bash
git clone https://github.com/ivancnogueira/criativo-studio.git
cd criativo-studio
npm install
npm run configurar
npm start
```

Abra **http://127.0.0.1:3000** no navegador para acessar o Cockpit Web e iniciar o onboarding.

---

## 3. Instalação 24/7 em VPS Ubuntu 24.04 LTS

```bash
git clone https://github.com/ivancnogueira/criativo-studio.git
cd criativo-studio
sudo bash scripts/install-vps.sh
```

---

## 4. Instalação de Upgrades em Etapas (Opcional — após adquirir)

- **Pacote Agentes Bônus:** `npm run instalar-upgrade -- --pacote bonus` (ou pela aba **Conexões → Habilidades** no Cockpit)
- **Pacote Criativo Video Studio:** `npm run instalar-upgrade -- --pacote video`
