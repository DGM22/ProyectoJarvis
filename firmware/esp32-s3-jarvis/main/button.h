#pragma once

#include "driver/gpio.h"

typedef void (*button_press_cb_t)(void *ctx);

/**
 * Botón con debounce por polling (activo en bajo, pull-up interno).
 * El callback corre en la task del botón al detectar la pulsación.
 */
void button_start(gpio_num_t gpio, button_press_cb_t on_press, void *ctx);
