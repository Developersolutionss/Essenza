# Módulos del sistema objetivo

Este documento describe los módulos del sistema objetivo.
El sistema objetivo reemplaza al MVP actual.

## 1. Auth y roles

El sistema tiene tres roles:

- **Admin**: controla toda la plataforma.
- **Manager de agencia**: administra modelos y chatters.
- **Chatter**: genera audios.

La autenticación usa JWT.
El sistema verifica el rol en cada petición.
Una chatter solo accede a las modelos asignadas.

## 2. Gestión de modelos

El módulo administra los perfiles de cada modelo.
Cada modelo está vinculado a una cuenta de OnlyFans.
Cada modelo tiene una o varias voces asociadas.

## 3. Gestión de voces

Este módulo trabaja con la API de ElevenLabs.

Las funciones son:

- Subir samples de audio de la modelo.
- Crear o clonar una voz con la API.
- Guardar el `voice_id` de la voz.
- Reproducir un preview de la voz.
- Eliminar una voz.
- Reentrenar una voz.

## 4. Generación TTS

La chatter escribe un texto o graba un placeholder.
La chatter selecciona la voz de una modelo asignada.
El sistema genera el audio.
La chatter descarga el audio o lo envía al fan.

## 5. Historial y cuotas

El módulo registra cada generación.
Cada generación guarda el chatter, el modelo y los caracteres.
El control de consumo es importante. ElevenLabs cobra por caracteres.

## 6. Panel de administración

El panel permite:

- Asignar chatters a modelos.
- Ver el uso por chatter y por modelo.
- Ver los costos por modelo y por agencia.
