#pragma once

typedef enum {
    DISPLAY_STATE_IDLE = 0,
    DISPLAY_STATE_CONNECTING,
    DISPLAY_STATE_LISTENING,
    DISPLAY_STATE_SPEAKING,
    DISPLAY_STATE_ERROR,
} display_state_t;

/**
 * HAL de e-ink SSD1681 200x200: 5 estados (anillo + texto).
 *
 * El refresh corre en su propia task (tarda ~0.3–2 s), así que
 * `display_hal_set_state` no bloquea y solo se pinta el último estado pedido.
 */
void display_hal_init(void);

void display_hal_set_state(display_state_t state);

display_state_t display_hal_get_state(void);

/** Mapea el string del protocolo (`idle`, `speaking`, …). */
void display_hal_set_state_str(const char *state);
