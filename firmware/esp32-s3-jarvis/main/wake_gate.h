#pragma once

#include <stdbool.h>

#include "nvs_config.h"

typedef void (*wake_detected_cb_t)(void *ctx);

/**
 * Gate de wake word on-device:
 * - Mic local siempre escuchando.
 * - Si RMS supera umbral, abre WS a `/wake-word` y envía PCM.
 * - Al recibir `wake_word.detected` del servicio Python (hey_jarvis), callback.
 */
bool wake_gate_start(const jarvis_config_t *cfg, wake_detected_cb_t on_wake, void *ctx);

/** Pausa el gate (durante llamada de voz para no pelear por el mic). */
void wake_gate_set_enabled(bool enabled);

void wake_gate_stop(void);
