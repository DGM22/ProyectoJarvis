# Jarvis ESP32-S3 Voice Client

Thin client de voz para Proyecto Jarvis. El LLM vive en NestJS + OpenAI;
este firmware solo hace WiFi, mic/speaker I2S, wake-word gate, WebSocket y
estados en e-ink.

## Hardware

**Waveshare ESP32-S3-ePaper-1.54** (e-paper SSD1681 200×200, codec ES8311 con
mic + bocina, botones BOOT/PWR). Pines en `main/board.h`.

- **BOOT (GPIO0)** = timbre: en reposo llama a Jarvis; durante la llamada cuelga.
- "Hey Jarvis" también funciona si `JARVIS_WAKE_WORD` está activo (menuconfig).

## 1. Instalar ESP-IDF (una vez, macOS)

```bash
brew install cmake ninja dfu-util python3
mkdir -p ~/esp && cd ~/esp
git clone -b v5.5.1 --recursive https://github.com/espressif/esp-idf.git
cd esp-idf && ./install.sh esp32s3
```

En cada terminal nueva: `. ~/esp/esp-idf/export.sh`

## 2. Backend + dispositivo

1. `pnpm db:up && pnpm run dev` (y `docker compose up -d wakeword` si usas wake word).
2. En la app: **Config → Dispositivos** → crear dispositivo → copiar token.
3. Expón el backend con ngrok: `ngrok http 3000` → copia el dominio
   (`https://xxxx.ngrok-free.app`). La placa se conecta a `wss://xxxx.ngrok-free.app`,
   así que funciona desde cualquier WiFi 2.4 GHz. Sin túnel también sirve
   `ws://<IP-LAN-de-tu-Mac>:3000` (`ipconfig getifaddr en0`).

## 3. Configurar, compilar y flashear

```bash
cd firmware/esp32-s3-jarvis
idf.py set-target esp32s3
idf.py menuconfig        # Jarvis Device → SSID, password, Backend URL, token
idf.py build
idf.py -p /dev/cu.usbmodem* flash monitor
```

Si no aparece `/dev/cu.usbmodem*` o falla el flasheo: mantén **BOOT**, pulsa y
suelta **PWR/RESET**, suelta BOOT (modo descarga) y reintenta. Sal del monitor
con `Ctrl+]`.

## Protocolo

WebSocket `<BACKEND_URL>/devices?token=<TOKEN>` (ej. `wss://xxxx.ngrok-free.app/devices?token=…`)

- Texto JSON: `hello`, `session.request` (`reason`: `wake` | `button`), `session.end`, `telemetry` (stub)
- Binario: PCM16LE mono **16 kHz** (mic → server; server → speaker)
- Server: `hello.ack`, `session.ready`, `session.end`, `display.set`, `inbound.start`

### Wake word

1. Mic local siempre activo.
2. Gate RMS: solo si hay energía de voz se abre un WS a `/wake-word` y se
   envían ventanas PCM (reusa openWakeWord `hey_jarvis` del monorepo).
3. Al detectar → `session.request` `{ reason: "wake" }` en `/devices`.

### Half-duplex

Mientras `display.set` = `speaking`, no se envía audio del mic (evita eco).

## Estructura

```text
main/
  app_main.c          # arranque
  wifi_sta.c/h
  nvs_config.c/h
  i2s_audio.c/h       # ES8311 vía esp_codec_dev
  jarvis_ws.c/h       # cliente /devices
  wake_gate.c/h       # RMS + /wake-word
  board.c/h           # pinout Waveshare + rieles de power + I2C
  button.c/h          # BOOT = llamar/colgar
  display_hal.c/h     # driver SSD1681 + estados (anillo + texto)
  jarvis_sm.c/h       # state machine
```
