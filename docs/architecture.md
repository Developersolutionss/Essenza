# Arquitectura

Este documento describe la arquitectura actual y la objetivo.
La arquitectura actual funciona.
La arquitectura objetivo agrega multi-tenant, autenticación y roles.

## Arquitectura actual

```
Navegador
   │
   ├── / (generador)          ├── /manager.html
   │                            │
   └──────────── Express ───────┘
                     │
              ┌──────┴──────┐
              │   API /api  │
              └──────┬──────┘
                     │
              ┌──────┴──────┐
              │   SQLite    │
              └─────────────┘
                     │
              ┌──────┴──────┐
              │  audioStore │──> data/audio/
              └─────────────┘
                     │
              ┌──────┴──────┐
              │  providers  │──> ElevenLabs API
              └─────────────┘
```

El servidor sirve el frontend y la API.
La API guarda los datos en SQLite.
La capa `providers` llama a ElevenLabs.
Esta capa está desacoplada del resto del sistema.
Es el punto correcto para agregar otros proveedores de voz.

## Flujo de generación de audio

1. La chatter envía el texto y la voz seleccionada.
2. El sistema verifica el acceso de la chatter a la modelo.
3. El sistema verifica el consentimiento de la modelo.
4. El sistema verifica el límite diario de caracteres.
5. El sistema busca el audio en la caché.
6. Si no existe, el proveedor genera el audio.
7. El sistema guarda el audio y registra el uso.

## Arquitectura objetivo

```
server/                         client/
   ├── index.ts                   ├── React (Vite + Tailwind)
   ├── middleware/auth.ts         └── página mínima (verifica la API)
   ├── routes/*.ts
   ├── services/*.ts
   ├── providers/elevenlabs.ts
   ├── prisma.ts ──> Prisma ──> PostgreSQL
   └── audioStore.ts
                    │
                    │  ElevenLabs API
```

## Estructura del server

El server sigue la estructura por capas con routers por recurso.

- `routes/` — un router por recurso (`auth`, `models`, `voices`, `generations`, `phrases`, `usage`).
- `services/` — lógica que toca varias tablas.
- `middleware/auth.ts` — autenticación y roles.
- `providers/` — capa desacoplada de proveedor de voz.
- `prisma.ts` — único `PrismaClient` con adapter Postgres.

## Patrón de handler

Cada endpoint sigue el mismo patrón.

1. Definir un schema con zod en el archivo.
2. Validar el cuerpo con `safeParse`.
3. Si falla, devolver `400` con `{ error, details }`.
4. Ejecutar la operación con Prisma.
5. Devolver JSON plano con el código correcto.

Las mutaciones que tocan varias tablas usan `prisma.$transaction(tx)`.

## Respuestas y errores

- Éxito: JSON plano del recurso.
- Error: `{ "error": string }`.
- Validación: `{ "error": string, "details": ... }`.
- Códigos: `400` inválido, `401` sin token, `403` sin permisos, `404` no encontrado.

## Seguridad

### Autenticación

El sistema usa JWT.
Cada petición lleva un token Bearer.
El middleware `requireAuth` verifica el token.
El middleware inyecta el usuario en la petición.

### Roles

El middleware `requireRole(...roles)` limita el acceso por rol.

- **Admin**: acceso total.
- **Manager**: acceso a sus agencias.
- **Chatter**: acceso solo a las modelos asignadas.

Los routers se protegen con `router.use(requireAuth)`.
Las rutas públicas quedan fuera del middleware.

### Control de acceso

El sistema verifica el acceso en cada petición.
Una chatter no ve las voces de otras modelos.
La asignación se define en `ModelChatterAccess`.

### Consentimiento

La generación de audio requiere consentimiento firmado.
El sistema rechaza la generación sin consentimiento.

## Storage

Los audios se guardan en el filesystem del VPS.
Para despliegue sin disco persistente, se usa S3-compatible.
Backblaze y Wasabi son opciones económicas.
El sistema guarda solo el `voice_id`.
El sistema no guarda audios crudos del fan si no es necesario.
