#include "wake_gate.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_log.h"
#include "esp_websocket_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "i2s_audio.h"

static const char *TAG = "wake_gate";

#define WAKE_RMS_THRESHOLD 2500.0f /* con 30 dB de ganancia, 800 se disparaba con ruido ambiente */
#define WAKE_FRAME_SAMPLES 1280 /* 80 ms @ 16 kHz — mismo frame que openWakeWord */
#define WAKE_STREAM_MS 2500
#define WAKE_COOLDOWN_MS 2500

static const jarvis_config_t *s_cfg;
static wake_detected_cb_t s_on_wake;
static void *s_ctx;
static bool s_enabled = true;
static bool s_running = false;
static esp_websocket_client_handle_t s_ww_client = NULL;
static volatile bool s_ww_connected = false;
static TickType_t s_last_wake_tick = 0;

static void ww_event(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
{
    esp_websocket_event_data_t *data = (esp_websocket_event_data_t *)event_data;
    if (event_id == WEBSOCKET_EVENT_CONNECTED) {
        s_ww_connected = true;
        ESP_LOGI(TAG, "wake-word WS connected");
    } else if (event_id == WEBSOCKET_EVENT_DISCONNECTED) {
        s_ww_connected = false;
    } else if (event_id == WEBSOCKET_EVENT_DATA && data->op_code == 0x1 && data->data_ptr) {
        cJSON *root = cJSON_ParseWithLength(data->data_ptr, (size_t)data->data_len);
        if (!root) {
            return;
        }
        const cJSON *ev = cJSON_GetObjectItem(root, "event");
        if (cJSON_IsString(ev) && strcmp(ev->valuestring, "wake_word.detected") == 0) {
            TickType_t now = xTaskGetTickCount();
            if ((now - s_last_wake_tick) > pdMS_TO_TICKS(WAKE_COOLDOWN_MS)) {
                s_last_wake_tick = now;
                ESP_LOGI(TAG, "Hey Jarvis detected");
                if (s_on_wake) {
                    s_on_wake(s_ctx);
                }
            }
        }
        cJSON_Delete(root);
    }
}

static bool ww_ensure_connected(void)
{
    if (s_ww_client && s_ww_connected) {
        return true;
    }
    if (s_ww_client) {
        esp_websocket_client_stop(s_ww_client);
        esp_websocket_client_destroy(s_ww_client);
        s_ww_client = NULL;
        s_ww_connected = false;
    }

    char url[256];
    nvs_config_build_url(s_cfg, "/wake-word", url, sizeof(url));

    esp_websocket_client_config_t ws_cfg = {
        .uri = url,
        .reconnect_timeout_ms = 3000,
        .network_timeout_ms = 5000,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .headers = "ngrok-skip-browser-warning: 1\r\n",
    };
    s_ww_client = esp_websocket_client_init(&ws_cfg);
    if (!s_ww_client) {
        return false;
    }
    esp_websocket_register_events(s_ww_client, WEBSOCKET_EVENT_ANY, ww_event, NULL);
    if (esp_websocket_client_start(s_ww_client) != ESP_OK) {
        return false;
    }

    /* Espera a CONNECTED (con wss:// el handshake TLS tarda ~1.5 s) */
    for (int i = 0; i < 150 && !s_ww_connected; i++) {
        vTaskDelay(pdMS_TO_TICKS(20));
    }
    return s_ww_connected;
}

static void ww_disconnect(void)
{
    if (s_ww_client) {
        esp_websocket_client_stop(s_ww_client);
        esp_websocket_client_destroy(s_ww_client);
        s_ww_client = NULL;
    }
    s_ww_connected = false;
}

static float frame_rms(const int16_t *samples, size_t n)
{
    if (n == 0) {
        return 0.0f;
    }
    double acc = 0.0;
    for (size_t i = 0; i < n; i++) {
        double v = (double)samples[i];
        acc += v * v;
    }
    return (float)sqrt(acc / (double)n);
}

static void wake_task(void *arg)
{
    (void)arg;
    int16_t frame[WAKE_FRAME_SAMPLES];
    ESP_LOGI(TAG, "wake gate task started (RMS threshold=%.0f)", WAKE_RMS_THRESHOLD);

    while (s_running) {
        if (!s_enabled) {
            /* Solo esta task toca s_ww_client: destruirlo desde otra (o desde su
             * propio callback de eventos) crasheaba el ESP32. */
            ww_disconnect();
            vTaskDelay(pdMS_TO_TICKS(100));
            continue;
        }

        int n = i2s_audio_read(frame, WAKE_FRAME_SAMPLES);
        if (n <= 0) {
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }

        float rms = frame_rms(frame, (size_t)n);
        if (rms < WAKE_RMS_THRESHOLD) {
            continue;
        }

        /* Energía suficiente → streamear unos segundos al servicio hey_jarvis */
        if (!ww_ensure_connected()) {
            ESP_LOGW(TAG, "wake-word service unreachable");
            vTaskDelay(pdMS_TO_TICKS(500));
            continue;
        }

        TickType_t start = xTaskGetTickCount();
        while (s_enabled && s_ww_connected &&
               (xTaskGetTickCount() - start) < pdMS_TO_TICKS(WAKE_STREAM_MS)) {
            int m = i2s_audio_read(frame, WAKE_FRAME_SAMPLES);
            if (m > 0) {
                esp_websocket_client_send_bin(s_ww_client, (const char *)frame,
                                              m * (int)sizeof(int16_t), pdMS_TO_TICKS(100));
            }
            /* Si ya detectó, salimos antes */
            if ((xTaskGetTickCount() - s_last_wake_tick) < pdMS_TO_TICKS(200)) {
                break;
            }
        }

        ww_disconnect();
        vTaskDelay(pdMS_TO_TICKS(200));
    }

    ww_disconnect();
    vTaskDelete(NULL);
}

bool wake_gate_start(const jarvis_config_t *cfg, wake_detected_cb_t on_wake, void *ctx)
{
    s_cfg = cfg;
    s_on_wake = on_wake;
    s_ctx = ctx;
    s_enabled = true;
    s_running = true;
    BaseType_t ok = xTaskCreate(wake_task, "wake_gate", 8192, NULL, 5, NULL);
    return ok == pdPASS;
}

void wake_gate_set_enabled(bool enabled)
{
    /* La task de wake gate cierra su WS al ver el flag en false. */
    s_enabled = enabled;
}

void wake_gate_stop(void)
{
    s_running = false;
    s_enabled = false;
}
