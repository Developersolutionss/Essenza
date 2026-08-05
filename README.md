# Essensa — Generador de audios con voz clonada

MVP para que los chatters generen audios personalizados con la voz clonada
de cada modelo, a partir de texto. Node/Express + SQLite, con caché de
frases repetidas y límites de uso por chatter.

## Setup

```
npm install
cp .env.example .env   # completar ELEVENLABS_API_KEY
node src/seed.js       # carga chatter/modelo/frases de prueba
npm run dev
```

Abrir `http://localhost:3000` (generador de chatters) o `http://localhost:3000/manager.html` (panel de manager).

## Antes de usar con una modelo real

1. Clonar su voz en ElevenLabs (Instant Voice Clone) y copiar el `voice_id`.
2. Cargar el modelo con el panel de manager (`/manager.html`) o `POST /api/models`.
3. Cargar el registro de consentimiento con `POST /api/model-consent` — **el
   endpoint de generación rechaza pedidos para modelos sin consentimiento cargado**.

## API

- `GET /api/models` · `POST /api/models` — listar y crear modelos.
- `GET /api/phrases` · `POST /api/phrases` — listar y crear frases.
- `POST /api/model-consent` — registrar consentimiento de una modelo.
- `POST /api/generate` — generar un audio (MP3).
- `GET /api/usage/summary` — uso por chatter (hoy) y por modelo (este mes).

## Estructura

- `src/db.js` — schema SQLite (modelos, consentimiento, chatters, caché, uso).
- `src/providers/` — capa de proveedor de voz, desacoplada para poder
  swapear ElevenLabs por otro proveedor sin tocar el resto del sistema.
- `src/routes.js` — API: modelos, frases, consentimiento, generación, resumen de uso.
- `public/` — frontend simple para chatters y panel de manager.
- `docs/` — documentación del proyecto (concepto, estado actual, roadmap).

## Documentación

La documentación del proyecto está en [docs/](docs/README.md).
Cubre el concepto, el estado actual del sistema, la arquitectura y el roadmap.

## Pendiente para producción

- Autenticación real de chatters/managers (hoy `chatter_id` se ingresa a mano).
- Migrar a TypeScript + PostgreSQL/Prisma + React (ver `docs/roadmap.md`).
- Subir `data/audio` a almacenamiento persistente si se despliega en un
  entorno sin disco persistente.
