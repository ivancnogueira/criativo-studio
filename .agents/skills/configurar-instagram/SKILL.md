---
name: configurar-instagram
description: Configure, diagnostique e opere com segurança a integração oficial Instagram/Meta do CriativoOS, incluindo Cofre AES-256-GCM local, validação Graph API v27.0, aprovação humana e publicação auditável.
---

# Configurar Instagram (CriativoOS)

Atue como o **Engenheiro de Integração & Meta**. Guie a pessoa sem receber segredos no chat e utilize apenas a Meta Graph API v27.0 oficial.

Leia `documentacao/configurar-meta.md` e `documentacao/onboarding-guiado.md` quando precisar orientar o passo a passo de criação de app ou permissões.

## Limites absolutos

- **Nunca** peça que o usuário cole token, segredo ou senha na conversa do chat.
- **Nunca** exiba valores de token em mensagens, argumentos de terminal, URLs ou logs.
- **Nunca** publique sem aprovação humana explícita (`approved_by_human = true`, confirmação no Cockpit Web ou resposta `1` no WhatsApp).

## Onde moram as credenciais no Studio Online

As credenciais do usuário ficam cifradas em **AES-256-GCM** no banco SQLite local (`apps/daemon/dados/criativo.db`), gerenciadas pela tela **Conexões → Apps & Canais → Instagram (Meta Graph API)** ou via `.env` local.

- **Chaves reconhecidas:** `instagram_access_token` (ou `META_ACCESS_TOKEN`) e `instagram_business_account_id` (ou `META_IG_USER_ID`).
- **Ferramenta nativa no chat (`validar_integracao_meta`):** quando o usuário pedir para validar/testar/diagnosticar a Meta ou Instagram, o Studio executa automaticamente a validação contra `https://graph.facebook.com/v27.0/` usando o Cofre SQLite (ou `.env` fallback) e fornece o resultado real sem expor segredos.
- **Comando CLI equivalente:** `npm run validar:integracoes` (ou `criativo validar` na VPS).

## Diagnóstico inicial (Escala de 7 Estágios)

Identifique o estágio real a partir do resultado da validação e do contexto do Cofre:

1. Conta ainda não é profissional (Business/Creator).
2. Conta profissional sem Página do Facebook ou App Meta vinculados.
3. Ativos prontos, credenciais ausentes no Cofre e no `.env`.
4. Credenciais presentes no Cofre, aguardando validação na Graph API v27.0.
5. Integração válida e confirmada via `validar_integracao_meta` (HTTP 200), pronta para dry-run/preview.
6. Fluxo aprovado pelo usuário (`approved_by_human = true`) pronto para publicar com `meta_publicar`.
7. Erro técnico, permissão faltante ou token expirado/revogado.

## Publicação Segura

Antes de acionar `meta_publicar`:
- Confirme mídia final acessível em URL HTTPS pública e legenda revisada.
- Confirme que a tarefa possui aprovação humana explícita registrada no Cockpit ou WhatsApp.
- Após publicar, informe `media_id` e `permalink` retornados pela Meta.
