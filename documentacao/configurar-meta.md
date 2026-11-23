# Configurar Integração Oficial Meta / Instagram Graph API

## Segurança em Primeiro Lugar
- Nunca cole tokens ou senhas no chat de texto.
- No CriativoOS, salve suas credenciais no **Cockpit Web → Conexões → Apps & Canais → Instagram (Meta Graph API)** (cifradas em AES-256-GCM no SQLite) ou no `.env` local.

## Pré-requisitos na Meta
1. Conta do Instagram configurada como **Profissional** (Business ou Creator).
2. Conta vinculada a uma **Página do Facebook** que você administra.
3. Aplicativo criado em `developers.facebook.com` com permissões mínimas (`instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`).
4. Obtenha o **Instagram Business Account ID** (`META_IG_USER_ID` / `instagram_business_account_id`) e o **Access Token** (`META_ACCESS_TOKEN` / `instagram_access_token`).

## Como Validar
- **Pela UI:** em **Conexões → Instagram**, clique em **Testar Conexão**.
- **Pelo Chat:** peça ao **Engenheiro de Integração & Meta** para *"validar minha integração com a Meta"*.
- **Pelo Terminal:** execute `npm run validar:integracoes` (ou `criativo validar` na VPS).
