// =====================================================================
//  PRUEBA DEL AMPLIFICADOR MAX98357A + BOCINA 4 Ω / 3 W
// =====================================================================
//
//  Cableado (datasheet Analog Devices MAX98357A):
//    VIN  -> 5V  (2.5–5.5 V; a 5 V da ~3.2 W en 4 Ω)      GND -> GND común
//    BCLK -> GPIO47    LRC -> GPIO48    DIN -> GPIO1
//      (NO GPIO45: es pin de arranque y bloquea la subida del firmware)
//    SD   -> sin conectar o 3.3V (encendido, mezcla L+R)
//    GAIN -> sin conectar = 9 dB | a VDD = 6 dB | a GND = 12 dB
//    OUT+ / OUT- -> bocina. NUNCA conectes OUT- a GND.
//  Recomendado: 100 µF + 0.1 µF entre VIN y GND pegados al módulo.
//
//  Estándar de audio de Jarvis: PCM16 LE mono 16 kHz. Antes del I2S se
//  duplica a L/R y sale como I2S Philips 16 bits estéreo.
//  El MAX98357A NO soporta 12, 22.05 ni 24 kHz.
//
//  Orden recomendado:  0 silencio → 1 tono → 2 escalera → 4/5 archivos →
//                      6 streaming tipo Jarvis → w WiFi → l loopback mic
//  Comandos: letra + Enter. Cualquier tecla detiene lo que está sonando.
// =====================================================================
#include <Arduino.h>
#include <LittleFS.h>
#include <WiFi.h>
#include <math.h>
#include <freertos/stream_buffer.h>
#include "driver/i2s.h"

#if __has_include("secrets.h")
#include "secrets.h"
#endif

#define AMP_PORT I2S_NUM_1
#define AMP_BCLK 47
#define AMP_LRC 48
#define AMP_DIN 1

#define MIC_PORT I2S_NUM_0
#define MIC_SCK 40
#define MIC_WS 39
#define MIC_SD 21

static uint32_t ampRate = 16000;
/** Volumen de software inicial (bajo para no aturdir; sube con +). */
static int volumePct = 25;
static bool fsOk = false;

// ---------------------------------------------------------------------
// Salida al amplificador con medición
// ---------------------------------------------------------------------

struct OutStats {
    int32_t peak = 0;
    uint32_t clips = 0;    // muestras que tocaron ±32767 después del volumen
    uint32_t written = 0;  // frames
    uint32_t shortWrites = 0;
};
static OutStats outStats;
static uint32_t lastReportMs = 0;

static bool isSupportedRate(uint32_t r)
{
    return r == 8000 || r == 16000 || r == 32000 || r == 44100 || r == 48000 ||
           r == 88200 || r == 96000;
}

static bool installAmp()
{
    i2s_config_t cfg = {};
    cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX);
    cfg.sample_rate = ampRate;
    cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
    cfg.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;
    cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
    cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
    cfg.dma_buf_count = 12;
    cfg.dma_buf_len = 256;
    cfg.tx_desc_auto_clear = true; // sin datos → ceros (silencio)

    i2s_pin_config_t pins = {};
    pins.mck_io_num = I2S_PIN_NO_CHANGE;
    pins.bck_io_num = AMP_BCLK;
    pins.ws_io_num = AMP_LRC;
    pins.data_out_num = AMP_DIN;
    pins.data_in_num = I2S_PIN_NO_CHANGE;

    if (i2s_driver_install(AMP_PORT, &cfg, 0, nullptr) != ESP_OK ||
        i2s_set_pin(AMP_PORT, &pins) != ESP_OK) {
        return false;
    }
    i2s_zero_dma_buffer(AMP_PORT);
    i2s_stop(AMP_PORT); // sin BCLK el MAX98357A se apaga solo: cero siseo
    return true;
}

static bool setRate(uint32_t rate)
{
    if (!isSupportedRate(rate)) {
        Serial.printf("!!! %lu Hz NO lo soporta el MAX98357A (usa 16000/32000/44100/48000)\n",
                      (unsigned long)rate);
        return false;
    }
    if (rate != ampRate) {
        i2s_set_clk(AMP_PORT, rate, I2S_BITS_PER_SAMPLE_16BIT, I2S_CHANNEL_STEREO);
        ampRate = rate;
    }
    return true;
}

static void ampStart()
{
    outStats = OutStats();
    lastReportMs = millis();
    i2s_zero_dma_buffer(AMP_PORT);
    i2s_start(AMP_PORT);
    Serial.printf("  [amp ON  %lu Hz, BCLK=%lu Hz, volumen %d%%]\n", (unsigned long)ampRate,
                  (unsigned long)(ampRate * 32), volumePct);
}

static void ampStop()
{
    // Un poco de ceros para vaciar el DMA sin chasquido.
    delay(60);
    i2s_zero_dma_buffer(AMP_PORT);
    i2s_stop(AMP_PORT);
    Serial.printf("  [amp OFF] pico=%.1f dBFS recortes=%lu escrituras_lentas=%lu\n",
                  outStats.peak ? 20 * log10f(outStats.peak / 32768.0f) : -120.0f,
                  (unsigned long)outStats.clips, (unsigned long)outStats.shortWrites);
}

/** Una tecla (no Enter) detiene lo que suena. */
static bool userAbort()
{
    while (Serial.available()) {
        const char c = Serial.read();
        if (c != '\r' && c != '\n' && c != ' ') {
            while (Serial.available()) Serial.read();
            Serial.println("  (detenido)");
            return true;
        }
    }
    return false;
}

static void reportProgress()
{
    if (millis() - lastReportMs < 1000) {
        return;
    }
    lastReportMs = millis();
    Serial.printf("    t=%5.1f s  pico=%6.1f dBFS  recortes=%lu\n",
                  outStats.written / (float)ampRate,
                  outStats.peak ? 20 * log10f(outStats.peak / 32768.0f) : -120.0f,
                  (unsigned long)outStats.clips);
}

/**
 * Escribe audio al amp aplicando volumen. `channels` = 1 (se duplica a L/R)
 * o 2 (ya viene intercalado).
 */
static void writeAudio(const int16_t *in, size_t frames, int channels)
{
    static int16_t out[512];
    const int32_t gain = volumePct * 256 / 100; // Q8
    size_t done = 0;
    while (done < frames) {
        const size_t chunk = min((size_t)256, frames - done);
        for (size_t i = 0; i < chunk; i++) {
            for (int c = 0; c < 2; c++) {
                const int16_t src = in[(done + i) * channels + (channels == 2 ? c : 0)];
                int32_t v = (src * gain) >> 8;
                if (v >= 32767 || v <= -32768) {
                    outStats.clips++;
                    v = constrain(v, -32768, 32767);
                }
                outStats.peak = max(outStats.peak, abs(v));
                out[2 * i + c] = (int16_t)v;
            }
        }
        size_t written = 0;
        i2s_write(AMP_PORT, out, chunk * 4, &written, pdMS_TO_TICKS(500));
        if (written != chunk * 4) {
            outStats.shortWrites++;
        }
        outStats.written += chunk;
        done += chunk;
    }
    reportProgress();
}

// ---------------------------------------------------------------------
// Generadores
// ---------------------------------------------------------------------

/** Tono (o barrido si f1 != f0) a un nivel en dBFS, con rampa anti-chasquido. */
static bool playTone(float f0, float f1, float dbfs, uint32_t ms)
{
    const float amp = 32767.0f * powf(10.0f, dbfs / 20.0f);
    const uint32_t total = ampRate * ms / 1000;
    const uint32_t fade = ampRate / 100;
    static int16_t buf[256];
    float phase = 0;
    for (uint32_t n = 0; n < total;) {
        size_t k = 0;
        for (; k < 256 && n < total; k++, n++) {
            const float f = f0 + (f1 - f0) * n / total;
            phase += 2.0f * PI * f / ampRate;
            if (phase > 2.0f * PI) phase -= 2.0f * PI;
            float env = 1;
            if (n < fade) env = (float)n / fade;
            else if (total - n < fade) env = (float)(total - n) / fade;
            buf[k] = (int16_t)(amp * env * sinf(phase));
        }
        writeAudio(buf, k, 1);
        if (userAbort()) return false;
    }
    return true;
}

static void testSilence()
{
    Serial.println();
    Serial.println("== 0. SILENCIO DIGITAL (amp prendido mandando CEROS 5 s) ==");
    Serial.println("Debe oirse NADA (quiza un siseo minimo pegando la oreja).");
    Serial.println("Si oyes zumbido, pitidos o 'tic-tic' -> es FISICO: alimentacion, GND,");
    Serial.println("GAIN/SD, cables largos o interferencia. NO es la IA ni el audio.");
    static int16_t zeros[256] = {0};
    ampStart();
    const uint32_t frames = ampRate * 5;
    for (uint32_t n = 0; n < frames; n += 256) {
        writeAudio(zeros, 256, 1);
        if (userAbort()) break;
    }
    ampStop();
}

static void testTone()
{
    Serial.println();
    Serial.println("== 1. TONO 1 kHz a -12 dBFS (3 s) ==");
    Serial.println("Debe ser un tono PURO y estable. Si suena rasposo o con pitidos encima,");
    Serial.println("revisa alimentacion; si suena 'roto' baja GAIN (a VDD = 6 dB).");
    ampStart();
    playTone(1000, 1000, -12, 3000);
    ampStop();
}

static void testLadder()
{
    Serial.println();
    Serial.println("== 2. ESCALERA DE NIVEL 440 Hz: -30 -24 -18 -12 -6 -3 0 dBFS ==");
    Serial.println("Anota en que escalon empieza a distorsionar o pitar: ese es tu limite.");
    Serial.println("(Volumen de software al 50% para esta prueba)");
    const int saved = volumePct;
    volumePct = 50;
    const float steps[] = {-30, -24, -18, -12, -6, -3, 0};
    ampStart();
    for (float s : steps) {
        Serial.printf("  -> %.0f dBFS\n", s);
        if (!playTone(440, 440, s, 1500)) break;
        delay(150);
    }
    ampStop();
    volumePct = saved;
}

static void testSweep()
{
    Serial.println();
    Serial.println("== 3. BARRIDO 100 Hz -> 7 kHz a -12 dBFS (6 s) ==");
    Serial.println("Una bocina de 4 cm casi no da graves (<300 Hz): es normal que suene bajito ahi.");
    Serial.println("Si en alguna frecuencia vibra/zumba algo, es la caja o un cable flojo.");
    ampStart();
    playTone(100, 7000, -12, 6000);
    ampStop();
}

// ---------------------------------------------------------------------
// Archivos WAV en LittleFS
// ---------------------------------------------------------------------

struct WavInfo {
    uint32_t rate = 0;
    uint16_t channels = 0;
    uint16_t bits = 0;
    uint16_t format = 0;
    uint32_t dataOffset = 0;
    uint32_t dataBytes = 0;
};

static bool parseWav(File &f, WavInfo &w)
{
    uint8_t h[12];
    if (f.read(h, 12) != 12 || memcmp(h, "RIFF", 4) || memcmp(h + 8, "WAVE", 4)) {
        return false;
    }
    while (f.available()) {
        uint8_t ch[8];
        if (f.read(ch, 8) != 8) return false;
        const uint32_t size = ch[4] | ch[5] << 8 | ch[6] << 16 | (uint32_t)ch[7] << 24;
        if (!memcmp(ch, "fmt ", 4)) {
            uint8_t fmt[16];
            f.read(fmt, 16);
            w.format = fmt[0] | fmt[1] << 8;
            w.channels = fmt[2] | fmt[3] << 8;
            w.rate = fmt[4] | fmt[5] << 8 | fmt[6] << 16 | (uint32_t)fmt[7] << 24;
            w.bits = fmt[14] | fmt[15] << 8;
            f.seek(f.position() + size - 16);
        } else if (!memcmp(ch, "data", 4)) {
            w.dataOffset = f.position();
            w.dataBytes = size;
            return w.rate != 0;
        } else {
            f.seek(f.position() + size + (size & 1));
        }
    }
    return false;
}

static void listFiles()
{
    if (!fsOk) {
        Serial.println("Sin LittleFS: corre 'pio run -t uploadfs' para subir data/*.wav");
        return;
    }
    Serial.println("Archivos en la flash:");
    File root = LittleFS.open("/");
    for (File f = root.openNextFile(); f; f = root.openNextFile()) {
        WavInfo w;
        const bool ok = parseWav(f, w);
        if (ok) {
            const float secs = w.dataBytes / (float)(w.rate * w.channels * w.bits / 8);
            Serial.printf("  %-20s %6lu Hz %u ch %u bits  %.1f s%s\n", f.name(),
                          (unsigned long)w.rate, w.channels, w.bits, secs,
                          isSupportedRate(w.rate) ? "" : "  !!! rate NO soportado");
        } else {
            Serial.printf("  %-20s (no es WAV PCM)\n", f.name());
        }
    }
    Serial.printf("Usado %u / %u KB\n", (unsigned)(LittleFS.usedBytes() / 1024),
                  (unsigned)(LittleFS.totalBytes() / 1024));
}

static void playFile(const char *path)
{
    Serial.println();
    Serial.printf("== REPRODUCIENDO %s ==\n", path);
    if (!fsOk || !LittleFS.exists(path)) {
        Serial.printf("No existe %s. Generalo con tools/ y corre 'pio run -t uploadfs'\n", path);
        return;
    }
    File f = LittleFS.open(path);
    WavInfo w;
    if (!parseWav(f, w) || w.format != 1 || w.bits != 16 || w.channels < 1 || w.channels > 2) {
        Serial.println("!!! Debe ser WAV PCM 16 bits mono/estereo. Usa tools/convert_audio.sh");
        return;
    }
    Serial.printf("  %lu Hz, %u canal(es), %.1f s\n", (unsigned long)w.rate, w.channels,
                  w.dataBytes / (float)(w.rate * w.channels * 2));
    if (!setRate(w.rate)) {
        return;
    }
    f.seek(w.dataOffset);
    static int16_t buf[1024];
    uint32_t left = w.dataBytes;
    ampStart();
    while (left > 0) {
        const size_t want = min((uint32_t)sizeof(buf), left);
        const size_t got = f.read((uint8_t *)buf, want);
        if (got == 0) break;
        writeAudio(buf, got / 2 / w.channels, w.channels);
        left -= got;
        if (userAbort()) break;
    }
    ampStop();
    f.close();
    Serial.println("Si el archivo suena LIMPIO pero Jarvis suena con ruido -> el problema");
    Serial.println("esta en el stream (red, formato o buffer), no en el amp ni la bocina.");
}

// ---------------------------------------------------------------------
// 6. Streaming como Jarvis: chunks por "red" con ráfagas y huecos
// ---------------------------------------------------------------------

static StreamBufferHandle_t jitterBuf = nullptr;

static void testStreaming(const char *path)
{
    Serial.println();
    Serial.println("== 6. STREAMING SIMULADO TIPO JARVIS ==");
    Serial.println("Mismo camino que voice.cpp: chunks de 4800 B llegan en rafagas con");
    Serial.println("huecos aleatorios, colchon de 300 ms, y se reportan los cortes.");
    if (!fsOk || !LittleFS.exists(path)) {
        Serial.printf("No existe %s\n", path);
        return;
    }
    File f = LittleFS.open(path);
    WavInfo w;
    if (!parseWav(f, w) || w.bits != 16 || w.channels != 1 || !setRate(w.rate)) {
        Serial.println("!!! se necesita WAV mono 16 bits");
        return;
    }
    if (!jitterBuf) {
        uint8_t *mem = (uint8_t *)ps_malloc(256 * 1024 + 1);
        static StaticStreamBuffer_t st;
        jitterBuf = xStreamBufferCreateStatic(256 * 1024, 1, mem, &st);
    }
    xStreamBufferReset(jitterBuf);
    f.seek(w.dataOffset);

    const uint32_t bytesPerMs = w.rate * 2 / 1000;
    const size_t prebuffer = 300 * bytesPerMs;
    uint32_t left = w.dataBytes;
    uint32_t nextArrival = millis();
    uint32_t underruns = 0;
    bool playing = false;
    static uint8_t chunk[4800];
    static int16_t pcm[256];

    ampStart();
    while (left > 0 || xStreamBufferBytesAvailable(jitterBuf) > 0) {
        // "Red": cada cierto tiempo llega una ráfaga de 1–6 chunks.
        if (left > 0 && millis() >= nextArrival) {
            const int burst = 1 + random(6);
            for (int b = 0; b < burst && left > 0; b++) {
                const size_t got = f.read(chunk, min((uint32_t)sizeof(chunk), left));
                left -= got;
                xStreamBufferSend(jitterBuf, chunk, got, 0);
            }
            nextArrival = millis() + 100 + random(500); // huecos de 100–600 ms
        }
        if (!playing) {
            if (xStreamBufferBytesAvailable(jitterBuf) >= prebuffer || left == 0) {
                playing = true;
            } else {
                delay(5);
                continue;
            }
        }
        const size_t got = xStreamBufferReceive(jitterBuf, pcm, sizeof(pcm), 0);
        if (got == 0) {
            if (left > 0) {
                underruns++;
                Serial.printf("    corte #%lu: se acabo el colchon, rebuffer...\n",
                              (unsigned long)underruns);
                playing = false;
            }
            continue;
        }
        writeAudio(pcm, got / 2, 1);
        if (userAbort()) break;
    }
    ampStop();
    Serial.printf("Cortes: %lu (cada corte = hueco audible; con red real deberia ser 0)\n",
                  (unsigned long)underruns);
}

// ---------------------------------------------------------------------
// w. WiFi con tráfico (interferencia en la alimentación)
// ---------------------------------------------------------------------

static volatile bool trafficOn = false;

static void trafficTask(void *)
{
    WiFiClient c;
    for (;;) {
        if (!trafficOn || WiFi.status() != WL_CONNECTED) {
            vTaskDelay(pdMS_TO_TICKS(50));
            continue;
        }
#ifdef JARVIS_BACKEND_HOST
        if (c.connect(JARVIS_BACKEND_HOST, 80)) {
            c.print("GET / HTTP/1.1\r\nHost: " JARVIS_BACKEND_HOST "\r\nConnection: close\r\n\r\n");
            const uint32_t t0 = millis();
            while (c.connected() && millis() - t0 < 800) {
                while (c.available()) c.read();
                vTaskDelay(1);
            }
            c.stop();
        }
#endif
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

static void testWifi()
{
    Serial.println();
    Serial.println("== W. MISMO TONO Y SILENCIO, AHORA CON WIFI TRANSMITIENDO ==");
#ifndef WIFI_SSID
    Serial.println("No hay secrets.h con WIFI_SSID; se salta.");
    return;
#else
    if (WiFi.status() != WL_CONNECTED) {
        WiFi.mode(WIFI_STA);
        WiFi.setSleep(false);
        WiFi.begin(WIFI_SSID, WIFI_PASS);
        for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
    }
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("WiFi no conecto");
        return;
    }
    static bool taskStarted = false;
    if (!taskStarted) {
        xTaskCreatePinnedToCore(trafficTask, "traffic", 4096, nullptr, 1, nullptr, 0);
        taskStarted = true;
    }
    trafficOn = true;
    Serial.println("WiFi + trafico ON. Compara con las pruebas 0 y 1:");
    testSilence();
    testTone();
    trafficOn = false;
    Serial.println("Si SOLO aqui aparecen pitidos/tic-tic -> el WiFi mete ruido por la");
    Serial.println("alimentacion: capacitor 100-470 uF en VIN del amp, cables cortos,");
    Serial.println("GND en estrella, o fuente 5 V separada (GND compartido).");
#endif
}

// ---------------------------------------------------------------------
// l. Loopback: grabar 3 s con el INMP441 y reproducir
// ---------------------------------------------------------------------

static void testLoopback()
{
    Serial.println();
    Serial.println("== L. LOOPBACK: graba 3 s del mic y los reproduce ==");
    Serial.println("Si oyes tu voz clara -> mic + amp + bocina OK; el resto es la cadena IA.");

    i2s_config_t cfg = {};
    cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
    cfg.sample_rate = 16000;
    cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;
    cfg.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;
    cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
    cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
    cfg.dma_buf_count = 8;
    cfg.dma_buf_len = 256;
    i2s_pin_config_t pins = {};
    pins.mck_io_num = I2S_PIN_NO_CHANGE;
    pins.bck_io_num = MIC_SCK;
    pins.ws_io_num = MIC_WS;
    pins.data_out_num = I2S_PIN_NO_CHANGE;
    pins.data_in_num = MIC_SD;
    if (i2s_driver_install(MIC_PORT, &cfg, 0, nullptr) != ESP_OK ||
        i2s_set_pin(MIC_PORT, &pins) != ESP_OK) {
        Serial.println("!!! no se pudo iniciar el I2S del mic");
        return;
    }

    const uint32_t frames = 16000 * 3;
    int32_t *raw = (int32_t *)ps_malloc(frames * 2 * sizeof(int32_t));
    int16_t *pcm = (int16_t *)ps_malloc(frames * sizeof(int16_t));
    if (!raw || !pcm) {
        Serial.println("!!! sin PSRAM");
        i2s_driver_uninstall(MIC_PORT);
        return;
    }
    static int32_t tmp[512];
    for (int i = 0; i < 6; i++) { // arranque del mic
        size_t g;
        i2s_read(MIC_PORT, tmp, sizeof(tmp), &g, pdMS_TO_TICKS(100));
    }
    Serial.println("  Habla AHORA (3 s)...");
    size_t total = 0;
    while (total < frames * 2 * sizeof(int32_t)) {
        size_t g = 0;
        i2s_read(MIC_PORT, (uint8_t *)raw + total, frames * 2 * sizeof(int32_t) - total, &g,
                 pdMS_TO_TICKS(500));
        total += g;
    }
    i2s_driver_uninstall(MIC_PORT);

    // Elige el slot con más variación (donde está el mic).
    double var[2] = {0, 0};
    for (int ch = 0; ch < 2; ch++) {
        double s = 0, s2 = 0;
        for (uint32_t i = 0; i < frames; i++) {
            const double v = raw[2 * i + ch] >> 8;
            s += v;
            s2 += v * v;
        }
        var[ch] = s2 / frames - (s / frames) * (s / frames);
    }
    const int slot = var[1] > var[0] ? 1 : 0;
    if (var[slot] < 1.0) {
        Serial.println("  !!! El mic grabo silencio absoluto: no responde. Usa el proyecto mic-test.");
        free(raw);
        free(pcm);
        return;
    }

    // Filtro pasa-altas (~80 Hz) para quitar DC y retumbe, y nivel robusto:
    // se normaliza con el percentil 99 (no con el pico, que un solo golpe o
    // chasquido saturado dejaría todo en silencio).
    float prevIn = 0, prevOut = 0;
    const float alpha = 0.969f; // 80 Hz @ 16 kHz
    float *hp = (float *)ps_malloc(frames * sizeof(float));
    if (!hp) {
        Serial.println("!!! sin PSRAM");
        free(raw);
        free(pcm);
        return;
    }
    uint32_t hist[64] = {0}; // histograma de |muestra| en escala log2
    for (uint32_t i = 0; i < frames; i++) {
        const float x = (float)(raw[2 * i + slot] >> 8);
        const float y = alpha * (prevOut + x - prevIn);
        prevIn = x;
        prevOut = y;
        hp[i] = y;
        const uint32_t a = (uint32_t)fabsf(y);
        hist[a ? 32 - __builtin_clz(a) : 0]++;
    }
    uint32_t acc = 0, p99 = 1;
    for (int k = 0; k < 64; k++) {
        acc += hist[k];
        if (acc >= frames * 0.99f) {
            p99 = 1u << k;
            break;
        }
    }
    const float scale = 8000.0f / p99; // percentil 99 -> ~-12 dBFS
    uint32_t clipped = 0;
    for (uint32_t i = 0; i < frames; i++) {
        float v = hp[i] * scale;
        if (fabsf(v) > 32000) {
            clipped++;
            v = v > 0 ? 32000 : -32000;
        }
        pcm[i] = (int16_t)v;
    }
    free(hp);
    Serial.printf("  slot %d, percentil99 %.1f dBFS, ganancia x%.2f, picos recortados %lu\n",
                  slot, 20 * log10f(p99 / 8388608.0f), scale, (unsigned long)clipped);
    if (clipped > frames / 100) {
        Serial.println("  (muchos picos: hablaste muy cerca o el mic trae golpes/ruido en el cable)");
    }

    // El loopback suena al menos a 40% aunque hayas bajado el volumen.
    const int savedVol = volumePct;
    volumePct = max(volumePct, 40);
    Serial.println("  Reproduciendo...");
    setRate(16000);
    ampStart();
    writeAudio(pcm, frames, 1);
    ampStop();
    volumePct = savedVol;
    free(raw);
    free(pcm);
}

// ---------------------------------------------------------------------

static void help()
{
    Serial.println();
    Serial.println("Comandos (letra + Enter; cualquier tecla detiene el audio):");
    Serial.println("  0  silencio digital 5 s (detecta ruido FISICO)");
    Serial.println("  1  tono 1 kHz -12 dBFS");
    Serial.println("  2  escalera de nivel (encuentra donde distorsiona)");
    Serial.println("  3  barrido 100 Hz - 7 kHz");
    Serial.println("  4  reproducir /musica.wav");
    Serial.println("  5  reproducir /voz.wav (voz tipo IA)");
    Serial.println("  6  streaming simulado tipo Jarvis con /voz.wav");
    Serial.println("  w  repetir silencio + tono con WiFi transmitiendo");
    Serial.println("  l  loopback: graba 3 s del mic y reproduce");
    Serial.println("  +  / -  volumen software (+/-5%)");
    Serial.printf("  f  lista de archivos     h  ayuda     (volumen %d%%)\n", volumePct);
    Serial.println();
}

void setup()
{
    Serial.begin(115200);
    delay(800);
    Serial.println();
    Serial.println("############ PRUEBA DE AMPLIFICADOR MAX98357A + BOCINA ############");
    Serial.println("Esperado: VIN=5V GND=GND BCLK=47 LRC=48 DIN=1 SD=libre GAIN=libre");
    if (!installAmp()) {
        Serial.println("!!! no se pudo iniciar el I2S del amplificador");
        return;
    }
    fsOk = LittleFS.begin(false);
    listFiles();
    help();
}

void loop()
{
    if (!Serial.available()) {
        delay(20);
        return;
    }
    const char c = Serial.read();
    switch (c) {
    case '0': testSilence(); break;
    case '1': testTone(); break;
    case '2': testLadder(); break;
    case '3': testSweep(); break;
    case '4': playFile("/musica.wav"); break;
    case '5': playFile("/voz.wav"); break;
    case '6': testStreaming("/voz.wav"); break;
    case 'w': testWifi(); break;
    case 'l': testLoopback(); break;
    case '+': volumePct = min(100, volumePct + 5); Serial.printf("Volumen %d%%\n", volumePct); break;
    case '-': volumePct = max(5, volumePct - 5); Serial.printf("Volumen %d%%\n", volumePct); break;
    case 'f': listFiles(); break;
    case 'h': help(); break;
    default: break;
    }
}
