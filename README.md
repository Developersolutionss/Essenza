# Essensa — Generador de audios con voz clonada

Herramienta interna para que los chatters generen audios con la voz clonada de
cada modelo, a partir de texto. Node/Express + SQLite, con caché de frases
repetidas, límites de uso por chatter, fichajes por Discord y panel de
administración. Todo corre en un único proceso.

## Setup

```
npm install
cp .env.example .env    # completar las claves y contraseñas
node src/seed.js        # datos de prueba (opcional)
npm run dev
```

Panel de administración en `http://localhost:3000/admin`.

La primera vez, `ADMIN_PASSWORD` crea la cuenta `admin`. A partir de ahí las
cuentas se gestionan desde el panel y esa variable ya no se usa para entrar.

## Bot de Discord

Los chatters generan los audios desde Discord. El bot corre dentro del mismo
proceso que el servidor y se activa si hay `DISCORD_TOKEN` y `DISCORD_CLIENT_ID`
en `.env` (opcional `DISCORD_GUILD_ID`, que hace que los comandos aparezcan al
instante en ese servidor).

1. Crear la aplicación en discord.com/developers/applications, agregar un Bot y copiar el token.
2. Invitar el bot con los scopes `bot` y `applications.commands`.
3. Un manager (permiso Gestionar servidor) vincula cada usuario con su chatter: `/vincular`.

Comandos: `/voz modelo texto`, `/frase modelo frase`, `/uso`, `/vincular`,
`/panel-fichajes`. Los dos últimos exigen el permiso Gestionar servidor, que se
comprueba también al ejecutarlos. Las respuestas son efímeras (solo las ve quien
las pidió) y el mp3 va adjunto.

## Fichajes

`/panel-fichajes` publica en el canal un panel con los botones **Start**,
**Break**, **Resume**, **End** y **Mi estado**, más la lista de quién está en
turno o en break, y lo fija en el canal.

- Para pulsar **End** hay que acumular 8 h de trabajo efectivo. El break no cuenta.
- Hay **un solo break por turno**, de 30 min. El exceso queda marcado en el panel web.
- Reglas ajustables en `.env`: `SHIFT_HOURS` y `BREAK_MINUTES`.
- Un turno que quedó abierto se cierra desde el panel web, en Fichajes → En vivo.

## Cuentas y permisos

Cada persona entra con su propio usuario y contraseña. Las contraseñas se guardan
cifradas con scrypt, nunca en claro, y la sesión dura 12 horas.

| | Administrador | Manager |
|---|---|---|
| Ver el panel entero | sí | sí |
| Cerrar un turno olvidado | sí | sí |
| Crear frases | sí | sí |
| Generar audio desde la web | sí | sí |
| Cambiar horarios de entrada | sí | no |
| Crear, editar y borrar cuentas | sí | no |

El admin crea las cuentas en la sección **Cuentas** y le pasa la contraseña a cada
persona; cualquiera puede cambiar la suya desde esa misma pantalla. Desactivar una
cuenta corta su acceso al instante, incluso con la sesión abierta. Siempre debe
quedar al menos un administrador activo.

## Panel de administración

`/admin`. Secciones:

- **Resumen**: quién está en turno, alertas y consumo del día.
- **Fichajes**: llegadas tarde, excesos de break, historial y cierre de turnos abiertos.
- **ElevenLabs**: créditos del plan, consumo diario, proyección del mes, voces más usadas y ahorro por caché.
- **Horarios**: hora de entrada esperada y minutos de gracia por persona. Sin horario, nadie se marca como tarde.
- **Cuentas**: quién entra al panel y con qué rol.

La web de chatters (`/`) usa las mismas cuentas y sirve para generar un audio
suelto; el canal normal de los chatters es Discord.

## Costos y límites

- Cada generación nueva se cobra por carácter; lo que ya está en caché es gratis.
- Límite diario por chatter (`chatters.daily_char_limit`, 20 000 por defecto).
  La cuota se reserva antes de llamar al proveedor, así que dos pedidos
  simultáneos no pueden pasarse del límite.
- Dos pedidos simultáneos de la misma frase nueva comparten una sola llamada al proveedor.
- `MAX_TEXT_CHARS` (1000 por defecto) limita el tamaño de cada audio.
- El "día" de los límites, de `/uso` y del panel es el de `TIMEZONE`.

## Despliegue en un VPS

El proceso escucha en `127.0.0.1` por defecto. Publícalo con un proxy inverso
(nginx o Caddy) que ponga HTTPS; las cookies de sesión llevan `Secure`.

1. `TRUST_PROXY=1` para que el bloqueo por intentos fallidos vea la IP real.
2. `ADMIN_PASSWORD` largo para la cuenta inicial, y cambiarlo desde el panel al entrar.
3. Arrancar con `npm start` desde un servicio de systemd, **un solo proceso**
   (dos instancias harían que el bot responda dos veces).
4. Copia de seguridad diaria de `data/` (base de datos y audios): es lo único que no se puede recrear.
5. `HOST=0.0.0.0` solo si sabes lo que haces: expone la aplicación sin HTTPS.

## Antes de usar con una modelo real

1. Clonar su voz en ElevenLabs (Instant Voice Clone) y copiar el `voice_id`.
2. Poner el `voice_id` en `models.json` y ejecutar `node src/loadModels.js`.
   Sin `voice_id` la modelo queda inactiva y no se puede elegir.

## Estructura

- `src/db.js` — schema SQLite y migraciones (modelos, chatters, caché, uso, turnos, horarios).
- `src/providers/` — capa de proveedor de voz, desacoplada para poder cambiar
  ElevenLabs por otro proveedor sin tocar el resto del sistema.
- `src/generator.js` — lógica única de generación (cuota, caché, reintentos), usada por web y bot.
- `src/auth.js` + `src/users.js` — cuentas, roles y sesiones por cookie firmada.
- `src/timezone.js` — días locales, horarios de entrada y zona horaria.
- `src/discord.js` — comandos del bot. `src/shifts.js` + `src/fichajes.js` — reglas y botones de fichajes.
- `src/admin.js` + `public/admin.*` — panel de administración.
- `src/routes.js` + `public/index.html` — API y web de chatters.
- `public/ds.css` — sistema de diseño compartido por las dos interfaces.

## Pendiente

- En la web, quien genera un audio elige a qué chatter se le anota el consumo;
  no hay aún una cuenta por chatter. En Discord sí es el usuario real.
- Días libres por persona en los horarios: hoy un día sin turno no se distingue
  de una falta.
- Si algún día corren varias instancias del proceso, las protecciones contra
  pedidos simultáneos tendrían que pasar a la base de datos.
