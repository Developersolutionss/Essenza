# Estado actual del sistema

Este documento describe lo que está implementado hoy.
El sistema actual es un MVP.
Funciona en producción de prueba con datos de ejemplo.

## Tecnología actual

- Node.js + Express (JavaScript, CommonJS).
- Base de datos SQLite con `node:sqlite` nativo.
- Frontend en HTML, CSS y JavaScript plano.
- No hay TypeScript. No hay autenticación real.

## Estructura del backend

| Archivo | Función |
|---|---|
| `src/server.js` | Entrada del servidor. Sirve `public/` y monta la API en `/api`. |
| `src/db.js` | Crea la base de datos y las tablas. |
| `src/routes.js` | Define los endpoints de la API. |
| `src/providers/` | Capa de proveedor de voz. Desacoplada del resto. |
| `src/providers/elevenlabs.js` | Llama a la API de ElevenLabs para generar audio. |
| `src/audioStore.js` | Calcula el hash del texto. Guarda y lee los archivos MP3. |
| `src/seed.js` | Carga datos de prueba. |

## Tablas de la base de datos

| Tabla | Función |
|---|---|
| `models` | Modelos con su `voice_id` de ElevenLabs. |
| `model_consent` | Consentimiento firmado de cada modelo. |
| `chatters` | Usuarios que generan audios. Tienen un límite diario. |
| `phrases` | Frases pre-armadas para los chatters. |
| `audio_cache` | Caché de audios generados. Evita pagar dos veces por la misma frase. |
| `usage_log` | Registro de uso por chatter y modelo. |

## Endpoints de la API

| Método | Ruta | Función |
|---|---|---|
| GET | `/api/models` | Lista los modelos activos. |
| POST | `/api/models` | Crea un modelo. |
| GET | `/api/phrases` | Lista las frases. |
| POST | `/api/phrases` | Crea una frase. |
| POST | `/api/model-consent` | Crea un registro de consentimiento. |
| POST | `/api/generate` | Genera un audio. Devuelve el MP3. |
| GET | `/api/usage/summary` | Resumen de uso por chatter y por modelo. |

## Flujo de generación de audio

1. La API recibe `chatter_id`, `model_id` y `text`.
2. Verifica que el chatter existe y está activo.
3. Verifica que el modelo existe y está activo.
4. Verifica que el modelo tiene consentimiento. Si no lo tiene, devuelve `403`.
5. Calcula los caracteres usados hoy por el chatter.
6. Compara con el límite diario. Si lo supera, devuelve `429`.
7. Calcula el hash del texto.
8. Busca el audio en la caché.
9. Si existe en la caché, lo devuelve sin gastar cuota.
10. Si no existe, llama al proveedor de voz.
11. Guarda el MP3 en `data/audio/`.
12. Guarda el registro en `audio_cache` y en `usage_log`.
13. Devuelve el MP3 con el encabezado `X-Audio-Source`.

## Reglas de negocio actuales

- Una modelo sin consentimiento no genera audio. Devuelve `403`.
- El límite diario por defecto es 20.000 caracteres.
- La caché no gasta cuota. Solo la primera generación gasta cuota.
- El resumen de uso no cuenta los caracteres de la caché.

## Frontend

| Página | Ruta | Función |
|---|---|---|
| Generador | `/` | La chatter elige modelo, escribe texto y genera el audio. |
| Panel de manager | `/manager.html` | Muestra dos tablas de uso y un formulario para crear modelos. |

## Pendientes conocidos

- No hay autenticación real. El `chatter_id` se ingresa a mano.
- No hay control de acceso por rol.
- Los audios se guardan en el filesystem local.
