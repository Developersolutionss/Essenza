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

Abrir `http://localhost:3000`.

## Antes de usar con una modelo real

1. Clonar su voz en ElevenLabs (Instant Voice Clone) y copiar el `voice_id`.
2. Cargar el modelo en la tabla `models` con ese `voice_id`.
3. Cargar el registro de consentimiento en `model_consent` — **el endpoint
   de generación rechaza pedidos para modelos sin consentimiento cargado**.

## Estructura

- `src/db.js` — schema SQLite (modelos, consentimiento, chatters, caché, uso).
- `src/providers/` — capa de proveedor de voz, desacoplada para poder
  swapear ElevenLabs por otro proveedor sin tocar el resto del sistema.
- `src/routes.js` — API: modelos, frases, generación, resumen de uso.
- `public/` — frontend simple para chatters.

## Pendiente para producción

- Autenticación real de chatters/managers (hoy `chatter_id` se ingresa a mano).
- Panel de manager con el resumen de `/api/usage/summary`.
- Subir `data/audio` a almacenamiento persistente si se despliega en un
  entorno sin disco persistente.
