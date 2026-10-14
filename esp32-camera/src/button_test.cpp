// Prueba del botón: busca en qué GPIO está, imprime cada pulsación y anima
// los ojos de la OLED. No usa cámara, WiFi ni audio.
//   pio run -e btntest -t upload && pio device monitor -e btntest
#include <Arduino.h>
#include "robot_eyes.h"

#define OLED_SDA_PIN 41
#define OLED_SCL_PIN 42
#define EXPECTED_PIN 14

/**
 * Todos los GPIO del header de la extension board que se pueden leer sin
 * riesgo (fuera quedan flash/PSRAM 26-37, USB 19/20, UART 43/44 y la OLED).
 */
static const int kCandidatePins[] = {1,  2,  3,  4,  5,  6,  7,  8,  9,  10, 11, 12,
                                     13, 14, 15, 16, 17, 18, 21, 38, 39, 40, 45, 46,
                                     47, 48};
static constexpr size_t kPinCount = sizeof(kCandidatePins) / sizeof(kCandidatePins[0]);
static constexpr uint32_t DEBOUNCE_MS = 30;

struct PinState {
    bool stable = HIGH;
    bool lastReading = HIGH;
    uint32_t lastChangeMs = 0;
    uint32_t presses = 0;
};

static PinState states[kPinCount];

/**
 * Lee GPIO14 con pull-down un instante: con pull-up solo se ve si el botón va
 * a GND; con pull-down se ve si va a 3.3V/5V por error.
 */
static void probeExpectedPin()
{
    pinMode(EXPECTED_PIN, INPUT_PULLDOWN);
    delayMicroseconds(200);
    const int down = digitalRead(EXPECTED_PIN);
    pinMode(EXPECTED_PIN, INPUT_PULLUP);
    delayMicroseconds(200);
    const int up = digitalRead(EXPECTED_PIN);

    const char *verdict;
    if (up == 0 && down == 0) {
        verdict = "conectado a GND (boton presionado o cable directo a GND)";
    } else if (up == 1 && down == 1) {
        verdict = "conectado a 3.3V/5V!! El otro cable del boton debe ir a GND, no a VCC";
    } else {
        verdict = "suelto (boton sin presionar, o el boton no llega a este pin)";
    }
    Serial.printf("GPIO%d: pullup=%d pulldown=%d -> %s\n", EXPECTED_PIN, up, down,
                  verdict);
}

void setup()
{
    Serial.begin(115200);
    delay(300);
    Serial.println();
    Serial.println("===== TEST DE BOTON =====");
    Serial.println("Presiona el boton: se imprime el GPIO que cambie.");
    Serial.println("Mantenlo presionado ~5 s para ver el diagnostico de GPIO14.");

    for (size_t i = 0; i < kPinCount; i++) {
        pinMode(kCandidatePins[i], INPUT_PULLUP);
    }
    delay(10);
    for (size_t i = 0; i < kPinCount; i++) {
        const bool level = digitalRead(kCandidatePins[i]);
        states[i].stable = states[i].lastReading = level;
        if (level == LOW) {
            Serial.printf("GPIO %d ya esta en LOW al arrancar (algo lo lleva a GND)\n",
                          kCandidatePins[i]);
        }
    }

    if (robotEyesBegin(OLED_SDA_PIN, OLED_SCL_PIN)) {
        Serial.println("OLED OK: presiona el boton para ver los ojos felices");
    } else {
        Serial.println("OLED no encontrada: solo vas a ver el Serial");
    }
    robotEyesSetMood(EyesMood::Idle);
    probeExpectedPin();
}

void loop()
{
    const uint32_t now = millis();

    for (size_t i = 0; i < kPinCount; i++) {
        PinState &st = states[i];
        const bool reading = digitalRead(kCandidatePins[i]);
        if (reading != st.lastReading) {
            st.lastReading = reading;
            st.lastChangeMs = now;
            continue;
        }
        if (reading == st.stable || now - st.lastChangeMs < DEBOUNCE_MS) {
            continue;
        }

        st.stable = reading;
        if (st.stable == LOW) {
            st.presses++;
            Serial.printf(">>> BOTON PRESIONADO en GPIO %d (pulsacion #%lu)%s\n",
                          kCandidatePins[i], (unsigned long)st.presses,
                          kCandidatePins[i] == EXPECTED_PIN
                              ? ""
                              : "  <- no es GPIO14: el cable esta en otro pin");
            robotEyesPlayHappy();
        } else {
            Serial.printf("    soltado GPIO %d\n", kCandidatePins[i]);
        }
    }

    static uint32_t lastBeatMs = 0;
    if (now - lastBeatMs > 5000) {
        lastBeatMs = now;
        probeExpectedPin();
    }

    delay(2);
}
