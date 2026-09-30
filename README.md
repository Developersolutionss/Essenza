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

## Bot de Discord

Los chatters generan los audios desde Discord; la web queda como apoyo.
El bot corre dentro del mismo proceso que el servidor y se activa si hay
`DISCORD_TOKEN` y `DISCORD_CLIENT_ID` en `.env` (opcional `DISCORD_GUILD_ID`).

1. Crear la aplicación en discord.com/developers/applications, agregar un Bot y copiar el token.
2. Invitar el bot al servidor con los scopes `bot` y `applications.commands`.
3. Un manager (permiso Gestionar servidor) vincula cada usuario con su chatter: `/vincular`.

Comandos: `/voz modelo texto`, `/frase modelo frase`, `/uso`, `/vincular`.
Las respuestas son efímeras (solo las ve quien las pidió) y el mp3 va adjunto.

## Antes de usar con una modelo real

1. Clonar su voz en ElevenLabs (Instant Voice Clone) y copiar el `voice_id`.
2. Cargar el modelo en la tabla `models` con ese `voice_id`.
3. Cargar el registro de consentimiento en `model_consent` — **el endpoint
   de generación rechaza pedidos para modelos sin consentimiento cargado**.

## Estructura

- `src/db.js` — schema SQLite (modelos, consentimiento, chatters, caché, uso).
- `src/providers/` — capa de proveedor de voz, desacoplada para poder
  swapear ElevenLabs por otro proveedor sin tocar el resto del sistema.
- `src/generator.js` — lógica única de generación (consentimiento, límite, caché), usada por web y bot.
- `src/discord.js` — bot de Discord (comandos slash).
- `src/routes.js` — API: modelos, frases, generación, resumen de uso.
- `public/` — frontend simple para chatters.

## Pendiente para producción

- Autenticación real de chatters/managers (hoy `chatter_id` se ingresa a mano).
- Panel de manager con el resumen de `/api/usage/summary`.
- Subir `data/audio` a almacenamiento persistente si se despliega en un
  entorno sin disco persistente.
