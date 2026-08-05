# Essensa — Generador de audios con voz clonada

Sistema multi-tenant para que los chatters generen audios personalizados
con la voz clonada de cada modelo, a partir de texto.

Stack: monorepo con `server/` (Express 5 + TypeScript + Prisma + PostgreSQL)
y `client/` (React 19 + Vite + Tailwind).

## Setup

Requisitos: Node >=22, Docker (para PostgreSQL local).

```
npm install
docker compose up -d                            # o docker run postgres:16-alpine
cp server/.env.example server/.env              # completar DATABASE_URL, JWT_SECRET y ELEVENLABS_API_KEY
npm run prisma:migrate --workspace=server        # crea las tablas
npm run prisma:seed --workspace=server           # carga datos de prueba
npm run dev                                       # arranca server (4000) y client (5173)
```

Abrir `http://localhost:5173` (cliente React) o probar la API en `http://localhost:4000`.

## Usuarios de prueba

| Email | Password | Rol |
|---|---|---|
| admin@essenza.com | password123 | admin |
| manager@essenza.com | password123 | manager |
| chatter@essenza.com | password123 | chatter |

## API

Todos los endpoints requieren autenticación JWT (`Authorization: Bearer <token>`),
salvo `POST /api/auth/login`.

| Método | Ruta | Auth | Función |
|---|---|---|---|
| POST | `/api/auth/login` | No | Login. Devuelve token + usuario. |
| GET | `/api/models` | Sí | Listar modelos. Scope por rol. |
| POST | `/api/models` | admin/manager | Crear modelo con voz. |
| GET | `/api/phrases` | Sí | Listar frases. |
| POST | `/api/phrases` | Sí | Crear frase. |
| POST | `/api/model-consent` | admin/manager | Registrar consentimiento. |
| POST | `/api/generate` | Sí | Generar audio (MP3). Requiere acceso chatter↔modelo. |
| GET | `/api/usage/summary` | admin/manager | Caracteres por chatter (hoy) y por modelo (este mes). |

## Estructura

```
├── package.json              → monorepo con workspaces server + client
├── docker-compose.yml        → PostgreSQL 16 local
├── server/
│   ├── prisma/schema.prisma  → Agency, Model, Voice, Chatter, ModelChatterAccess, …
│   ├── prisma/seed.ts        → datos de prueba idempotentes
│   └── src/
│       ├── index.ts          → entry Express
│       ├── middleware/auth.ts → requireAuth + requireRole (JWT)
│       ├── routes/           → auth, models, phrases, consent, generate, usage
│       ├── services/         → ttsService (límites, caché, consentimiento)
│       └── providers/        → capa de voz (ElevenLabs)
└── client/
    └── src/App.tsx           → cliente React mínimo para verificar la API
```

## Documentación

La documentación completa está en [docs/](docs/README.md).
Cubre el concepto, el estado actual, la arquitectura, el esquema de datos y el roadmap.

## Pendiente para producción

- Frontend React completo (panel de administración con asignación chatters↔modelos).
- Gestión de voces (subir samples, clonar, preview, reentrenar vía ElevenLabs).
- Subir `server/data/audio` a almacenamiento persistente (S3-compatible).
- Panel de costos por modelo y agencia.
