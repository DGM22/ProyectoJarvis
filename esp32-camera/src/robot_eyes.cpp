#include "robot_eyes.h"

#include <Arduino.h>
#include <U8g2lib.h>
#include <Wire.h>
#include <math.h>

// 0 = SSD1306 (0.96"), 1 = SH1106 (1.3"). Si la imagen sale corrida o con
// basura en un costado, compila con -DOLED_SH1106=1.
#ifndef OLED_SH1106
#define OLED_SH1106 0
#endif

namespace {

constexpr uint8_t OLED_ADDR = 0x3C;
constexpr uint32_t OLED_BUS_HZ = 400000;
/** Un frame completo por I2C a 400 kHz tarda ~25 ms; 20 fps deja holgura. */
constexpr uint32_t FRAME_MS = 50;

constexpr int SCREEN_W = 128;
constexpr int SCREEN_H = 64;
constexpr int EYE_W = 34;
constexpr int EYE_H = 38;
constexpr int EYE_RADIUS = 8;
constexpr int EYE_GAP = 22;
constexpr uint32_t BLINK_MS = 160;
constexpr uint32_t HAPPY_MS = 2200;
constexpr uint32_t HAPPY_BOUNCE_MS = 520;

U8G2 *display = nullptr;
volatile EyesMood currentMood = EyesMood::Connecting;
volatile bool happyRequested = false;

struct EyeState {
    float x = 0;
    float y = 0;
    float targetX = 0;
    float targetY = 0;
    uint32_t nextLookMs = 0;
    uint32_t nextBlinkMs = 0;
    uint32_t blinkStartMs = 0;
    bool blinking = false;
    uint32_t happyStartMs = 0;
    bool happy = false;
};

void drawEye(int cx, int cy, int w, int h)
{
    h = max(h, 2);
    const int radius = min(EYE_RADIUS, min(w, h) / 2 - 1);
    const int x = cx - w / 2;
    const int y = cy - h / 2;
    if (radius >= 1) {
        display->drawRBox(x, y, w, h, radius);
    } else {
        display->drawBox(x, y, w, h);
    }
}

/** Mirada aleatoria: más inquieta cuando alguien está viendo. */
void updateGaze(EyeState &s, uint32_t now, bool watching)
{
    if (now >= s.nextLookMs) {
        const bool center = random(0, 3) == 0;
        s.targetX = center ? 0 : random(-12, 13);
        s.targetY = center ? 0 : random(-6, 7);
        s.nextLookMs = now + (watching ? random(700, 1800) : random(1500, 4000));
    }
    s.x += (s.targetX - s.x) * 0.3f;
    s.y += (s.targetY - s.y) * 0.3f;
}

/** Factor de apertura 0..1 del parpadeo en curso. */
float blinkFactor(EyeState &s, uint32_t now)
{
    if (!s.blinking && now >= s.nextBlinkMs) {
        s.blinking = true;
        s.blinkStartMs = now;
    }
    if (!s.blinking) {
        return 1.0f;
    }
    const uint32_t t = now - s.blinkStartMs;
    if (t >= BLINK_MS) {
        s.blinking = false;
        // A veces un doble parpadeo, como Cozmo.
        s.nextBlinkMs = now + (random(0, 5) == 0 ? 180 : random(2000, 5000));
        return 1.0f;
    }
    return 1.0f - 0.95f * sinf(PI * t / BLINK_MS);
}

/** Arcos ^ ^: ojo lleno al que se le "muerde" la parte baja con un disco negro. */
bool renderHappy(EyeState &s, uint32_t now)
{
    const uint32_t t = now - s.happyStartMs;
    if (t >= HAPPY_MS) {
        s.happy = false;
        s.nextBlinkMs = now + 1500;
        return false;
    }

    const float decay = 1.0f - static_cast<float>(t) / HAPPY_MS;
    const int bounce =
        static_cast<int>(-7.0f * fabsf(sinf(2.0f * PI * t / HAPPY_BOUNCE_MS)) * decay);
    const int w = 38;
    const int h = 30;
    const int cy = SCREEN_H / 2 + 4 + bounce;
    const int offset = EYE_GAP / 2 + w / 2;

    display->clearBuffer();
    for (const int side : {-1, 1}) {
        const int cx = SCREEN_W / 2 + side * offset;
        display->setDrawColor(1);
        drawEye(cx, cy, w, h);
        display->setDrawColor(0);
        display->drawDisc(cx, cy + h / 2 + 6, w / 2 + 3);
    }
    display->setDrawColor(1);
    display->sendBuffer();
    return true;
}

void renderFrame(EyeState &s, uint32_t now)
{
    if (happyRequested) {
        happyRequested = false;
        s.happy = true;
        s.happyStartMs = now;
    }
    if (s.happy && renderHappy(s, now)) {
        return;
    }

    const EyesMood mood = currentMood;
    int w = EYE_W;
    int h = EYE_H;

    if (mood == EyesMood::Connecting) {
        h = 4 + static_cast<int>(3.0f * (1.0f + sinf(now / 400.0f)));
        s.targetX = 0;
        s.targetY = 0;
        s.x += (s.targetX - s.x) * 0.3f;
        s.y += (s.targetY - s.y) * 0.3f;
    } else {
        const bool watching = mood == EyesMood::Watching;
        if (watching) {
            w += 4;
            h += 6;
        }
        updateGaze(s, now, watching);
        h = static_cast<int>(h * blinkFactor(s, now));
    }

    const int cy = SCREEN_H / 2 + static_cast<int>(s.y);
    const int offset = EYE_GAP / 2 + w / 2;
    const int cx = SCREEN_W / 2 + static_cast<int>(s.x);

    display->clearBuffer();
    drawEye(cx - offset, cy, w, h);
    drawEye(cx + offset, cy, w, h);
    display->sendBuffer();
}

void eyesTask(void *)
{
    EyeState state;
    const uint32_t start = millis();
    state.nextLookMs = start + 1500;
    state.nextBlinkMs = start + 2000;

    TickType_t lastWake = xTaskGetTickCount();
    for (;;) {
        renderFrame(state, millis());
        vTaskDelayUntil(&lastWake, pdMS_TO_TICKS(FRAME_MS));
    }
}

}  // namespace

bool robotEyesBegin(int sdaPin, int sclPin)
{
    if (display != nullptr) {
        return true;
    }

    // Wire = I2C0; la cámara usa I2C1 (SCCB), no comparten bus.
    Wire.begin(sdaPin, sclPin, OLED_BUS_HZ);
    Wire.beginTransmission(OLED_ADDR);
    if (Wire.endTransmission() != 0) {
        Serial.println("OLED no encontrada en 0x3C (SDA/SCL?)");
        return false;
    }

    // Sin pines a propósito: U8g2 les haría pinMode() y los desconectaría del
    // periférico I2C; su Wire.begin() sin args reutiliza el bus ya iniciado.
#if OLED_SH1106
    display = new U8G2_SH1106_128X64_NONAME_F_HW_I2C(U8G2_R0, U8X8_PIN_NONE);
#else
    display = new U8G2_SSD1306_128X64_NONAME_F_HW_I2C(U8G2_R0, U8X8_PIN_NONE);
#endif
    display->setI2CAddress(OLED_ADDR << 1);
    display->setBusClock(OLED_BUS_HZ);
    display->begin();

    xTaskCreatePinnedToCore(eyesTask, "robot_eyes", 4096, nullptr, 1, nullptr, 0);
    Serial.println("OLED OK: ojos de robot");
    return true;
}

void robotEyesSetMood(EyesMood mood)
{
    currentMood = mood;
}

void robotEyesPlayHappy()
{
    happyRequested = true;
}
