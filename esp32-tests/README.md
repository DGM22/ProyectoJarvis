# Pruebas de hardware de audio (ESP32-S3 Freenove)

Dos proyectos PlatformIO independientes. Cada uno se sube solo a la placa, sin
cámara, backend ni IA, para aislar el problema.

| Carpeta | Qué prueba |
|---|---|
| `mic-test/` | INMP441: cortos en pines, si el mic contesta en SD, SCK/WS cruzados, medidor RMS/pico en dBFS, grabación de 3 s |
| `speaker-test/` | MAX98357A + bocina: silencio digital, tonos, escalera de nivel, barrido, música/voz desde la flash, streaming tipo Jarvis, WiFi, loopback mic→bocina |

> Al terminar, regresa al firmware principal:
> `pio run -d ../esp32-camera -e freenove -t upload`

## Cableado

| Módulo | Pin | ESP32-S3 | Nota |
|---|---|---|---|
| INMP441 | VDD | 3.3V | 1.8–3.3 V, **nunca 5 V** |
| | GND | GND | |
| | SCK | GPIO40 | |
| | WS | GPIO39 | |
| | SD | GPIO21 | |
| | L/R | GND | canal izquierdo; nunca flotante |
| MAX98357A | VIN | 5V | + 100 µF y 0.1 µF a GND pegados al módulo |
| | GND | GND | |
| | BCLK | GPIO47 | |
| | LRC | GPIO48 | |
| | DIN | **GPIO1** | **no GPIO45**: es pin de arranque y bloquea la subida |
| | SD | libre | encendido |
| | GAIN | libre | 9 dB; a VDD = 6 dB si distorsiona |
| Bocina 4 Ω 3 W | + / − | OUT+ / OUT− | nunca OUT− a GND; cables trenzados, lejos del mic |

## 1. Micrófono

```bash
cd esp32-tests/mic-test
pio run -t upload && pio device monitor
```

Al arrancar dice si el mic **responde** o no y por qué. Comandos (letra + Enter):
`p` repetir pruebas · `s` cruzar SCK/WS · `f` 16/32 kHz · `x` volcado hex · `r` grabar 3 s · `m` medidor.

Referencia: silencio ≈ −70…−55 dBFS RMS, voz a 20 cm ≈ −40…−25 dBFS.
Si sale **0 exacto** o "nadie maneja SD": pines sin soldar, sin 3.3 V, GND o cables mal.

## 2. Amplificador y bocina

```bash
cd esp32-tests/speaker-test
./tools/make_voice.sh "Hola, soy Jarvis"                 # data/voz.wav (voz TTS)
./tools/convert_audio.sh ~/Downloads/cancion.mp4 musica  # data/musica.wav
pio run -t upload        # primero el firmware (cambia la tabla de particiones)
pio run -t uploadfs      # luego los .wav a la flash
pio device monitor
```

Orden: `0` silencio → `1` tono → `2` escalera → `4` música → `5` voz → `6` streaming → `w` WiFi → `l` loopback.

| Qué escuchas | Causa probable |
|---|---|
| Ruido/pitidos en `0` (mandando ceros) | **Físico**: alimentación, GND, GAIN/SD, cables, interferencia |
| `0` limpio, ruido solo en `w` | WiFi metiendo ruido por la alimentación: capacitor, fuente 5 V aparte |
| Distorsiona desde cierto escalón en `2` | Clipping: baja volumen o GAIN a VDD |
| `5` limpio pero cortes en `6` | Buffer / red (colchón) |
| `5` limpio pero Jarvis con ruido | Cadena de la IA (formato/stream), no el hardware |
| `l` se oye tu voz clara | Mic + amp + bocina OK |
