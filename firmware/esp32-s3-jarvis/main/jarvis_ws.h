#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "nvs_config.h"

typedef void (*jarvis_ws_text_cb_t)(const char *json, void *ctx);
typedef void (*jarvis_ws_bin_cb_t)(const uint8_t *data, size_t len, void *ctx);
typedef void (*jarvis_ws_conn_cb_t)(bool connected, void *ctx);

typedef struct {
    jarvis_ws_text_cb_t on_text;
    jarvis_ws_bin_cb_t on_bin;
    jarvis_ws_conn_cb_t on_conn;
    void *ctx;
} jarvis_ws_callbacks_t;

/** Conecta al gateway `/devices` del backend NestJS. */
bool jarvis_ws_start(const jarvis_config_t *cfg, const jarvis_ws_callbacks_t *cbs);

bool jarvis_ws_is_connected(void);

/** Envía mensaje de control JSON. */
bool jarvis_ws_send_text(const char *json);

/** Envía frame PCM16LE 16 kHz. */
bool jarvis_ws_send_bin(const void *data, size_t len);

void jarvis_ws_stop(void);
