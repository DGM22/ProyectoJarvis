#include "jarvis_ws.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_crt_bundle.h"
#include "esp_log.h"
#include "esp_websocket_client.h"
#include "freertos/FreeRTOS.h"

static const char *TAG = "jarvis_ws";

static esp_websocket_client_handle_t s_client = NULL;
static jarvis_ws_callbacks_t s_cbs;
static bool s_connected = false;

static void on_ws_event(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
{
    esp_websocket_event_data_t *data = (esp_websocket_event_data_t *)event_data;
    switch (event_id) {
    case WEBSOCKET_EVENT_CONNECTED:
        s_connected = true;
        ESP_LOGI(TAG, "connected to /devices");
        if (s_cbs.on_conn) {
            s_cbs.on_conn(true, s_cbs.ctx);
        }
        break;
    case WEBSOCKET_EVENT_DISCONNECTED:
        s_connected = false;
        ESP_LOGW(TAG, "disconnected");
        if (s_cbs.on_conn) {
            s_cbs.on_conn(false, s_cbs.ctx);
        }
        break;
    case WEBSOCKET_EVENT_DATA:
        if (data->op_code == 0x1 && data->data_ptr && data->data_len > 0) {
            /* text */
            char *buf = calloc((size_t)data->data_len + 1, 1);
            if (buf) {
                memcpy(buf, data->data_ptr, (size_t)data->data_len);
                if (s_cbs.on_text) {
                    s_cbs.on_text(buf, s_cbs.ctx);
                }
                free(buf);
            }
        } else if (data->op_code == 0x2 && data->data_ptr && data->data_len > 0) {
            if (s_cbs.on_bin) {
                s_cbs.on_bin((const uint8_t *)data->data_ptr, (size_t)data->data_len, s_cbs.ctx);
            }
        }
        break;
    default:
        break;
    }
}

bool jarvis_ws_start(const jarvis_config_t *cfg, const jarvis_ws_callbacks_t *cbs)
{
    if (!cfg || !cbs) {
        return false;
    }
    s_cbs = *cbs;

    char path[160];
    snprintf(path, sizeof(path), "/devices?token=%s", cfg->device_token);
    char url[320];
    nvs_config_build_url(cfg, path, url, sizeof(url));

    esp_websocket_client_config_t ws_cfg = {
        .uri = url,
        .reconnect_timeout_ms = 5000,
        .network_timeout_ms = 10000,
        /* Chunks de audio del server (~2–4 KB) llegan completos en un solo evento. */
        .buffer_size = 4096,
        /* wss:// (ngrok): valida el certificado con el bundle de CAs de ESP-IDF. */
        .crt_bundle_attach = esp_crt_bundle_attach,
        /* Evita la página de aviso de ngrok free. */
        .headers = "ngrok-skip-browser-warning: 1\r\n",
        .ping_interval_sec = 20,
    };

    s_client = esp_websocket_client_init(&ws_cfg);
    if (!s_client) {
        return false;
    }
    esp_websocket_register_events(s_client, WEBSOCKET_EVENT_ANY, on_ws_event, NULL);
    esp_err_t err = esp_websocket_client_start(s_client);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "start failed: %s", esp_err_to_name(err));
        return false;
    }
    ESP_LOGI(TAG, "connecting to %s/devices", cfg->backend_url);
    return true;
}

bool jarvis_ws_is_connected(void)
{
    return s_connected && s_client && esp_websocket_client_is_connected(s_client);
}

bool jarvis_ws_send_text(const char *json)
{
    if (!jarvis_ws_is_connected() || !json) {
        return false;
    }
    int n = esp_websocket_client_send_text(s_client, json, (int)strlen(json), pdMS_TO_TICKS(1000));
    return n >= 0;
}

bool jarvis_ws_send_bin(const void *data, size_t len)
{
    if (!jarvis_ws_is_connected() || !data || len == 0) {
        return false;
    }
    int n = esp_websocket_client_send_bin(s_client, (const char *)data, (int)len, pdMS_TO_TICKS(1000));
    return n >= 0;
}

void jarvis_ws_stop(void)
{
    if (s_client) {
        esp_websocket_client_stop(s_client);
        esp_websocket_client_destroy(s_client);
        s_client = NULL;
    }
    s_connected = false;
}
