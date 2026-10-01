#include <Arduino.h>
#include <U8g2lib.h>
#include <Wire.h>

static constexpr int OLED_SDA_PIN = 41;
static constexpr int OLED_SCL_PIN = 42;

// GPIO libres en la Freenove sin la cámara corriendo. Fuera: 19/20 (USB),
// 26–37 (flash/PSRAM), 41/42 (OLED), 43/44 (UART del monitor), 48 (LED RGB).
static const uint8_t kPins[] = {0,  1,  2,  3,  4,  5,  6,  7,  8,  9,  10, 11, 12,
                                13, 14, 15, 16, 17, 18, 21, 38, 39, 40, 45, 46, 47};
static constexpr size_t kPinCount = sizeof(kPins) / sizeof(kPins[0]);

static constexpr uint32_t SCAN_EVERY_MS = 5;
static constexpr uint32_t DEBOUNCE_MS = 30;
static constexpr uint32_t DRAW_EVERY_MS = 100;

enum class Wiring : uint8_t { Released, ToGnd, To3v3 };

struct PinState {
    /** Lectura en reposo al arrancar. Los pull-up externos (BOOT, I2C de la
     *  cámara, SD) se leen "a 3V3" aunque nadie presione. */
    Wiring idle = Wiring::Released;
    Wiring stable = Wiring::Released;
    Wiring lastRaw = Wiring::Released;
    uint32_t changedMs = 0;
    uint32_t clicks = 0;
    Wiring clickWiring = Wiring::Released;
};

static PinState states[kPinCount];
static int lastPinIndex = -1;
static U8G2_SSD1306_128X64_NONAME_F_HW_I2C display(U8G2_R0, U8X8_PIN_NONE);
static bool oledOk = false;

/**
 * Suelto = sigue al pull (HIGH con pull-up, LOW con pull-down).
 * Presionado = fijo: LOW en ambos si va a GND, HIGH en ambos si va a 3V3.
 */
static Wiring sample(uint8_t pin)
{
    pinMode(pin, INPUT_PULLUP);
    delayMicroseconds(30);
    const int withPullUp = digitalRead(pin);
    pinMode(pin, INPUT_PULLDOWN);
    delayMicroseconds(30);
    const int withPullDown = digitalRead(pin);

    if (withPullUp == LOW && withPullDown == LOW) {
        return Wiring::ToGnd;
    }
    if (withPullUp == HIGH && withPullDown == HIGH) {
        return Wiring::To3v3;
    }
    return Wiring::Released;
}

static const char *wiringLabel(Wiring wiring)
{
    switch (wiring) {
    case Wiring::ToGnd:
        return "a GND";
    case Wiring::To3v3:
        return "a 3V3";
    default:
        return "suelto";
    }
}

static void captureIdleLevels()
{
    Serial.println("Pines con nivel fijo en reposo (pull externo o en corto):");
    bool any = false;
    for (size_t i = 0; i < kPinCount; i++) {
        const Wiring w = sample(kPins[i]);
        states[i].idle = w;
        states[i].stable = w;
        states[i].lastRaw = w;
        if (w != Wiring::Released) {
            Serial.printf("  GPIO %u %s\n", kPins[i], wiringLabel(w));
            any = true;
        }
    }
    if (!any) {
        Serial.println("  ninguno");
    }
}

static void scanPins()
{
    const uint32_t now = millis();
    for (size_t i = 0; i < kPinCount; i++) {
        PinState &st = states[i];
        const Wiring raw = sample(kPins[i]);
        if (raw != st.lastRaw) {
            st.lastRaw = raw;
            st.changedMs = now;
            continue;
        }
        if (raw == st.stable || now - st.changedMs < DEBOUNCE_MS) {
            continue;
        }

        const Wiring previous = st.stable;
        st.stable = raw;
        if (raw == st.idle) {
            Serial.printf("GPIO %u suelto\n", kPins[i]);
        } else if (previous == st.idle) {
            st.clicks++;
            st.clickWiring = raw;
            lastPinIndex = static_cast<int>(i);
            Serial.printf("CLICK GPIO %u (%s) total=%lu\n", kPins[i], wiringLabel(raw),
                          static_cast<unsigned long>(st.clicks));
        }
    }
}

static void drawStatus()
{
    if (!oledOk) {
        return;
    }
    char line[32];
    display.clearBuffer();
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 10, "TEST BOTON");
    display.drawStr(0, 22, "BOOT = GPIO 0");

    if (lastPinIndex < 0) {
        display.drawStr(0, 36, "Presiona el boton...");
    } else {
        const PinState &st = states[lastPinIndex];
        const bool pressed = st.stable != st.idle;
        snprintf(line, sizeof(line), "GPIO %u %s", kPins[lastPinIndex],
                 wiringLabel(st.clickWiring));
        display.drawStr(0, 36, line);
        snprintf(line, sizeof(line), "Clicks: %lu", static_cast<unsigned long>(st.clicks));
        display.drawStr(0, 48, line);
        if (pressed) {
            display.drawBox(80, 39, 48, 12);
            display.setDrawColor(0);
            display.drawStr(84, 48, "PULSADO");
            display.setDrawColor(1);
        }
    }

    // Nivel fijo en reposo: pull externo, o botón de 4 patas mal orientado.
    int x = 0;
    display.drawStr(x, 62, "Fijos:");
    x += 38;
    bool any = false;
    for (size_t i = 0; i < kPinCount && x < 120; i++) {
        if (states[i].idle == Wiring::Released) {
            continue;
        }
        snprintf(line, sizeof(line), "%u", kPins[i]);
        display.drawStr(x, 62, line);
        x += display.getStrWidth(line) + 5;
        any = true;
    }
    if (!any) {
        display.drawStr(x, 62, "-");
    }
    display.sendBuffer();
}

void setup()
{
    Serial.begin(115200);
    delay(500);
    Serial.println();
    Serial.println("=== TEST BOTON (Freenove ESP32-S3) ===");

    Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN, 400000);
    Wire.beginTransmission(0x3C);
    oledOk = Wire.endTransmission() == 0;
    if (oledOk) {
        display.setI2CAddress(0x3C << 1);
        display.begin();
    } else {
        Serial.println("OLED no encontrada (solo serial)");
    }

    captureIdleLevels();
    Serial.println("Presiona BOOT para probar el test y luego tu botón.");
}

void loop()
{
    static uint32_t lastScanMs = 0;
    static uint32_t lastDrawMs = 0;
    const uint32_t now = millis();

    if (now - lastScanMs >= SCAN_EVERY_MS) {
        lastScanMs = now;
        scanPins();
    }
    if (now - lastDrawMs >= DRAW_EVERY_MS) {
        lastDrawMs = now;
        drawStatus();
    }
}
