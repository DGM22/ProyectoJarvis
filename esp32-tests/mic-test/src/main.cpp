// =====================================================================
//  PRUEBA DEL MICROFONO INMP441  (ESP32-S3 Freenove, sin cámara ni WiFi)
// =====================================================================
//
//  Cableado esperado (datasheet TDK INMP441):
//    VDD -> 3.3V (1.8–3.3 V, NUNCA 5 V)     GND -> GND
//    SCK -> GPIO40   WS -> GPIO39   SD -> GPIO21
//    L/R -> GND  (canal izquierdo; a 3.3V = derecho; nunca flotante)
//
//  Formato del INMP441: I2S Philips, 24 bits en complemento a 2, MSB primero,
//  dentro de slots de 32 bits (64 SCK por frame). Fuera de su slot y tras el
//  bit 24 deja SD en alta impedancia. Con el reloj apagado se duerme.
//
//  Qué hace al arrancar:
//    1. Pines sin reloj: detecta cortos (SD/SCK/WS pegados a GND o 3.3V).
//    2. Pines con reloj: con pull-up y luego pull-down en SD mira si ALGUIEN
//       maneja la línea. Si el valor sigue al pull, el mic no está hablando
//       (sin alimentación, pin sin soldar, SCK/WS mal o mic dañado).
//    3. Repite con SCK/WS cruzados por si están al revés.
//    4. Medidor en vivo por canal: RMS, pico, DC, en dBFS.
//
//  Comandos (escribe la letra + Enter en el monitor):
//    h ayuda   p repetir prueba de pines   s cruzar SCK/WS   f 16k/32k
//    x volcado crudo en hex   r grabar 3 s y analizar   m medidor on/off
// =====================================================================
#include <Arduino.h>
#include <math.h>
#include "driver/i2s.h"
#include "driver/gpio.h"

#define MIC_PORT I2S_NUM_0
#define PIN_SCK 40
#define PIN_WS 39
#define PIN_SD 21

static uint32_t sampleRate = 16000;
static i2s_comm_format_t commFormat = I2S_COMM_FORMAT_STAND_I2S;
/** Fuerza de salida de SCK/WS: menos fuerza = flancos suaves = menos rebote. */
static gpio_drive_cap_t clkDrive = GPIO_DRIVE_CAP_2;
/** Bits que se recorren a la izquierda antes de tomar los 24 de arriba. */
static int bitShift = 0;
static bool swapped = false;
static bool i2sInstalled = false;
static bool meterOn = true;
/** Canal donde respondió el mic: 0 o 1 (índice en el par), -1 = ninguno. */
static int micSlot = -1;

static int sckPin() { return swapped ? PIN_WS : PIN_SCK; }
static int wsPin() { return swapped ? PIN_SCK : PIN_WS; }

// ---------------------------------------------------------------------
// I2S
// ---------------------------------------------------------------------

static void stopI2s()
{
    if (i2sInstalled) {
        i2s_driver_uninstall(MIC_PORT);
        i2sInstalled = false;
    }
}

static bool startI2s()
{
    stopI2s();
    i2s_config_t cfg = {};
    cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
    cfg.sample_rate = sampleRate;
    cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT; // 32 SCK por canal
    cfg.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;  // leemos ambos slots
    cfg.communication_format = commFormat;
    cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
    cfg.dma_buf_count = 8;
    cfg.dma_buf_len = 256;

    i2s_pin_config_t pins = {};
    pins.mck_io_num = I2S_PIN_NO_CHANGE;
    pins.bck_io_num = sckPin();
    pins.ws_io_num = wsPin();
    pins.data_out_num = I2S_PIN_NO_CHANGE;
    pins.data_in_num = PIN_SD;

    if (i2s_driver_install(MIC_PORT, &cfg, 0, nullptr) != ESP_OK ||
        i2s_set_pin(MIC_PORT, &pins) != ESP_OK) {
        Serial.println("!!! no se pudo iniciar el I2S");
        return false;
    }
    gpio_set_drive_capability((gpio_num_t)sckPin(), clkDrive);
    gpio_set_drive_capability((gpio_num_t)wsPin(), clkDrive);
    i2sInstalled = true;
    i2s_zero_dma_buffer(MIC_PORT);
    return true;
}

/** Lee un bloque estéreo de 32 bits. Devuelve número de palabras. */
static size_t readBlock(int32_t *buf, size_t words, uint32_t timeoutMs = 200)
{
    size_t got = 0;
    i2s_read(MIC_PORT, buf, words * sizeof(int32_t), &got, pdMS_TO_TICKS(timeoutMs));
    return got / sizeof(int32_t);
}

/** Muestra de 24 bits con signo desde el slot de 32 bits. */
static inline int32_t sample24(int32_t raw) { return (int32_t)((uint32_t)raw << bitShift) >> 8; }

static float toDbfs(float v)
{
    const float full = 8388608.0f; // 2^23
    return v <= 0 ? -120.0f : 20.0f * log10f(v / full);
}

// ---------------------------------------------------------------------
// 1. Pines sin reloj
// ---------------------------------------------------------------------

static const char *pullVerdict(int up, int down)
{
    if (up == 1 && down == 0) {
        return "OK (libre, sigue al pull)";
    }
    // Los módulos INMP441 traen resistencias propias (p. ej. SD con 100 kΩ a
    // GND) que le ganan al pull interno: solo es corto si la prueba 2 falla.
    if (up == 0 && down == 0) {
        return "fijo en 0 (resistencia del modulo a GND, o corto si la prueba 2 falla)";
    }
    if (up == 1 && down == 1) {
        return "fijo en 1 (resistencia del modulo a VCC, o corto si la prueba 2 falla)";
    }
    return "??? raro (lee al reves del pull)";
}

static void testPinsNoClock()
{
    stopI2s();
    Serial.println();
    Serial.println("---- 1. PINES SIN RELOJ (busca cortos) ----");
    const int pins[] = {PIN_SD, PIN_SCK, PIN_WS};
    const char *names[] = {"SD  GPIO21", "SCK GPIO40", "WS  GPIO39"};
    for (int i = 0; i < 3; i++) {
        pinMode(pins[i], INPUT_PULLUP);
        delay(5);
        const int up = digitalRead(pins[i]);
        pinMode(pins[i], INPUT_PULLDOWN);
        delay(5);
        const int down = digitalRead(pins[i]);
        pinMode(pins[i], INPUT);
        Serial.printf("  %s: pullup=%d pulldown=%d -> %s\n", names[i], up, down,
                      pullVerdict(up, down));
    }
    Serial.println("  (Sin reloj el INMP441 duerme y suelta SD: lo normal es 'libre')");
}

// ---------------------------------------------------------------------
// 2. ¿Alguien maneja SD con el reloj corriendo?
// ---------------------------------------------------------------------

struct SlotProbe {
    uint32_t distinct;   // valores distintos de 24 bits vistos
    int32_t first;       // primer valor visto
    bool allSame;
};

/** Lee ~0.3 s con el pull dado y analiza cada slot. */
static void probeWithPull(bool pullUp, SlotProbe out[2])
{
    if (pullUp) {
        gpio_pulldown_dis((gpio_num_t)PIN_SD);
        gpio_pullup_en((gpio_num_t)PIN_SD);
    } else {
        gpio_pullup_dis((gpio_num_t)PIN_SD);
        gpio_pulldown_en((gpio_num_t)PIN_SD);
    }
    delay(20);

    static int32_t buf[512];
    // Descarta el arranque del mic (~2^18 ciclos de SCK según datasheet).
    for (int i = 0; i < 6; i++) {
        readBlock(buf, 512);
    }

    // Conteo simple de distintos (hasta 64) por slot.
    int32_t seen[2][64];
    uint32_t nSeen[2] = {0, 0};
    for (int ch = 0; ch < 2; ch++) {
        out[ch].first = 0;
        out[ch].allSame = true;
    }
    bool firstSet[2] = {false, false};

    for (int b = 0; b < 10; b++) {
        const size_t n = readBlock(buf, 512);
        for (size_t i = 0; i < n; i++) {
            const int ch = i & 1;
            const int32_t v = sample24(buf[i]);
            if (!firstSet[ch]) {
                out[ch].first = v;
                firstSet[ch] = true;
            } else if (v != out[ch].first) {
                out[ch].allSame = false;
            }
            bool known = false;
            for (uint32_t k = 0; k < nSeen[ch]; k++) {
                if (seen[ch][k] == v) {
                    known = true;
                    break;
                }
            }
            if (!known && nSeen[ch] < 64) {
                seen[ch][nSeen[ch]++] = v;
            }
        }
    }
    out[0].distinct = nSeen[0];
    out[1].distinct = nSeen[1];
    gpio_pullup_dis((gpio_num_t)PIN_SD);
    gpio_pulldown_dis((gpio_num_t)PIN_SD);
}

/** Devuelve el slot donde el mic maneja SD, o -1. */
static int testDriven(const char *label)
{
    if (!startI2s()) {
        return -1;
    }
    SlotProbe up[2], down[2];
    probeWithPull(true, up);
    probeWithPull(false, down);

    Serial.printf("  [%s] SCK=GPIO%d WS=GPIO%d @ %lu Hz\n", label, sckPin(), wsPin(),
                  (unsigned long)sampleRate);
    int driven = -1;
    for (int ch = 0; ch < 2; ch++) {
        const char *verdict;
        if (up[ch].allSame && down[ch].allSame && up[ch].first == -1 &&
            down[ch].first == 0) {
            verdict = "nadie maneja SD (sigue al pull)";
        } else if (up[ch].allSame && down[ch].allSame && up[ch].first == 0 &&
                   down[ch].first == 0) {
            verdict = "!!! SD fijo en 0 aun con pull-up -> SD a GND / mic mandando ceros";
        } else if (up[ch].allSame && down[ch].allSame) {
            verdict = "valor fijo raro";
        } else {
            verdict = "*** EL MIC RESPONDE AQUI ***";
            if (driven < 0 || up[ch].distinct > up[driven].distinct) {
                driven = ch;
            }
        }
        Serial.printf("    slot %d: pullup(distintos=%2lu, v=%ld) pulldown(distintos=%2lu, v=%ld) -> %s\n",
                      ch, (unsigned long)up[ch].distinct, (long)up[ch].first,
                      (unsigned long)down[ch].distinct, (long)down[ch].first, verdict);
    }
    return driven;
}

static void runPinTests()
{
    testPinsNoClock();

    Serial.println();
    Serial.println("---- 2. CON RELOJ: ¿EL MIC MANEJA SD? ----");
    swapped = false;
    micSlot = testDriven("normal ");
    if (micSlot < 0) {
        swapped = true;
        micSlot = testDriven("CRUZADO");
        if (micSlot >= 0) {
            Serial.println("  >>> Funciona con SCK/WS CRUZADOS: intercambia los cables de GPIO39 y GPIO40");
        } else {
            swapped = false;
        }
    }

    Serial.println();
    if (micSlot < 0) {
        Serial.println("==== RESULTADO: EL MIC NO RESPONDE ====");
        Serial.println("  El ESP32 genera el reloj pero nadie contesta en SD. Revisa en orden:");
        Serial.println("   1. Pines del INMP441 SOLDADOS (metidos sin soldar no hacen contacto)");
        Serial.println("   2. VDD del mic a 3.3V: mide con multimetro ENTRE VDD y GND del modulo");
        Serial.println("   3. GND del mic al GND de la ESP32");
        Serial.println("   4. SCK->40, WS->39, SD->21 (cable por cable, prueba otros jumpers)");
        Serial.println("   5. L/R a GND (no flotante)");
        Serial.println("   6. Si todo esta bien: prueba otro INMP441 (pueden venir danados)");
        startI2s();
    } else {
        Serial.printf("==== RESULTADO: MIC OK en slot %d (%s) ====\n", micSlot,
                      swapped ? "SCK/WS cruzados" : "cableado normal");
        Serial.println("  Ahora habla: el medidor del slot marcado con <MIC> debe moverse.");
    }
    Serial.println();
}

// ---------------------------------------------------------------------
// Medidor, volcado y grabación
// ---------------------------------------------------------------------

struct ChanStats {
    double sum = 0, sumSq = 0;
    int32_t minV = INT32_MAX, maxV = INT32_MIN;
    uint32_t n = 0;

    void add(int32_t v)
    {
        sum += v;
        sumSq += (double)v * v;
        minV = min(minV, v);
        maxV = max(maxV, v);
        n++;
    }
    float dc() const { return n ? sum / n : 0; }
    float rms() const
    {
        if (!n) return 0;
        const double mean = sum / n;
        const double var = sumSq / n - mean * mean; // RMS sin DC
        return var > 0 ? sqrt(var) : 0;
    }
    float peak() const { return n ? max(abs(maxV - (int32_t)dc()), abs(minV - (int32_t)dc())) : 0; }
};

static void printBar(float dbfs)
{
    // -90 dBFS .. 0 dBFS en 30 caracteres
    const int len = constrain((int)((dbfs + 90.0f) / 3.0f), 0, 30);
    char bar[31];
    memset(bar, '#', len);
    memset(bar + len, '.', 30 - len);
    bar[30] = '\0';
    Serial.print(bar);
}

static void meterTick()
{
    static int32_t buf[1024];
    static ChanStats st[2];
    static uint32_t lastPrint = 0;

    const size_t n = readBlock(buf, 1024);
    for (size_t i = 0; i < n; i++) {
        st[i & 1].add(sample24(buf[i]));
    }
    if (millis() - lastPrint < 250) {
        return;
    }
    lastPrint = millis();

    for (int ch = 0; ch < 2; ch++) {
        const float rmsDb = toDbfs(st[ch].rms());
        const float pkDb = toDbfs(st[ch].peak());
        Serial.printf("s%d%s rms%6.1f pk%6.1f dc%+8ld ", ch, ch == micSlot ? "<MIC>" : "     ",
                      rmsDb, pkDb, (long)st[ch].dc());
        printBar(rmsDb);
        Serial.print(ch == 0 ? " | " : "");
        st[ch] = ChanStats();
    }
    Serial.println();
}

static void hexDump()
{
    static int32_t buf[512];
    for (int i = 0; i < 4; i++) {
        readBlock(buf, 512);
    }
    readBlock(buf, 512);
    Serial.println("Volcado crudo (slot0 / slot1), 32 bits; el mic usa los 24 de arriba:");
    for (int i = 0; i < 16; i++) {
        Serial.printf("  %08lX  %08lX\n", (unsigned long)buf[2 * i], (unsigned long)buf[2 * i + 1]);
    }
    Serial.println("  FFFFFFFF/00000000 fijos = nadie maneja SD. Valores que cambian = hay mic.");
}

static void record3s()
{
    const int slot = micSlot >= 0 ? micSlot : 0;
    const uint32_t samples = sampleRate * 3;
    int32_t *rec = (int32_t *)ps_malloc(samples * sizeof(int32_t));
    if (!rec) {
        Serial.println("!!! sin PSRAM");
        return;
    }
    Serial.println("Grabando 3 s... di \"Hola Jarvis, uno dos tres\"");
    static int32_t buf[1024];
    uint32_t pos = 0;
    while (pos < samples) {
        const size_t n = readBlock(buf, 1024);
        for (size_t i = slot; i < n && pos < samples; i += 2) {
            rec[pos++] = sample24(buf[i]);
        }
    }

    ChanStats all;
    for (uint32_t i = 0; i < samples; i++) {
        all.add(rec[i]);
    }
    uint32_t clips = 0;
    for (uint32_t i = 0; i < samples; i++) {
        if (abs(rec[i]) >= 8388000) clips++;
    }
    Serial.printf("Slot %d: rms %.1f dBFS, pico %.1f dBFS, DC %ld, recortes=%lu\n", slot,
                  toDbfs(all.rms()), toDbfs(all.peak()), (long)all.dc(), (unsigned long)clips);

    Serial.println("Envolvente cada 100 ms (deberias ver tu voz como bloques altos):");
    const uint32_t win = sampleRate / 10;
    for (uint32_t w = 0; w < 30; w++) {
        ChanStats s;
        for (uint32_t i = w * win; i < (w + 1) * win; i++) {
            s.add(rec[i]);
        }
        Serial.printf("  %4lu ms %6.1f dBFS ", (unsigned long)(w * 100), toDbfs(s.rms()));
        printBar(toDbfs(s.rms()));
        Serial.println();
    }
    Serial.println("Referencia: silencio ~ -70..-55 dBFS | voz a 20 cm ~ -40..-25 dBFS");
    free(rec);
}


// ---------------------------------------------------------------------
// c. Calibración: busca la configuración con el piso de ruido más bajo
// ---------------------------------------------------------------------

/**
 * Mide ~0.6 s en silencio: RMS tras pasa-altas (dBFS) y cuántas veces el bit
 * de signo brinca entre muestras seguidas (con datos sanos casi nunca pasa en
 * silencio; con bits corridos o rebote en SCK pasa todo el tiempo).
 */
static void measureNoise(int slot, int shift, float &rmsDb, float &jumpPct)
{
    static int32_t buf[1024];
    for (int i = 0; i < 4; i++) readBlock(buf, 1024);
    double s2 = 0;
    uint32_t n = 0, jumps = 0;
    float prevIn = 0, prevOut = 0;
    int32_t prev = 0;
    for (int b = 0; b < 10; b++) {
        const size_t got = readBlock(buf, 1024);
        for (size_t i = slot; i < got; i += 2) {
            const int32_t v = (int32_t)((uint32_t)buf[i] << shift) >> 8;
            const float y = 0.969f * (prevOut + v - prevIn);
            prevIn = v;
            prevOut = y;
            if (n > 64) {
                s2 += (double)y * y;
                if (abs(v - prev) > (1 << 21)) jumps++;
            }
            prev = v;
            n++;
        }
    }
    const uint32_t used = n > 64 ? n - 64 : 1;
    rmsDb = toDbfs(sqrt(s2 / used));
    jumpPct = 100.0f * jumps / used;
}

static void calibrate()
{
    Serial.println();
    Serial.println("---- CALIBRACION (QUEDATE EN SILENCIO ~15 s) ----");
    Serial.println("Silencio sano en INMP441: rms entre -75 y -55 dBFS y saltos ~0%.");
    if (micSlot < 0) {
        Serial.println("Primero el mic debe responder (prueba p).");
        return;
    }
    const gpio_drive_cap_t drives[] = {GPIO_DRIVE_CAP_0, GPIO_DRIVE_CAP_1, GPIO_DRIVE_CAP_2};
    const char *driveNames[] = {"5mA ", "10mA", "20mA"};
    const i2s_comm_format_t fmts[] = {I2S_COMM_FORMAT_STAND_I2S, I2S_COMM_FORMAT_STAND_MSB};
    const char *fmtNames[] = {"Philips", "MSB    "};
    const uint32_t rates[] = {16000, 32000};

    float best = 0;
    int bd = 2, bf = 0, br = 0, bs = 0;
    for (int r = 0; r < 2; r++) {
        for (int f = 0; f < 2; f++) {
            for (int d = 0; d < 3; d++) {
                sampleRate = rates[r];
                commFormat = fmts[f];
                clkDrive = drives[d];
                startI2s();
                for (int sh = 0; sh < 3; sh++) {
                    float db, jp;
                    measureNoise(micSlot, sh, db, jp);
                    Serial.printf("  %5lu Hz %s SCK %s shift %d -> rms %6.1f dBFS  saltos %5.1f%%%s\n",
                                  (unsigned long)rates[r], fmtNames[f], driveNames[d], sh, db, jp,
                                  db < -50 && jp < 1 ? "  <- SANO" : "");
                    if (best == 0 || db < best) {
                        best = db;
                        bd = d; bf = f; br = r; bs = sh;
                    }
                }
            }
        }
    }
    sampleRate = rates[br];
    commFormat = fmts[bf];
    clkDrive = drives[bd];
    bitShift = bs;
    startI2s();
    Serial.println();
    Serial.printf("==== MEJOR: %lu Hz, %s, SCK %s, shift %d -> %.1f dBFS ====\n",
                  (unsigned long)sampleRate, fmtNames[bf], driveNames[bd], bs, best);
    if (best > -50) {
        Serial.println("  !!! Ninguna combinacion da silencio sano: es SENAL ELECTRICA.");
        Serial.println("      - Acorta los cables del mic (ideal < 10 cm), sin protoboard de por medio");
        Serial.println("      - Resistencia de 33-100 ohm en serie en SCK (pegada a la ESP32)");
        Serial.println("      - GND del mic directo al pin GND de la ESP32, cable corto");
        Serial.println("      - Aleja los cables del mic de los del amplificador y la bocina");
        Serial.println("      - Prueba otro INMP441");
    } else {
        Serial.println("  Usa estos valores en el firmware de Jarvis (voice.cpp).");
    }
}

static void help()
{
    Serial.println();
    Serial.println("Comandos (letra + Enter):");
    Serial.println("  h  esta ayuda");
    Serial.println("  p  repetir prueba de pines");
    Serial.println("  s  cruzar / descruzar SCK y WS");
    Serial.printf("  f  cambiar frecuencia (ahora %lu Hz)\n", (unsigned long)sampleRate);
    Serial.println("  x  volcado crudo en hex");
    Serial.println("  r  grabar 3 s y analizar tu voz");
    Serial.println("  m  medidor en vivo on/off");
    Serial.println("  c  calibrar (busca la config con menos ruido; en silencio)");
    Serial.println();
}

void setup()
{
    Serial.begin(115200);
    delay(800);
    Serial.println();
    Serial.println("################ PRUEBA DEL MICROFONO INMP441 ################");
    Serial.println("Esperado: VDD=3.3V GND=GND SCK=40 WS=39 SD=21 L/R=GND");
    runPinTests();
    calibrate();
    help();
}

void loop()
{
    while (Serial.available()) {
        const char c = Serial.read();
        switch (c) {
        case 'h': help(); break;
        case 'p': runPinTests(); break;
        case 's':
            swapped = !swapped;
            Serial.printf("SCK=GPIO%d WS=GPIO%d\n", sckPin(), wsPin());
            startI2s();
            break;
        case 'f':
            sampleRate = sampleRate == 16000 ? 32000 : 16000;
            Serial.printf("Frecuencia: %lu Hz (SCK = %lu Hz)\n", (unsigned long)sampleRate,
                          (unsigned long)(sampleRate * 64));
            startI2s();
            break;
        case 'x': hexDump(); break;
        case 'r': record3s(); break;
        case 'c': calibrate(); break;
        case 'm':
            meterOn = !meterOn;
            Serial.printf("Medidor %s\n", meterOn ? "ON" : "OFF");
            break;
        default: break;
        }
    }
    if (meterOn && i2sInstalled) {
        meterTick();
    } else {
        delay(20);
    }
}
