// Test de audio aislado: mic INMP441 + MAX98357A, sin cámara ni backend.
//   pio run -e audiotest -t upload && pio device monitor -e audiotest
//
// 1. Mic: prueba SCK/WS normales y cruzados, canal L y R; dice cuál da señal.
// 2. Bocina sin WiFi: tonos limpios. Si ya pita aquí → alimentación/amp.
// 3. Bocina con WiFi transmitiendo: si solo pita aquí → ruido del WiFi.
// 4. Medidor del mic en vivo (habla y mira la barra).
#include <Arduino.h>
#include <WiFi.h>
#include <math.h>
#include "driver/i2s.h"
#include "secrets.h"

#define MIC_PORT I2S_NUM_0
#define MIC_SCK 40
#define MIC_WS 39
#define MIC_SD 21

#define AMP_PORT I2S_NUM_1
#define AMP_BCLK 47
#define AMP_LRC 48
#define AMP_DIN 1

static constexpr uint32_t RATE = 16000;
/** Amplitud de los tonos (de 32767): ~25 %, suficiente para oír sin saturar. */
static constexpr float TONE_AMP = 8000.0f;

static int micSck = MIC_SCK;
static int micWs = MIC_WS;
static int micChannel = -1; // índice dentro del par estéreo; -1 = sin señal

static void setMicPins(int sck, int ws)
{
    i2s_pin_config_t pins = {};
    pins.mck_io_num = I2S_PIN_NO_CHANGE;
    pins.bck_io_num = sck;
    pins.ws_io_num = ws;
    pins.data_out_num = I2S_PIN_NO_CHANGE;
    pins.data_in_num = MIC_SD;
    i2s_set_pin(MIC_PORT, &pins);
    i2s_zero_dma_buffer(MIC_PORT);
}

static bool installMic()
{
    i2s_config_t cfg = {};
    cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
    cfg.sample_rate = RATE;
    cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;
    cfg.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;
    cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
    cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
    cfg.dma_buf_count = 8;
    cfg.dma_buf_len = 256;
    if (i2s_driver_install(MIC_PORT, &cfg, 0, nullptr) != ESP_OK) {
        return false;
    }
    setMicPins(MIC_SCK, MIC_WS);
    return true;
}

static bool installAmp()
{
    i2s_config_t cfg = {};
    cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX);
    cfg.sample_rate = RATE;
    cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
    cfg.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;
    cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
    cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
    cfg.dma_buf_count = 8;
    cfg.dma_buf_len = 256;
    cfg.tx_desc_auto_clear = true;
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
    i2s_stop(AMP_PORT);
    return true;
}

/** Lee ~0.5 s y cuenta cuántas muestras no son 0 por canal. */
static void measureMic(uint32_t nonZero[2], int32_t peak[2])
{
    static int32_t raw[512];
    nonZero[0] = nonZero[1] = 0;
    peak[0] = peak[1] = 0;
    for (int block = 0; block < 20; block++) {
        size_t got = 0;
        i2s_read(MIC_PORT, raw, sizeof(raw), &got, pdMS_TO_TICKS(100));
        if (block < 4) {
            continue; // arranque del mic
        }
        for (size_t i = 0; i < got / 4; i++) {
            const int ch = i & 1;
            const int32_t v = raw[i] >> 14;
            if (v != 0) {
                nonZero[ch]++;
            }
            peak[ch] = max(peak[ch], abs(v));
        }
    }
}

static void testMic()
{
    Serial.println();
    Serial.println("========== 1. MICROFONO ==========");
    Serial.println("(no hables todavia, se mide el ruido de fondo)");

    struct Combo {
        int sck, ws;
        const char *name;
    } combos[] = {
        {MIC_SCK, MIC_WS, "normal  SCK=40 WS=39"},
        {MIC_WS, MIC_SCK, "CRUZADO SCK=39 WS=40"},
    };

    int bestCombo = -1;
    uint32_t bestCount = 0;
    for (int c = 0; c < 2; c++) {
        setMicPins(combos[c].sck, combos[c].ws);
        delay(100);
        uint32_t nz[2];
        int32_t pk[2];
        measureMic(nz, pk);
        Serial.printf("mic %s: canal A nonzero=%5lu pico=%6ld | canal B nonzero=%5lu pico=%6ld\n",
                      combos[c].name, (unsigned long)nz[0], (long)pk[0],
                      (unsigned long)nz[1], (long)pk[1]);
        for (int ch = 0; ch < 2; ch++) {
            // Señal real: hay ruido, pero no todo saturado.
            if (nz[ch] > bestCount && pk[ch] < 32767) {
                bestCount = nz[ch];
                bestCombo = c;
                micChannel = ch;
            }
        }
    }

    if (bestCombo < 0) {
        micChannel = -1;
        Serial.println();
        Serial.println("RESULTADO MIC: !!! NINGUNA combinacion da senal -> es CABLEADO/ALIMENTACION");
        Serial.println("  - VDD del mic a 3.3V (no 5V) y GND a GND");
        Serial.println("  - SD -> GPIO21, SCK -> GPIO40, WS -> GPIO39, L/R -> GND");
        Serial.println("  - Pines del INMP441 SOLDADOS (solo metidos en la protoboard no hace contacto)");
        Serial.println("  - Prueba con otros cables jumper; mide 3.3V entre VDD y GND del mic");
        setMicPins(MIC_SCK, MIC_WS);
        return;
    }
    micSck = combos[bestCombo].sck;
    micWs = combos[bestCombo].ws;
    setMicPins(micSck, micWs);
    Serial.printf("RESULTADO MIC: OK con %s, canal %c\n", combos[bestCombo].name,
                  micChannel == 0 ? 'A' : 'B');
    if (bestCombo == 1) {
        Serial.println("  -> Tienes SCK y WS CRUZADOS: intercambia los cables de GPIO39 y GPIO40");
    }
}

static void playTone(float freq, uint32_t ms, float freqEnd = -1)
{
    static int16_t buf[512];
    const uint32_t total = RATE * ms / 1000;
    const uint32_t fade = RATE / 100; // 10 ms de rampa para que no truene
    float phase = 0;
    uint32_t n = 0;

    i2s_zero_dma_buffer(AMP_PORT);
    i2s_start(AMP_PORT);
    while (n < total) {
        size_t frames = 0;
        for (; frames < 256 && n < total; frames++, n++) {
            const float f = freqEnd > 0 ? freq + (freqEnd - freq) * n / total : freq;
            phase += 2.0f * PI * f / RATE;
            if (phase > 2.0f * PI) {
                phase -= 2.0f * PI;
            }
            float env = 1.0f;
            if (n < fade) {
                env = (float)n / fade;
            } else if (total - n < fade) {
                env = (float)(total - n) / fade;
            }
            const int16_t s = (int16_t)(TONE_AMP * env * sinf(phase));
            buf[2 * frames] = s;
            buf[2 * frames + 1] = s;
        }
        size_t written = 0;
        i2s_write(AMP_PORT, buf, frames * 4, &written, pdMS_TO_TICKS(500));
        if (written != frames * 4) {
            Serial.println("  !!! el I2S de la bocina no acepto datos");
            break;
        }
    }
    delay(100);
    i2s_zero_dma_buffer(AMP_PORT);
    i2s_stop(AMP_PORT);
}

static void toneSequence()
{
    Serial.println("  tono 440 Hz (2 s)...");
    playTone(440, 2000);
    delay(300);
    Serial.println("  tono 1000 Hz (2 s)...");
    playTone(1000, 2000);
    delay(300);
    Serial.println("  barrido 200 -> 3000 Hz (3 s)...");
    playTone(200, 3000, 3000);
    delay(300);
    Serial.println("  silencio con la bocina APAGADA (2 s): no debe sonar nada");
    delay(2000);
}

static volatile bool wifiTraffic = false;

/** Genera tráfico WiFi constante (como cuando llega la voz de Jarvis). */
static void trafficTask(void *)
{
    WiFiClient client;
    for (;;) {
        if (!wifiTraffic || WiFi.status() != WL_CONNECTED) {
            vTaskDelay(pdMS_TO_TICKS(50));
            continue;
        }
        if (client.connect(JARVIS_BACKEND_HOST, 80)) {
            client.print("GET /health HTTP/1.1\r\nHost: " JARVIS_BACKEND_HOST
                         "\r\nConnection: close\r\n\r\n");
            const uint32_t t0 = millis();
            while (client.connected() && millis() - t0 < 1000) {
                while (client.available()) {
                    client.read();
                }
                vTaskDelay(1);
            }
            client.stop();
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

void setup()
{
    Serial.begin(115200);
    delay(500);
    Serial.println();
    Serial.println("############ TEST DE AUDIO ############");

    if (!installAmp() || !installMic()) {
        Serial.println("!!! no se pudo iniciar I2S");
        return;
    }

    testMic();

    Serial.println();
    Serial.println("========== 2. BOCINA SIN WIFI ==========");
    Serial.println("Escucha: deben ser tonos LIMPIOS, sin pitidos ni chasquidos.");
    WiFi.mode(WIFI_OFF);
    toneSequence();

    Serial.println();
    Serial.println("========== 3. BOCINA CON WIFI TRANSMITIENDO ==========");
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
        delay(250);
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("WiFi OK (%s), generando trafico...\n", WiFi.localIP().toString().c_str());
        xTaskCreatePinnedToCore(trafficTask, "traffic", 4096, nullptr, 1, nullptr, 0);
        wifiTraffic = true;
        delay(300);
        toneSequence();
        wifiTraffic = false;
    } else {
        Serial.println("WiFi no conecto, se salta esta parte");
    }

    Serial.println();
    Serial.println("Compara 2 y 3:");
    Serial.println("  - Pita en 2 y 3  -> alimentacion/cableado del amplificador (o volumen)");
    Serial.println("  - Pita solo en 3 -> ruido del WiFi: capacitor 470uF en VIN/GND del amp,");
    Serial.println("                      cables cortos, GND comun, fuente 5V aparte");
    Serial.println("  - Limpio en 2 y 3 -> el hardware esta bien; el problema seria el stream");

    Serial.println();
    Serial.println("========== 4. MEDIDOR DEL MIC (habla, sopla, aplaude) ==========");
}

void loop()
{
    static int32_t raw[512];
    size_t got = 0;
    i2s_read(MIC_PORT, raw, sizeof(raw), &got, pdMS_TO_TICKS(200));
    const size_t n = got / 4;

    int32_t peakA = 0, peakB = 0;
    for (size_t i = 0; i < n; i++) {
        const int32_t v = abs(raw[i] >> 14);
        if (i & 1) {
            peakB = max(peakB, v);
        } else {
            peakA = max(peakA, v);
        }
    }

    static uint32_t lastMs = 0;
    static int32_t holdA = 0, holdB = 0;
    holdA = max(holdA, peakA);
    holdB = max(holdB, peakB);
    if (millis() - lastMs < 200) {
        return;
    }
    lastMs = millis();

    const int32_t level = micChannel == 1 ? holdB : holdA;
    char bar[41];
    const int len = constrain((int)(level * 40 / 32768), 0, 40);
    memset(bar, '#', len);
    memset(bar + len, '.', 40 - len);
    bar[40] = '\0';
    Serial.printf("mic A=%6ld B=%6ld [%s]%s\n", (long)holdA, (long)holdB, bar,
                  (holdA == 0 && holdB == 0) ? "  <- 0 exacto: el mic no manda nada" : "");
    holdA = holdB = 0;
}
