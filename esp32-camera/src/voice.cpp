#include "voice.h"

#include <Arduino.h>
#include <WebSocketsClient.h>
#include <freertos/stream_buffer.h>
#include <math.h>
#include "driver/gpio.h"
#include "driver/i2s.h"

// Mic INMP441 (L/R a GND → canal izquierdo).
#define MIC_I2S_PORT I2S_NUM_0
#define MIC_SCK 40
#define MIC_WS 39
#define MIC_SD 21

// MAX98357A. No usar GPIO45 para DIN: es pin de arranque y bloquea la subida.
#define AMP_I2S_PORT I2S_NUM_1
#define AMP_BCLK 47
#define AMP_LRC 48
#define AMP_DIN 1

/**
 * Ajustes del mic. Corre esp32-tests/mic-test (comando c) y copia aquí lo que
 * dé el piso de ruido más bajo.
 *  - MIC_FORMAT: Philips (I2S estándar) es lo que pide el datasheet del INMP441.
 *  - MIC_CLK_DRIVE: fuerza de SCK/WS. Con cables Dupont largos, 5 mA (CAP_0)
 *    suaviza los flancos y evita que el mic cuente pulsos de más (datos rotos).
 *  - MIC_BIT_SHIFT: bits a recorrer si los datos llegan desfasados.
 *  - MIC_GAIN_SHIFT: ganancia en potencias de 2 al pasar de 24 a 16 bits
 *    (1 = x2; con x4 la voz cercana llegaba recortada a 32767).
 */
static constexpr i2s_comm_format_t MIC_FORMAT = I2S_COMM_FORMAT_STAND_I2S;
static constexpr gpio_drive_cap_t MIC_CLK_DRIVE = GPIO_DRIVE_CAP_0;
static constexpr int MIC_BIT_SHIFT = 0;
static constexpr int MIC_GAIN_SHIFT = 1;
/** Pasa-altas ~80 Hz a 16 kHz: quita DC y retumbe del mic. */
static constexpr float MIC_HPF_ALPHA = 0.969f;
/** Piso de ruido arriba de esto en silencio = datos corruptos (cableado). */
static constexpr float MIC_UNHEALTHY_DBFS = -40.0f;
/** Si el server no contesta session.ready en este tiempo, se cancela. */
static constexpr uint32_t SESSION_REQUEST_TIMEOUT_MS = 12000;

/** 1 = imprime estadísticas de audio cada segundo durante la conversación. */
#define VOICE_DEBUG 1

static constexpr uint32_t SAMPLE_RATE = 16000;
static constexpr uint32_t BYTES_PER_MS = SAMPLE_RATE * 2 / 1000;
/** 20 ms de audio por frame binario hacia el backend. */
static constexpr size_t MIC_FRAME_SAMPLES = 320;
static constexpr size_t MIC_FRAME_BYTES = MIC_FRAME_SAMPLES * sizeof(int16_t);
/**
 * Colchón para la voz que llega por red (en PSRAM). OpenAI manda la respuesta
 * hasta 5x más rápido que tiempo real: con 8 s se llenaba en respuestas largas
 * y se tiraba audio (saltos/"picos"). 2 MB ≈ 65 s de voz.
 */
static constexpr size_t PLAY_BUFFER_BYTES = 2 * 1024 * 1024;
static constexpr size_t MIC_BUFFER_BYTES = 32 * 1024;
/**
 * Audio acumulado antes de empezar a sonar (y tras un corte). Más alto = más
 * fluido pero más retraso; 300 ms absorbe bien el jitter de WiFi + TLS.
 */
static constexpr size_t PLAY_PREBUFFER_BYTES = 300 * BYTES_PER_MS;
/** Si llega menos que el colchón (frase corta), suena igual tras esta espera. */
static constexpr uint32_t PREBUFFER_MAX_WAIT_MS = 250;
/** Mic en silencio mientras suena la bocina (+cola), para no oírse a sí mismo. */
static constexpr uint32_t ECHO_HOLD_MS = 400;
/**
 * Tras este silencio se apaga el reloj I2S: sin BCLK el MAX98357A entra en
 * shutdown y deja de sisear. Largo para no cortar entre frases.
 */
static constexpr uint32_t AMP_IDLE_OFF_MS = 700;

/**
 * Interfón (el dueño habla directo, sin IA): frases cortas de persona a
 * persona, así que se baja la latencia. La voz llega a ritmo real (no en
 * ráfagas como la de OpenAI), por eso basta un colchón chico.
 */
static constexpr size_t INTERCOM_PREBUFFER_BYTES = 120 * BYTES_PER_MS;
static constexpr uint32_t INTERCOM_PREBUFFER_MAX_WAIT_MS = 80;
static constexpr uint32_t INTERCOM_ECHO_HOLD_MS = 250;
static constexpr uint32_t INTERCOM_AMP_IDLE_OFF_MS = 350;
/**
 * Volumen 0..256 (256 = sin cambio). La voz de OpenAI viene casi a escala
 * completa; cerca de 256 el MAX98357A (9 dB de ganancia) satura y pita.
 */
static constexpr int32_t VOLUME = 200;
/** Rampa al arrancar a sonar (y tras cada hueco) para que no truene. */
static constexpr uint32_t FADE_IN_SAMPLES = SAMPLE_RATE / 50;
/** Rampa de salida cuando se acaba el audio: evita el chasquido del corte a 0. */
static constexpr uint32_t FADE_OUT_SAMPLES = SAMPLE_RATE / 200;

enum class VoiceState : uint8_t { Idle, Requesting, Live };

static const char *stateName(VoiceState s)
{
    switch (s) {
    case VoiceState::Idle:
        return "idle";
    case VoiceState::Requesting:
        return "pidiendo";
    case VoiceState::Live:
        return "en vivo";
    }
    return "?";
}

static WebSocketsClient voiceWs;
static bool voiceStarted = false;
static volatile bool wsConnected = false;
static volatile VoiceState state = VoiceState::Idle;
static volatile uint32_t lastPlayMs = 0;
static volatile bool flushPlayback = false;
/** El server avisa con display.set cuando Jarvis habla (half-duplex). */
static volatile bool serverSpeaking = false;
/** Bocina prendida: el mic se silencia (levanta la interferencia del amp). */
static volatile bool ampRunning = false;
/** El server avisó `intercom.start`: modo de baja latencia. */
static volatile bool intercomMode = false;

static size_t prebufferBytes() { return intercomMode ? INTERCOM_PREBUFFER_BYTES : PLAY_PREBUFFER_BYTES; }
static uint32_t prebufferMaxWaitMs() { return intercomMode ? INTERCOM_PREBUFFER_MAX_WAIT_MS : PREBUFFER_MAX_WAIT_MS; }
static uint32_t echoHoldMs() { return intercomMode ? INTERCOM_ECHO_HOLD_MS : ECHO_HOLD_MS; }
static uint32_t ampIdleOffMs() { return intercomMode ? INTERCOM_AMP_IDLE_OFF_MS : AMP_IDLE_OFF_MS; }

/** Contadores para los logs; se reinician cada segundo. */
struct VoiceStats {
    volatile uint32_t rxBytes = 0;
    volatile uint32_t rxChunks = 0;
    volatile uint32_t rxDropped = 0;
    volatile uint32_t txFrames = 0;
    volatile uint32_t underruns = 0;
    volatile uint32_t i2sShort = 0;
    volatile int32_t micPeak = 0;
    volatile uint32_t maxBufMs = 0;
    volatile uint32_t txFailed = 0;
    volatile uint32_t oddChunks = 0;
    // Piso de ruido del mic (24 bits tras pasa-altas) para el monitor de salud.
    volatile float micSumSq = 0;
    volatile uint32_t micN = 0;
};
static VoiceStats stats;
static uint32_t sessionRequestMs = 0;
static bool firstAudioLogged = false;

static StreamBufferHandle_t playBuf = nullptr;
static StreamBufferHandle_t micBuf = nullptr;
static StaticStreamBuffer_t playBufStruct;
static StaticStreamBuffer_t micBufStruct;

static void setState(VoiceState next, const char *why)
{
    if (state == next) {
        return;
    }
    Serial.printf("voz: estado %s -> %s (%s)\n", stateName(state), stateName(next),
                  why);
    state = next;
}

static bool installMic()
{
    i2s_config_t cfg = {};
    cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
    cfg.sample_rate = SAMPLE_RATE;
    cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;
    // Se leen los dos canales: el INMP441 manda por L o R según su pin L/R.
    cfg.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;
    cfg.communication_format = MIC_FORMAT;
    cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
    cfg.dma_buf_count = 8;
    cfg.dma_buf_len = 320;

    i2s_pin_config_t pins = {};
    pins.mck_io_num = I2S_PIN_NO_CHANGE;
    pins.bck_io_num = MIC_SCK;
    pins.ws_io_num = MIC_WS;
    pins.data_out_num = I2S_PIN_NO_CHANGE;
    pins.data_in_num = MIC_SD;

    if (i2s_driver_install(MIC_I2S_PORT, &cfg, 0, nullptr) != ESP_OK ||
        i2s_set_pin(MIC_I2S_PORT, &pins) != ESP_OK) {
        return false;
    }
    gpio_set_drive_capability((gpio_num_t)MIC_SCK, MIC_CLK_DRIVE);
    gpio_set_drive_capability((gpio_num_t)MIC_WS, MIC_CLK_DRIVE);
    return true;
}

static bool installSpeaker()
{
    i2s_config_t cfg = {};
    cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX);
    cfg.sample_rate = SAMPLE_RATE;
    cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
    cfg.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;
    cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
    cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
    // 12 × 256 frames ≈ 190 ms en DMA: aguanta pausas de la tarea sin cortes.
    cfg.dma_buf_count = 12;
    cfg.dma_buf_len = 256;
    // Sin datos el DMA manda ceros: silencio en vez de ruido.
    cfg.tx_desc_auto_clear = true;

    i2s_pin_config_t pins = {};
    pins.mck_io_num = I2S_PIN_NO_CHANGE;
    pins.bck_io_num = AMP_BCLK;
    pins.ws_io_num = AMP_LRC;
    pins.data_out_num = AMP_DIN;
    pins.data_in_num = I2S_PIN_NO_CHANGE;

    if (i2s_driver_install(AMP_I2S_PORT, &cfg, 0, nullptr) != ESP_OK ||
        i2s_set_pin(AMP_I2S_PORT, &pins) != ESP_OK) {
        return false;
    }
    i2s_zero_dma_buffer(AMP_I2S_PORT);
    i2s_stop(AMP_I2S_PORT);
    return true;
}

static StreamBufferHandle_t createPsramStream(size_t bytes,
                                              StaticStreamBuffer_t *storage)
{
    uint8_t *mem = (uint8_t *)heap_caps_malloc(bytes + 1, MALLOC_CAP_SPIRAM);
    if (mem == nullptr) {
        return nullptr;
    }
    return xStreamBufferCreateStatic(bytes, 1, mem, storage);
}

static void ampOnOff(bool &ampOn, bool want)
{
    if (ampOn == want) {
        return;
    }
    i2s_zero_dma_buffer(AMP_I2S_PORT);
    if (want) {
        i2s_start(AMP_I2S_PORT);
    } else {
        i2s_stop(AMP_I2S_PORT);
    }
    ampOn = want;
    ampRunning = want;
    Serial.printf("voz: amplificador %s\n", want ? "ON" : "OFF");
}

/** Saca la voz de Jarvis del buffer y la manda a la bocina (mono → estéreo). */
static void playbackTask(void *)
{
    int16_t mono[256];
    int16_t stereo[512];
    bool playing = false;
    bool ampOn = false;
    uint32_t waitStartMs = 0;
    uint32_t fadePos = FADE_IN_SAMPLES;

    for (;;) {
        if (flushPlayback) {
            xStreamBufferReset(playBuf);
            ampOnOff(ampOn, false);
            flushPlayback = false;
            playing = false;
            waitStartMs = 0;
        }

        if (!playing) {
            const size_t avail = xStreamBufferBytesAvailable(playBuf);
            if (avail == 0) {
                if (ampOn && millis() - lastPlayMs > ampIdleOffMs()) {
                    ampOnOff(ampOn, false);
                }
                waitStartMs = 0;
                vTaskDelay(pdMS_TO_TICKS(5));
                continue;
            }
            // Junta colchón antes de sonar; una frase corta suena tras la espera.
            if (avail < prebufferBytes()) {
                if (waitStartMs == 0) {
                    waitStartMs = millis();
                }
                if (millis() - waitStartMs < prebufferMaxWaitMs()) {
                    vTaskDelay(pdMS_TO_TICKS(5));
                    continue;
                }
            }
            waitStartMs = 0;
            playing = true;
            fadePos = 0;
            ampOnOff(ampOn, true);
#if VOICE_DEBUG
            Serial.printf("voz: reproduciendo (colchon %u ms)\n",
                          (unsigned)(avail / BYTES_PER_MS));
#endif
        }

        // El DMA tiene ~190 ms; esperar 40 ms por datos no deja hueco audible.
        const size_t got =
            xStreamBufferReceive(playBuf, mono, sizeof(mono), pdMS_TO_TICKS(40));
        if (got == 0) {
            // Se acabó el audio: o terminó la frase o la red se atrasó.
            playing = false;
            if (serverSpeaking) {
                stats.underruns++;
            }
            continue;
        }

        const size_t samples = got / sizeof(int16_t);
        // Si con este bloque se vacía el buffer, la cola baja a 0 suave.
        const bool lastBlock = xStreamBufferBytesAvailable(playBuf) == 0;
        const size_t fadeOutFrom =
            lastBlock && samples > FADE_OUT_SAMPLES ? samples - FADE_OUT_SAMPLES : samples;
        for (size_t i = 0; i < samples; i++) {
            int32_t s = (mono[i] * VOLUME) >> 8;
            if (fadePos < FADE_IN_SAMPLES) {
                s = s * (int32_t)fadePos / (int32_t)FADE_IN_SAMPLES;
                fadePos++;
            }
            if (i >= fadeOutFrom) {
                s = s * (int32_t)(samples - i) / (int32_t)FADE_OUT_SAMPLES;
            }
            stereo[2 * i] = (int16_t)s;
            stereo[2 * i + 1] = (int16_t)s;
        }
        size_t written = 0;
        const size_t bytes = samples * 2 * sizeof(int16_t);
        i2s_write(AMP_I2S_PORT, stereo, bytes, &written, pdMS_TO_TICKS(300));
        if (written != bytes) {
            stats.i2sShort++;
        }
        lastPlayMs = millis();
    }
}

/** Slot del mic dentro del par estéreo: -1 = el mic no responde. */
static volatile int micChannel = -1;

/** Muestra de 24 bits con signo desde el slot de 32 bits. */
static inline int32_t micSample24(int32_t raw)
{
    return (int32_t)((uint32_t)raw << MIC_BIT_SHIFT) >> 8;
}

/** Cuántos valores distintos (hasta 32) da cada slot con el pull indicado. */
static void countDistinct(bool pullUp, uint32_t distinct[2], int32_t first[2])
{
    if (pullUp) {
        gpio_pulldown_dis((gpio_num_t)MIC_SD);
        gpio_pullup_en((gpio_num_t)MIC_SD);
    } else {
        gpio_pullup_dis((gpio_num_t)MIC_SD);
        gpio_pulldown_en((gpio_num_t)MIC_SD);
    }
    static int32_t raw[MIC_FRAME_SAMPLES * 2];
    int32_t seen[2][32];
    distinct[0] = distinct[1] = 0;
    for (int block = 0; block < 12; block++) {
        size_t bytesRead = 0;
        i2s_read(MIC_I2S_PORT, raw, sizeof(raw), &bytesRead, pdMS_TO_TICKS(100));
        if (block < 4) {
            continue; // arranque del mic y del pull
        }
        for (size_t i = 0; i < bytesRead / sizeof(int32_t); i++) {
            const int ch = i & 1;
            const int32_t v = micSample24(raw[i]);
            if (distinct[ch] == 0) {
                first[ch] = v;
            }
            bool known = false;
            for (uint32_t k = 0; k < distinct[ch]; k++) {
                if (seen[ch][k] == v) {
                    known = true;
                    break;
                }
            }
            if (!known && distinct[ch] < 32) {
                seen[ch][distinct[ch]++] = v;
            }
        }
    }
    gpio_pullup_dis((gpio_num_t)MIC_SD);
    gpio_pulldown_dis((gpio_num_t)MIC_SD);
}

/**
 * El INMP441 solo maneja SD en su slot; en el otro la línea flota. Con pull-up
 * y luego pull-down, el slot sin mic da un solo valor que sigue al pull; el
 * slot con mic da muchos valores. (Contar "distinto de cero" no sirve: un SD
 * suelto levanta interferencia y también da distinto de cero.)
 */
static void detectMicChannel()
{
    uint32_t up[2], down[2];
    int32_t upFirst[2] = {0, 0}, downFirst[2] = {0, 0};
    countDistinct(true, up, upFirst);
    countDistinct(false, down, downFirst);
    Serial.printf("mic: slot0 distintos up=%lu down=%lu | slot1 distintos up=%lu down=%lu\n",
                  (unsigned long)up[0], (unsigned long)down[0], (unsigned long)up[1],
                  (unsigned long)down[1]);

    int best = -1;
    for (int ch = 0; ch < 2; ch++) {
        if (up[ch] > 4 && down[ch] > 4 && (best < 0 || up[ch] > up[best])) {
            best = ch;
        }
    }
    micChannel = best;
    if (best < 0) {
        Serial.println("mic: !!! EL MIC NO RESPONDE (SD sigue al pull). Revisa VDD 3.3V, GND,"
                       " SD->21, SCK->40, WS->39, L/R->GND y que los pines esten soldados."
                       " No se mandara audio del mic.");
    } else {
        Serial.printf("mic: OK en slot %d\n", best);
    }
}

/** Lee el mic en bloques de 20 ms y los deja en PCM16 para `voiceLoop()`. */
static void micTask(void *)
{
    static int32_t raw[MIC_FRAME_SAMPLES * 2];
    static int16_t pcm[MIC_FRAME_SAMPLES];
    float hpIn = 0, hpOut = 0;

    detectMicChannel();

    for (;;) {
        size_t bytesRead = 0;
        i2s_read(MIC_I2S_PORT, raw, sizeof(raw), &bytesRead, portMAX_DELAY);
        const size_t n = bytesRead / sizeof(int32_t) / 2;
        const int ch = micChannel;
        if (ch < 0) {
            continue; // sin mic no se manda basura al server
        }

        int32_t peak = 0;
        float sumSq = 0;
        for (size_t i = 0; i < n; i++) {
            const float x = (float)micSample24(raw[2 * i + ch]);
            const float y = MIC_HPF_ALPHA * (hpOut + x - hpIn);
            hpIn = x;
            hpOut = y;
            sumSq += y * y;
            // 24 → 16 bits con ganancia 2^MIC_GAIN_SHIFT.
            const int32_t s = constrain((int32_t)(y / (1 << (8 - MIC_GAIN_SHIFT))), -32767, 32767);
            pcm[i] = (int16_t)s;
            peak = max(peak, abs(s));
        }
        if (peak > stats.micPeak) {
            stats.micPeak = peak;
        }
        if (!ampRunning) {
            stats.micSumSq = stats.micSumSq + sumSq;
            stats.micN = stats.micN + n;
        }

        // Solo se manda audio en conversación y sin la bocina sonando: con el
        // amplificador prendido el mic levanta su interferencia.
        if (state != VoiceState::Live || serverSpeaking || ampRunning ||
            millis() - lastPlayMs < echoHoldMs()) {
            continue;
        }
        xStreamBufferSend(micBuf, pcm, n * sizeof(int16_t), 0);
    }
}

/** Piso de ruido del mic en dBFS (24 bits) del último segundo. */
static float micNoiseDbfs()
{
    if (stats.micN == 0) {
        return -120.0f;
    }
    const float rms = sqrtf(stats.micSumSq / stats.micN);
    return rms <= 0 ? -120.0f : 20.0f * log10f(rms / 8388608.0f);
}

/** Avisa si el mic trae datos corruptos estando en silencio. */
static void checkMicHealth()
{
    static uint8_t badSeconds = 0;
    static uint32_t lastWarnMs = 0;
    if (micChannel < 0 || stats.micN == 0 || state == VoiceState::Live) {
        badSeconds = 0;
        return;
    }
    const float db = micNoiseDbfs();
    badSeconds = db > MIC_UNHEALTHY_DBFS ? badSeconds + 1 : 0;
    if (badSeconds >= 5 && millis() - lastWarnMs > 60000) {
        lastWarnMs = millis();
        Serial.printf("mic: !!! piso de ruido %.1f dBFS en reposo (sano: -75..-55). Datos"
                      " corruptos: cables del mic largos/rebote en SCK. Corre mic-test (c).\n",
                      db);
    }
}

static bool isType(const char *json, const char *type)
{
    char needle[48];
    snprintf(needle, sizeof(needle), "\"type\":\"%s\"", type);
    return strstr(json, needle) != nullptr;
}

static void endSessionLocal(const char *why)
{
    setState(VoiceState::Idle, why);
    serverSpeaking = false;
    intercomMode = false;
    flushPlayback = true;
    xStreamBufferReset(micBuf);
}

static void handleText(const char *json)
{
    Serial.printf("voz <- %s\n", json);

    if (isType(json, "session.ready")) {
        setState(VoiceState::Live, "session.ready");
        serverSpeaking = false;
        firstAudioLogged = false;
        Serial.printf("voz: >>> SESION LISTA en %lu ms, habla ahora <<<\n",
                      (unsigned long)(millis() - sessionRequestMs));
    } else if (isType(json, "display.set")) {
        const bool speaking = strstr(json, "\"speaking\"") != nullptr;
        if (speaking != serverSpeaking) {
            Serial.printf("voz: %s\n", speaking ? "Jarvis HABLANDO (mic en mute)"
                                                : "Jarvis ESCUCHANDO (mic abierto)");
        }
        serverSpeaking = speaking;
    } else if (isType(json, "intercom.start")) {
        intercomMode = true;
        Serial.println("voz: >>> INTERFON: hablas directo con el dueno (baja latencia)");
    } else if (isType(json, "intercom.end")) {
        intercomMode = false;
        Serial.println("voz: interfon terminado, regresa la IA");
    } else if (isType(json, "inbound.start")) {
        sessionRequestMs = millis();
        setState(VoiceState::Requesting, "inbound.start");
    } else if (isType(json, "session.end")) {
        endSessionLocal("session.end del server");
    } else if (isType(json, "error")) {
        Serial.println("voz: !!! ERROR del server (ver mensaje arriba)");
        if (state == VoiceState::Requesting) {
            // Le pedimos cerrar por si quedó una llamada a medias ("Already in a call").
            voiceWs.sendTXT("{\"type\":\"session.end\",\"reason\":\"client_error\"}");
            endSessionLocal("error al pedir sesion");
        }
    }
}

static void onVoiceEvent(WStype_t type, uint8_t *payload, size_t length)
{
    switch (type) {
    case WStype_DISCONNECTED:
        if (wsConnected) {
            Serial.println("voz: WS desconectado");
        }
        wsConnected = false;
        if (state != VoiceState::Idle) {
            endSessionLocal("WS desconectado");
        }
        break;
    case WStype_CONNECTED:
        wsConnected = true;
        Serial.printf("voz: WS conectado (%.*s)\n", (int)length, (const char *)payload);
        voiceWs.sendTXT("{\"type\":\"hello\",\"firmwareVersion\":\"0.7.0-cam\","
                        "\"capabilities\":[\"audio\"]}");
        break;
    case WStype_TEXT: {
        char buf[384];
        const size_t n = length < sizeof(buf) - 1 ? length : sizeof(buf) - 1;
        memcpy(buf, payload, n);
        buf[n] = '\0';
        handleText(buf);
        break;
    }
    case WStype_BIN:
        if (state == VoiceState::Idle) {
            break;
        }
        if (!firstAudioLogged) {
            firstAudioLogged = true;
            Serial.printf("voz: primer audio de Jarvis (%u bytes)\n", (unsigned)length);
        }
        // PCM16 = 2 bytes por muestra. Un chunk impar recorrería todo lo que
        // sigue un byte y solo se oiría ruido: se descarta el byte suelto.
        if (length & 1) {
            stats.oddChunks++;
            length--;
        }
        stats.rxChunks++;
        stats.rxBytes += length;
        // Solo chunks completos: meter medio chunk deja un salto audible.
        if (length > 0) {
            if (xStreamBufferSpacesAvailable(playBuf) < length) {
                stats.rxDropped += length;
            } else {
                xStreamBufferSend(playBuf, payload, length, 0);
            }
        }
        {
            const uint32_t bufMs = xStreamBufferBytesAvailable(playBuf) / BYTES_PER_MS;
            if (bufMs > stats.maxBufMs) {
                stats.maxBufMs = bufMs;
            }
        }
        break;
    case WStype_ERROR:
        Serial.printf("voz: WS error %.*s\n", (int)length, (const char *)payload);
        break;
    default:
        break;
    }
}

/** Una línea por segundo con todo lo que pasa en el audio. */
static void logStats()
{
#if VOICE_DEBUG
    static uint32_t lastMs = 0;
    const uint32_t now = millis();
    if (now - lastMs < 1000) {
        return;
    }
    const uint32_t dt = now - lastMs;
    lastMs = now;

    checkMicHealth();
    if (state == VoiceState::Idle) {
        stats = VoiceStats();
        return;
    }

    Serial.printf(
        "voz[%s%s] rx=%lu ms de audio (%lu chunks) buf=%u ms max=%lu | tx=%lu frames"
        " | mic pico=%ld piso=%.0fdBFS | cortes=%lu i2s_lento=%lu perdidos=%lu B"
        " tx_fallo=%lu impares=%lu | heap=%u psram=%u\n",
        stateName(state), serverSpeaking ? ",habla" : ",escucha",
        (unsigned long)(stats.rxBytes / BYTES_PER_MS * 1000 / dt),
        (unsigned long)stats.rxChunks,
        (unsigned)(xStreamBufferBytesAvailable(playBuf) / BYTES_PER_MS),
        (unsigned long)stats.maxBufMs, (unsigned long)stats.txFrames,
        (long)stats.micPeak, micNoiseDbfs(), (unsigned long)stats.underruns,
        (unsigned long)stats.i2sShort, (unsigned long)stats.rxDropped,
        (unsigned long)stats.txFailed, (unsigned long)stats.oddChunks,
        (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getFreePsram());
    stats = VoiceStats();
#endif
}

bool voiceBegin()
{
    playBuf = createPsramStream(PLAY_BUFFER_BYTES, &playBufStruct);
    micBuf = createPsramStream(MIC_BUFFER_BYTES, &micBufStruct);
    if (playBuf == nullptr || micBuf == nullptr) {
        Serial.println("voz: sin PSRAM para buffers");
        return false;
    }
    if (!installSpeaker()) {
        Serial.println("voz: ERROR I2S altavoz");
        return false;
    }
    if (!installMic()) {
        Serial.println("voz: ERROR I2S microfono");
        return false;
    }

    // Prioridad alta en el core 1: el audio no debe esperar al loop de la cámara.
    xTaskCreatePinnedToCore(playbackTask, "voice_play", 6144, nullptr, 10,
                            nullptr, 1);
    xTaskCreatePinnedToCore(micTask, "voice_mic", 6144, nullptr, 9, nullptr, 1);
    Serial.println("voz: audio OK (mic 40/39/21, amp 47/48/1, 16 kHz)");
    return true;
}

void voiceConnect(const char *host, uint16_t port, const char *token, bool tls)
{
    char path[192];
    snprintf(path, sizeof(path), "/devices?token=%s", token);

    voiceWs.onEvent(onVoiceEvent);
    voiceWs.setReconnectInterval(5000);
    // Ping para detectar conexiones muertas sin esperar al TCP.
    voiceWs.enableHeartbeat(15000, 5000, 2);
    if (tls) {
        voiceWs.beginSSL(host, port, path);
    } else {
        voiceWs.begin(host, port, path);
    }
    voiceStarted = true;
    Serial.printf("voz: conectando a %s://%s:%u/devices\n", tls ? "wss" : "ws", host,
                  (unsigned)port);
}

void voiceLoop()
{
    if (!voiceStarted) {
        return;
    }
    voiceWs.loop();
    logStats();

    if (state == VoiceState::Requesting &&
        millis() - sessionRequestMs > SESSION_REQUEST_TIMEOUT_MS) {
        Serial.println("voz: !!! el server no contesto session.ready a tiempo");
        voiceWs.sendTXT("{\"type\":\"session.end\",\"reason\":\"timeout\"}");
        endSessionLocal("timeout esperando session.ready");
    }

    if (!wsConnected || state != VoiceState::Live) {
        return;
    }

    uint8_t frame[MIC_FRAME_BYTES];
    while (xStreamBufferBytesAvailable(micBuf) >= MIC_FRAME_BYTES) {
        xStreamBufferReceive(micBuf, frame, sizeof(frame), 0);
        if (voiceWs.sendBIN(frame, sizeof(frame))) {
            stats.txFrames++;
        } else {
            stats.txFailed++;
        }
    }
}

void voiceToggleSession()
{
    Serial.printf("voz: boton (estado=%s, ws=%s)\n", stateName(state),
                  wsConnected ? "conectado" : "DESCONECTADO");
    if (!wsConnected) {
        Serial.println("voz: !!! sin conexion al backend, no se puede hablar");
        return;
    }
    if (state == VoiceState::Idle) {
        sessionRequestMs = millis();
        setState(VoiceState::Requesting, "boton");
        voiceWs.sendTXT("{\"type\":\"session.request\",\"reason\":\"button\"}");
        Serial.println("voz -> session.request (esperando session.ready...)");
    } else {
        voiceWs.sendTXT("{\"type\":\"session.end\",\"reason\":\"button\"}");
        Serial.println("voz -> session.end");
        endSessionLocal("colgaste con el boton");
    }
}

bool voiceInSession()
{
    return state != VoiceState::Idle;
}
