# Stack del sistema objetivo

Este documento describe las tecnologías del sistema objetivo.
El sistema actual usa otro stack. La migración se explica en [roadmap.md](roadmap.md).

## Backend

- Node.js + Express.
- TypeScript.

## Base de datos

- PostgreSQL.
- Prisma como ORM.

PostgreSQL reemplaza a SQLite.
El sistema necesita multi-tenant real.
Las relaciones entre modelos, voces, chatters y uso son complejas.
PostgreSQL permite estas relaciones.
El sistema puede correr junto al resto de la infraestructura en el VPS.

## Frontend

- React.
- Vite.
- Tailwind CSS.

## Integración de voz

- API de ElevenLabs.
- Voice cloning y endpoints de TTS.

El sistema guarda solo el `voice_id`.
El sistema no guarda los audios crudos del fan si no es necesario.

## Storage de audios

- Filesystem en el VPS, o
- Almacenamiento compatible con S3 (Backblaze o Wasabi).

El storage guarda los samples y los outputs generados.
