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
React (Vite + Tailwind)
        │
        │  API
        │
   Express + TypeScript
        │
   Prisma ──> PostgreSQL
        │
   storage (filesystem VPS o S3)
        │
   proveedor de voz (ElevenLabs)
```

## Seguridad

### Autenticación

El sistema usa JWT.
Cada petición lleva un token.
El token contiene el rol del usuario.

### Roles

- **Admin**: acceso total.
- **Manager**: acceso a sus agencias.
- **Chatter**: acceso solo a las modelos asignadas.

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
