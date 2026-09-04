# ClinicFlow AI

Fundação de um SaaS multitenant para clínicas: atendimento WhatsApp, agenda, prontuário e painel operacional.

## Subir localmente

1. Copie `.env.example` para `.env`.
2. Suba a infraestrutura: `docker compose up -d`.
3. Instale dependências: `npm install`.
4. Gere o client e aplique a primeira migration: `npm run db:generate` e `npm run db:migrate`.
5. Inicie API e dashboard: `npm run dev`.

API em `http://localhost:3333`; dashboard em `http://localhost:3000`.

## Implantação no Coolify

Use `docker-compose.coolify.yml` como Docker Compose do recurso. Copie as variáveis de `.env.coolify.example` para a área de Environment Variables do Coolify, gere valores aleatórios longos para todos os segredos e configure os domínios da API e do frontend. O serviço da API executa `prisma migrate deploy` antes de iniciar.

## Contratos principais

- `POST /api/v1/webhooks/evolution`: recebe `MESSAGES_UPSERT`, ignora grupos e mensagens enviadas pela própria instância, normaliza o telefone, registra o payload e encaminha para BullMQ/n8n.
- `GET /api/v1/appointments/available-slots?clinicId=...&date=YYYY-MM-DD`: calcula horários a partir da agenda do médico, pausas, feriados e conflitos existentes.
- `POST /api/v1/appointments/book`: reserva com lock advisory PostgreSQL e transação `Serializable`, evitando conflito de corrida.
- `GET /api/v1/dashboard/summary?clinicId=...`: dados para o painel da recepção.

Em desenvolvimento, o tenant é selecionado por `x-clinic-id` ou `clinicId`. Em produção, substitua esse mecanismo por um middleware de autenticação e autorização baseado no usuário logado.

## n8n / Evolution API

O workflow colado pelo projeto já aponta para os contratos de consulta e reserva acima. Configure o webhook da Evolution para `/api/v1/webhooks/evolution` ou mantenha o webhook n8n como adaptador e defina `N8N_AI_WEBHOOK_URL` para encaminhar mensagens ao fluxo de IA.

Para a instalação informada, use `https://auto.appsbrasil.store/` para n8n, `https://painel.appsbrasil.store/` para Coolify e `https://api.appsbrasil.store/manager/` para o Manager da Evolution API. As URLs e chaves devem entrar em variáveis de ambiente, nunca no repositório.
