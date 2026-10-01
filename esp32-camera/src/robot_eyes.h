#pragma once

#include <stdint.h>

enum class EyesMood : uint8_t {
    /** Sin WiFi o sin backend: dos líneas que "respiran". */
    Connecting,
    /** En línea, nadie viendo: parpadea y mira alrededor. */
    Idle,
    /** Hay un viewer en el stream: ojos grandes y atentos. */
    Watching,
};

/**
 * Inicia la OLED (I2C, 0x3C) y la animación en una tarea del core 0 para no
 * frenar el `loop()` de la cámara. Devuelve false si no hay pantalla.
 */
bool robotEyesBegin(int sdaPin, int sclPin);

/** Seguro de llamar en cada `loop()`; solo cambia la animación. */
void robotEyesSetMood(EyesMood mood);

/** Ojos felices ^ ^ con rebote (~2 s) encima del estado actual. */
void robotEyesPlayHappy();
