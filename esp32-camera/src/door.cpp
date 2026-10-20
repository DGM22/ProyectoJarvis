#include "door.h"

#include <Arduino.h>
#include "driver/gpio.h"
#include "driver/ledc.h"

// TIMER_0/CHANNEL_0 los usa la cámara para XCLK.
static constexpr ledc_mode_t SERVO_MODE = LEDC_LOW_SPEED_MODE;
static constexpr ledc_timer_t SERVO_TIMER = LEDC_TIMER_1;
static constexpr ledc_channel_t SERVO_CHANNEL = LEDC_CHANNEL_1;
static constexpr uint32_t SERVO_HZ = 50;
static constexpr uint32_t SERVO_RES_BITS = 14;
static constexpr uint32_t SERVO_PERIOD_US = 1000000 / SERVO_HZ;

/** SG90: 500 µs = 0°, 2500 µs = 180°. Ajusta si tu servo no llega a los topes. */
static constexpr uint32_t SERVO_MIN_US = 500;
static constexpr uint32_t SERVO_MAX_US = 2500;
static constexpr int DOOR_CLOSED_DEG = 0;
static constexpr int DOOR_OPEN_DEG = 90;
/** Tiempo para que el servo llegue a "cerrado" antes de soltar el PWM. */
static constexpr uint32_t SERVO_SETTLE_MS = 600;
/** Tope por si llega un holdMs absurdo: la puerta no se queda abierta. */
static constexpr uint32_t DOOR_MAX_HOLD_MS = 30000;

enum class DoorState { Idle, Open, Closing };

static bool ready = false;
static DoorState state = DoorState::Idle;
static uint32_t deadlineMs = 0;

static uint32_t dutyForDegrees(int deg)
{
    const uint32_t us = SERVO_MIN_US + (SERVO_MAX_US - SERVO_MIN_US) * deg / 180;
    return us * ((1u << SERVO_RES_BITS) - 1) / SERVO_PERIOD_US;
}

static void setDuty(uint32_t duty)
{
    ledc_set_duty(SERVO_MODE, SERVO_CHANNEL, duty);
    ledc_update_duty(SERVO_MODE, SERVO_CHANNEL);
}

/** `millis()` da la vuelta cada ~49 días: comparar por resta. */
static bool reached(uint32_t now, uint32_t deadline)
{
    return (int32_t)(now - deadline) >= 0;
}

bool doorBegin(int pin)
{
    // En GPIO19/20 esto también suelta el pad del USB nativo para usarlo como GPIO.
    gpio_reset_pin((gpio_num_t)pin);

    ledc_timer_config_t timer = {};
    timer.speed_mode = SERVO_MODE;
    timer.duty_resolution = (ledc_timer_bit_t)SERVO_RES_BITS;
    timer.timer_num = SERVO_TIMER;
    timer.freq_hz = SERVO_HZ;
    timer.clk_cfg = LEDC_AUTO_CLK;
    if (ledc_timer_config(&timer) != ESP_OK) {
        Serial.println("puerta: !!! no se pudo configurar el timer del servo");
        return false;
    }

    ledc_channel_config_t channel = {};
    channel.gpio_num = pin;
    channel.speed_mode = SERVO_MODE;
    channel.channel = SERVO_CHANNEL;
    channel.intr_type = LEDC_INTR_DISABLE;
    channel.timer_sel = SERVO_TIMER;
    channel.duty = dutyForDegrees(DOOR_CLOSED_DEG);
    channel.hpoint = 0;
    if (ledc_channel_config(&channel) != ESP_OK) {
        Serial.println("puerta: !!! no se pudo configurar el canal del servo");
        return false;
    }

    ready = true;
    state = DoorState::Closing;
    deadlineMs = millis() + SERVO_SETTLE_MS;
    Serial.printf("puerta: servo listo en GPIO %d (cerrada)\n", pin);
    return true;
}

void doorOpen(uint32_t holdMs)
{
    if (!ready) {
        Serial.println("puerta: !!! door.open sin servo configurado");
        return;
    }
    if (holdMs == 0 || holdMs > DOOR_MAX_HOLD_MS) {
        holdMs = DOOR_MAX_HOLD_MS;
    }
    setDuty(dutyForDegrees(DOOR_OPEN_DEG));
    state = DoorState::Open;
    deadlineMs = millis() + holdMs;
    Serial.printf("puerta: >>> ABRIENDO (%lu ms)\n", (unsigned long)holdMs);
}

void doorLoop()
{
    if (!ready || state == DoorState::Idle) {
        return;
    }
    const uint32_t now = millis();
    if (!reached(now, deadlineMs)) {
        return;
    }
    if (state == DoorState::Open) {
        setDuty(dutyForDegrees(DOOR_CLOSED_DEG));
        state = DoorState::Closing;
        deadlineMs = now + SERVO_SETTLE_MS;
        Serial.println("puerta: cerrando");
    } else {
        // Sin pulso el servo no zumba ni tiembla en reposo.
        setDuty(0);
        state = DoorState::Idle;
    }
}

bool doorIsOpen()
{
    return state == DoorState::Open;
}
