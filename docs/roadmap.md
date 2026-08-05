# Roadmap

Este documento describe el plan de migración y los pasos siguientes.
Las etapas 1, 2 y 3 están completas.
Falta la etapa 4 y los módulos de negocio.

## Estado actual

- Monorepo con npm workspaces: `server/` y `client/`.
- Express 5 + TypeScript 5.9 en el server.
- PostgreSQL con Prisma 7.
- Frontend mínimo en React (Vite + Tailwind).
- Autenticación JWT con roles (admin, manager, chatter).
- Multi-tenant real por agencia (`Agency`).

## Estado objetivo

Completar los 6 módulos descritos en [modules.md](modules.md):
Auth & roles, gestión de modelos, gestión de voces, generación TTS,
historial y cuotas, panel de administración.

## Plan de migración

### Etapa 1 — Datos ✓

- Definir el esquema con Prisma.
- Crear las tablas `Agency` y `ModelChatterAccess`.
- Separar `models.voice_id` en la entidad `Voice`.
- Crear las tablas `AudioCache`, `Phrase` y `ModelConsent`.
- Los datos actuales son de prueba. Se re-seed en limpio.

### Etapa 2 — Backend ✓

- Migrar el código a TypeScript.
- Estructura de `routes/`, `services/` y `middleware/`.
- Patrón de handler con zod.
- Agregar la autenticación JWT.
- Agregar los roles admin, manager y chatter.
- Implementar el control de acceso por asignación.
- Mantener la equivalencia funcional del MVP.

### Etapa 3 — Frontend mínimo ✓

- Migrar el frontend a React con Vite y Tailwind.
- Una página mínima para verificar la API.

### Etapa 4 — Infraestructura

- Elegir el storage de audios.
- Configurar S3-compatible si es necesario.
- Configurar el despliegue.

## Próximos pasos

- Panel de administración: asignar chatters a modelos.
- Gestión de voces: subir samples y clonar vía ElevenLabs.
- Historial y cuotas detallado con costos.
- Frontend React completo con vistas por rol.

## Notas

- La capa `providers` ya existe. Facilita el cambio de proveedor de voz.
- El control de consumo es importante. ElevenLabs cobra por caracteres.
- Los cambios se hacen en ramas `feature/`. Cada rama se integra a `develop`.
