# Roadmap

Este documento describe el plan de migración.
El sistema pasa de un MVP a un sistema completo.
La migración se hace por etapas.

## Estado actual

- Node.js + Express en JavaScript.
- SQLite con `node:sqlite`.
- Frontend en HTML plano.
- Sin autenticación real.
- Sin multi-tenant.

## Estado objetivo

- Monorepo con npm workspaces: `server/` y `client/`.
- Express 5 + TypeScript 5.9 en el server.
- PostgreSQL con Prisma 7.
- Frontend mínimo en React (Vite + Tailwind).
- Autenticación JWT con roles.
- Multi-tenant real por agencia.

## Plan de migración

### Etapa 1 — Datos

- Definir el esquema con Prisma.
- Crear las tablas `Agency` y `ModelChatterAccess`.
- Separar `models.voice_id` en la entidad `Voice`.
- Crear las tablas `AudioCache`, `Phrase` y `ModelConsent`.
- Los datos actuales son de prueba. Se re-seed en limpio.

### Etapa 2 — Backend

- Migrar el código a TypeScript.
- Estructura de `routes/`, `services/` y `middleware/`.
- Patrón de handler con zod.
- Agregar la autenticación JWT.
- Agregar los roles admin, manager y chatter.
- Implementar el control de acceso por asignación.
- Mantener la equivalencia funcional del MVP.

### Etapa 3 — Frontend mínimo

- Migrar el frontend a React con Vite y Tailwind.
- Una página mínima para verificar la API.
- Cuando el frontend sea prioridad, se amplía.

### Etapa 4 — Infraestructura

- Elegir el storage de audios.
- Usar filesystem del VPS o S3-compatible.
- Configurar el despliegue.

## Notas

- La capa `providers` ya existe. Facilita el cambio de proveedor de voz.
- El control de consumo es importante. ElevenLabs cobra por caracteres.
- Los cambios se hacen en ramas `feature/`. Cada rama se integra a `develop`.
