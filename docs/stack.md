# Stack del sistema objetivo

Este documento describe las tecnologías del sistema objetivo.
El sistema actual usa otro stack. La migración se explica en [roadmap.md](roadmap.md).

## Repositorio

El proyecto usa un monorepo con npm workspaces.
Cada workspace vive en su carpeta.

- `server/` — backend.
- `client/` — frontend.

Los scripts de la raíz orquestan ambos workspaces.

## Backend (`server/`)

- Node.js 24.
- Express 5.
- TypeScript 5.9.
- tsx para desarrollo.
- CommonJS, módulos Node16.
- Sin alias de import.

## Base de datos

- PostgreSQL 16.
- Prisma 7 con driver adapters.
- Driver `pg` y `@prisma/adapter-pg`.
- Config Prisma 7: `prisma.config.ts`.
- Migraciones versionadas en `prisma/migrations/`.
- Seed idempotente con `upsert`.

PostgreSQL reemplaza a SQLite.
El sistema necesita multi-tenant real.
Las relaciones entre modelos, voces, chatters y uso son complejas.
PostgreSQL permite estas relaciones.
El sistema puede correr junto al resto de la infraestructura en el VPS.

Para desarrollo local se usa PostgreSQL en Docker.
El archivo `docker-compose.yml` define el contenedor.

## Dependencias del server

| Paquete | Versión | Función |
|---|---|---|
| express | 5.2.1 | Framework HTTP |
| prisma | 7.9.1 | ORM y migraciones |
| @prisma/client | 7.9.1 | Cliente Prisma |
| @prisma/adapter-pg | 7.9.1 | Adaptador Postgres |
| pg | 8.22.0 | Driver PostgreSQL |
| zod | 4.4.3 | Validación de cuerpos |
| jsonwebtoken | 9.0.3 | Autenticación JWT |
| bcryptjs | 3.0.3 | Hash de contraseñas |
| dotenv | 17.4.2 | Variables de entorno |
| typescript | 5.9.x | Compilador |
| tsx | 4.23.6 | Ejecutor de desarrollo |

Nota: TypeScript se fija en 5.9.
La versión 7 es el nuevo port nativo.
Se usará cuando el ecosistema lo consolide.

## Frontend (`client/`)

- React 19.
- Vite 8.
- Tailwind CSS 4 (CSS-first).
- Sin react-router ni TanStack Query.

El frontend es mínimo.
Sirve para verificar el funcionamiento de la API.
Cuando el frontend sea prioridad, se amplía.

| Paquete | Versión | Función |
|---|---|---|
| react | 19.2.8 | UI |
| react-dom | 19.2.8 | Render |
| vite | 8.2.0 | Bundler |
| @vitejs/plugin-react | 6.0.5 | Plugin React |
| tailwindcss | 4.3.3 | Estilos |
| @tailwindcss/vite | 4.3.3 | Plugin Vite de Tailwind |

## Integración de voz

- API de ElevenLabs.
- Voice cloning y endpoints de TTS.

El sistema guarda solo el `voice_id`.
El sistema no guarda los audios crudos del fan si no es necesario.

## Storage de audios

- Filesystem en el VPS, o
- Almacenamiento compatible con S3 (Backblaze o Wasabi).

El storage guarda los samples y los outputs generados.
