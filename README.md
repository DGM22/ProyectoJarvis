# Proyecto Jarvis

MVP de chat de voz con **Jarvis** usando:

- **Backend:** NestJS + Sequelize (Postgres 17)
- **Frontend:** React + TypeScript (Vite)
- **Voz:** OpenAI Realtime API sobre WebRTC
- **Skills:** casa, knowledge base y consulta del timbre (function tools via sideband WebSocket)

El audio viaja directo entre el navegador y OpenAI. El backend negocia el SDP (unified interface), registra las tools/skills en la sesión y abre un **sideband WebSocket** para ejecutar acciones de la casa cuando la IA las pide.

## Estructura

```text
ProyectoJarvis/
├── .env.example
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
├── firmware/
│   └── esp32-s3-jarvis/   # Thin client voz (ESP-IDF)
└── app/
    ├── backend/
    │   ├── src/devices/         # ESP32 registry + WS /devices
    │   ├── src/skills/          # Casa, knowledge base y timbre
    │   ├── src/realtime/        # WebRTC proxy + WS bridge + sideband
    │   └── sequelize/
    ├── frontend/
    └── wakeword/                # openWakeWord hey_jarvis
```

## Requisitos

- Node.js 22+
- pnpm 9+
- Docker / Docker Compose
- API key de OpenAI con acceso a Realtime API

## Setup

1. Copia el entorno:

```bash
cp .env.example .env
```

2. Edita `.env`:
   - `OPENAI_API_KEY`

3. Levanta Postgres y corre migraciones:

```bash
pnpm db:up
pnpm db:migrate
```

4. Instala dependencias:

```bash
pnpm install
```

5. Arranca todo:

```bash
pnpm run dev
```

- Backend: http://localhost:3000
- Frontend: http://localhost:5173
- Health: http://localhost:3000/health

## Flujo de voz + skills

1. Frontend crea `RTCPeerConnection` y genera SDP offer.
2. Frontend manda el SDP a `POST /realtime/calls?voice=marin` (backend).
3. Backend reenvía a OpenAI con session config (modelo, voz, tools, instructions).
4. Backend lee `call_id` del header `Location` y abre sideband WS.
5. Backend devuelve SDP answer al frontend; el audio fluye browser ↔ OpenAI.
6. Cuando pides algo de la casa (quién vive ahí, recordar un dato, atender el timbre), la IA emite un `function_call` y el sideband ejecuta la skill. Jarvis confirma por voz.

## Skills disponibles

| Skill | Tools |
|-------|-------|
| Casa | `household_list`, `household_save_member` |
| Knowledge base | `kb_search`, `kb_save_fact` |
| Timbre | `call_owner`, `instruct_doorbell`, `end_consult` |

## Endpoints backend

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/health` | Estado del servicio y Postgres |
| `POST` | `/realtime/calls?voice=` | Proxy SDP + inicia sideband con tools |
| `GET` | `/devices` | Lista dispositivos ESP32 |
| `POST` | `/devices` | Crea dispositivo (devuelve token una vez) |
| `POST` | `/devices/:id/call` | Llamada inbound: Jarvis habla en el ESP32 |
| `POST` | `/devices/:id/rotate-token` | Rota el token WS |
| `DELETE` | `/devices/:id` | Elimina dispositivo |

**WebSockets:** `/wake-word` (PCM → openWakeWord), `/devices` (ESP32 JSON+PCM)

## Dispositivo ESP32-S3

El asistente de voz también corre en un thin client ESP32-S3 (mic + speaker + e-ink).
Ver [`firmware/esp32-s3-jarvis/README.md`](firmware/esp32-s3-jarvis/README.md).

1. `pnpm db:migrate` (tabla `devices`)
2. En Config → **Dispositivos**, crea uno y copia el token
3. Configura WiFi + `BACKEND_HOST` (IP LAN, no localhost) + token en el firmware
4. Flashea; di **Hey Jarvis** o pulsa **Llamar** desde la app

El browser sigue usando WebRTC; el ESP32 usa un puente Realtime WebSocket en NestJS
(mismo prompt y skills).

## Variables de entorno

Ver [`.env.example`](.env.example). Las importantes:

- `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE`
- `APP_TIMEZONE`
- `POSTGRES_*`, `BACKEND_PORT`, `FRONTEND_ORIGIN`, `VITE_API_BASE_URL`
- `WAKEWORD_SERVICE_URL` (default `ws://localhost:8765`)
