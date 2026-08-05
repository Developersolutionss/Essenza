# Estado actual del sistema

Este documento describe lo que está implementado hoy.
El sistema migró del MVP a la nueva estructura de monorepo.

## Tecnología

- Monorepo con npm workspaces: `server/`, `client/`.
- Server: Express 5 + TypeScript 5.9 + CommonJS (Node16).
- Base de datos: PostgreSQL 16 con Prisma 7 (driver adapters).
- Cliente: React 19 + Vite 8 + Tailwind 4 (CSS-first).
- Autenticación JWT con roles (admin, manager, chatter).
- Multi-tenant por agencia (`Agency`).

## Estructura del server

| Archivo | Función |
|---|---|
| `server/src/index.ts` | Entrada del servidor. Monta los routers en `/api`. |
| `server/prisma/schema.prisma` | Schema de datos con enums y convenciones. |
| `server/prisma/seed.ts` | Datos de prueba idempotentes. |
| `server/src/prisma.ts` | Singleton del cliente Prisma con adapter Postgres. |
| `server/src/middleware/auth.ts` | `requireAuth` y `requireRole` con JWT. |
| `server/src/routes/auth.ts` | Login. |
| `server/src/routes/models.ts` | CRUD de modelos con scope por rol. |
| `server/src/routes/phrases.ts` | CRUD de frases. |
| `server/src/routes/consent.ts` | Registro de consentimiento. |
| `server/src/routes/generate.ts` | Generación de audio (MP3). |
| `server/src/routes/usage.ts` | Resumen de uso por chatter y por modelo. |
| `server/src/services/ttsService.ts` | Lógica de generación: límites, caché, consentimiento, acceso. |
| `server/src/providers/` | Capa desacoplada de proveedor de voz (ElevenLabs). |
| `server/src/audioStore.ts` | Hash de texto y almacenamiento de archivos MP3. |

## Tablas de la base de datos

| Tabla | Función |
|---|---|
| `agencies` | Agencias multi-tenant. |
| `models` | Modelos. Pertenece a una agencia. |
| `voices` | Voces clonadas. Pertenece a un modelo. |
| `chatters` | Usuarios con email/password, rol y límite diario. |
| `model_chatter_access` | Asignación many-to-many entre chatter y modelo. |
| `generations` | Registro de cada generación de audio. |
| `audio_cache` | Caché de audios. Evita pagar dos veces la misma frase. |
| `model_consent` | Consentimiento firmado de cada modelo. |
| `phrases` | Frases pre-armadas. |

## Endpoints de la API

| Método | Ruta | Auth | Función |
|---|---|---|---|
| POST | `/api/auth/login` | No | Login. Devuelve token JWT + usuario. |
| GET | `/api/models` | Sí | Lista modelos. Chatter ve solo sus asignadas. |
| POST | `/api/models` | admin/manager | Crea un modelo con su primera voz. |
| GET | `/api/phrases` | Sí | Lista las frases. |
| POST | `/api/phrases` | Sí | Crea una frase. |
| POST | `/api/model-consent` | admin/manager | Registra consentimiento. |
| POST | `/api/generate` | Sí | Genera audio. Verifica acceso chatter↔modelo. |
| GET | `/api/usage/summary` | admin/manager | Uso por chatter hoy y por modelo este mes. |

## Flujo de generación de audio

1. La API recibe `model_id` y `text`. El `chatter_id` viene del token JWT.
2. Verifica que el chatter existe y está activo.
3. Verifica que el modelo existe y está activo.
4. Si el chatter tiene rol `chatter`, verifica el acceso (`ModelChatterAccess`). Sin acceso → `403`.
5. Verifica que el modelo tiene consentimiento. Sin consentimiento → `403`.
6. Busca una voz `lista` para ese modelo. Sin voz → `422`.
7. Calcula los caracteres usados hoy por el chatter.
8. Compara con el límite diario. Si lo supera, devuelve `429`.
9. Calcula el hash del texto.
10. Busca el audio en la caché por modelo + hash.
11. Si existe en la caché, lo devuelve sin gastar cuota.
12. Si no existe, llama al proveedor (ElevenLabs).
13. Guarda el MP3 en `server/data/audio/`.
14. Guarda el registro en `audio_cache` y en `generations`.
15. Devuelve el MP3 con el encabezado `X-Audio-Source`.

## Reglas de negocio

- Una modelo sin consentimiento no genera audio. Devuelve `403`.
- Una chatter sin acceso asignado a la modelo no genera audio. Devuelve `403`.
- El límite diario por defecto es 20.000 caracteres. Superarlo devuelve `429`.
- La caché no gasta cuota. Solo la primera generación gasta cuota.
- El resumen de uso no cuenta los caracteres de la caché.

## Cliente

El cliente React corre en `http://localhost:5173` (dev).
Es mínimo: login, ver modelos, ver uso, ver frases y generar audio.
Sirve para verificar el funcionamiento de la API.

## Pendientes conocidos

- Panel de administración completo (asignar chatters a modelos, costos).
- Frontend React completo (hoy es un cliente de verificación).
- Gestión de voces (subir samples, clonar, preview en ElevenLabs).
- Subir `server/data/audio` a S3-compatible si el despliegue no tiene disco persistente.
