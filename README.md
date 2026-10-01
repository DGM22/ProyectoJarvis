# Proyecto Jarvis

MVP de chat de voz con **Jarvis** usando:

- **Backend:** NestJS + Sequelize (Postgres 17)
- **Frontend:** React + TypeScript (Vite)
- **Voz:** OpenAI Realtime API sobre WebRTC
- **Skills:** Google Calendar + Google Tasks (function tools via sideband WebSocket)

El audio viaja directo entre el navegador y OpenAI. El backend negocia el SDP (unified interface), registra las tools/skills en la sesión y abre un **sideband WebSocket** para ejecutar acciones en Google cuando la IA las pide.

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
    │   ├── src/google/          # OAuth2 Google
    │   ├── src/skills/          # Calendar + Tasks skills
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
- Proyecto Google Cloud con Calendar API + Tasks API habilitadas

## Setup

1. Copia el entorno:

```bash
cp .env.example .env
```

2. Edita `.env`:
   - `OPENAI_API_KEY`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - Genera `GOOGLE_TOKEN_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

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

## Conectar Google (Calendar + Tasks)

1. En [Google Cloud Console](https://console.cloud.google.com/):
   - Habilita **Google Calendar API** y **Google Tasks API**
   - Configura OAuth consent screen (modo Testing + tu email como test user)
   - Crea credenciales OAuth 2.0 tipo **Web application**
   - Redirect URI: `http://localhost:3000/google/auth/callback`
2. Copia Client ID / Secret a `.env`
3. Conecta Google desde el frontend con el botón **Conectar Google**, o abre:

```text
http://localhost:3000/google/auth/connect
```

Eso te redirige directo a la pantalla de Google (ya no devuelve JSON).

Verifica estado:

```text
GET http://localhost:3000/google/auth/status
```

## Flujo de voz + skills

1. Frontend crea `RTCPeerConnection` y genera SDP offer.
2. Frontend manda el SDP a `POST /realtime/calls?voice=marin` (backend).
3. Backend reenvía a OpenAI con session config (modelo, voz, tools, instructions).
4. Backend lee `call_id` del header `Location` y abre sideband WS.
5. Backend devuelve SDP answer al frontend; el audio fluye browser ↔ OpenAI.
6. Cuando dices "agendame una junta mañana a las 3", la IA:
   - Te pregunta lo que falte (título, duración, etc.)
   - Emite `function_call` (ej. `create_calendar_event`)
   - El sideband ejecuta la skill en Google Calendar
   - Jarvis confirma por voz

## Skills disponibles

| Skill | Tools |
|-------|-------|
| Google Calendar | `create_calendar_event`, `list_calendar_events`, `update_calendar_event`, `delete_calendar_event` |
| Google Tasks | `create_task`, `list_tasks`, `complete_task`, `delete_task` |

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
| `GET` | `/google/auth/connect` | Redirect directo a Google OAuth |
| `GET` | `/google/auth/url` | Alias redirect a Google OAuth |
| `GET` | `/google/auth/callback` | Callback OAuth (redirect al frontend) |
| `GET` | `/google/auth/status` | `{ connected, email }` |

**WebSockets:** `/wake-word` (PCM → openWakeWord), `/devices` (ESP32 JSON+PCM), `/transcripts`

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
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `GOOGLE_TOKEN_ENCRYPTION_KEY`
- `APP_TIMEZONE`
- `POSTGRES_*`, `BACKEND_PORT`, `FRONTEND_ORIGIN`, `VITE_API_BASE_URL`
- `WAKEWORD_SERVICE_URL` (default `ws://localhost:8765`)
