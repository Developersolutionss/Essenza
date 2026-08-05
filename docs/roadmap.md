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

- Node.js + Express en TypeScript.
- PostgreSQL con Prisma.
- Frontend en React (Vite + Tailwind).
- Autenticación JWT con roles.
- Multi-tenant real por agencia.

## Plan de migración

### Etapa 1 — Datos

- Migrar SQLite a PostgreSQL.
- Definir el esquema con Prisma.
- Crear las tablas `Agency` y `ModelChatterAccess`.
- Separar `models.voice_id` en la entidad `Voice`.
- Migrar los datos existentes.

### Etapa 2 — Backend

- Migrar el código a TypeScript.
- Agregar la autenticación JWT.
- Agregar los roles admin, manager y chatter.
- Implementar el control de acceso por asignación.

### Etapa 3 — Frontend

- Migrar el frontend a React con Vite y Tailwind.
- Mantener las mismas funciones del MVP.
- Agregar el panel de administración.

### Etapa 4 — Infraestructura

- Elegir el storage de audios.
- Usar filesystem del VPS o S3-compatible.
- Configurar el despliegue.

## Notas

- La capa `providers` ya existe. Facilita el cambio de proveedor de voz.
- El control de consumo es importante. ElevenLabs cobra por caracteres.
- Los cambios se hacen en ramas `feature/`. Cada rama se integra a `develop`.
