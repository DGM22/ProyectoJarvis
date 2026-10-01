#include "jarvis_sm.h"

#include <stdio.h>
#include <string.h>

#include "board.h"
#include "button.h"
#include "cJSON.h"
#include "display_hal.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "i2s_audio.h"
#include "jarvis_ws.h"
#include "sdkconfig.h"
#include "wake_gate.h"

static const char *TAG = "jarvis_sm";

typedef enum {
    SM_IDLE = 0,
    SM_CONNECTING,
    SM_IN_CALL,
} sm_state_t;

static const jarvis_config_t *s_cfg;
static volatile sm_state_t s_state = SM_IDLE;
static volatile bool s_speaking = false;

static void set_wake_enabled(bool enabled)
{
#if CONFIG_JARVIS_WAKE_WORD
    wake_gate_set_enabled(enabled);
#else
    (void)enabled;
#endif
}

static void send_hello(void)
{
    jarvis_ws_send_text(
        "{\"type\":\"hello\",\"firmwareVersion\":\"0.2.0\",\"capabilities\":[\"voice\",\"wake\",\"button\",\"eink\"]}");
}

/** Vuelve a reposo local (el server puede o no haber mandado session.end). */
static void go_idle(void)
{
    s_state = SM_IDLE;
    s_speaking = false;
    i2s_audio_set_mic_enabled(false);
    i2s_audio_flush_playback();
    set_wake_enabled(true);
    display_hal_set_state(DISPLAY_STATE_IDLE);
}

static void request_session(const char *reason)
{
    if (s_state != SM_IDLE) {
        return;
    }
    if (!jarvis_ws_is_connected()) {
        ESP_LOGW(TAG, "not connected to backend; ignoring %s", reason);
        display_hal_set_state(DISPLAY_STATE_ERROR);
        return;
    }
    s_state = SM_CONNECTING;
    display_hal_set_state(DISPLAY_STATE_CONNECTING);
    set_wake_enabled(false);

    char msg[64];
    snprintf(msg, sizeof(msg), "{\"type\":\"session.request\",\"reason\":\"%s\"}", reason);
    jarvis_ws_send_text(msg);
}

static void on_wake(void *ctx)
{
    (void)ctx;
    ESP_LOGI(TAG, "wake → session.request");
    request_session("wake");
}

/** Timbre: en reposo llama a Jarvis; durante la llamada cuelga. */
static void on_button(void *ctx)
{
    (void)ctx;
    if (s_state == SM_IDLE) {
        ESP_LOGI(TAG, "button → session.request");
        request_session("button");
    } else {
        ESP_LOGI(TAG, "button → session.end");
        jarvis_ws_send_text("{\"type\":\"session.end\",\"reason\":\"button\"}");
        go_idle();
    }
}

static void handle_server_text(const char *json, void *ctx)
{
    (void)ctx;
    cJSON *root = cJSON_Parse(json);
    if (!root) {
        return;
    }
    const cJSON *type = cJSON_GetObjectItem(root, "type");
    if (!cJSON_IsString(type)) {
        cJSON_Delete(root);
        return;
    }

    if (strcmp(type->valuestring, "hello.ack") == 0) {
        ESP_LOGI(TAG, "hello.ack received");
    } else if (strcmp(type->valuestring, "display.set") == 0) {
        const cJSON *state = cJSON_GetObjectItem(root, "state");
        /* Tras colgar localmente ignoramos estados rezagados de la sesión. */
        if (cJSON_IsString(state) && (s_state != SM_IDLE || strcmp(state->valuestring, "idle") == 0)) {
            display_hal_set_state_str(state->valuestring);
            s_speaking = strcmp(state->valuestring, "speaking") == 0;
            /* Half-duplex: mute mic while Jarvis habla */
            i2s_audio_set_mic_enabled(!s_speaking && s_state == SM_IN_CALL);
        }
    } else if (strcmp(type->valuestring, "session.ready") == 0) {
        s_state = SM_IN_CALL;
        i2s_audio_set_mic_enabled(true);
        s_speaking = false;
        ESP_LOGI(TAG, "session ready");
    } else if (strcmp(type->valuestring, "session.end") == 0) {
        go_idle();
        ESP_LOGI(TAG, "session ended");
    } else if (strcmp(type->valuestring, "inbound.start") == 0) {
        /* El servidor ya abre Realtime; solo preparamos audio/UI. */
        ESP_LOGI(TAG, "inbound.start — preparing speaker");
        set_wake_enabled(false);
        s_state = SM_CONNECTING;
        display_hal_set_state(DISPLAY_STATE_CONNECTING);
    } else if (strcmp(type->valuestring, "error") == 0) {
        const cJSON *msg = cJSON_GetObjectItem(root, "message");
        ESP_LOGE(TAG, "server error: %s",
                 cJSON_IsString(msg) ? msg->valuestring : "?");
        /* Si la llamada no llegó a arrancar, no nos quedamos colgados en "llamando". */
        if (s_state == SM_CONNECTING) {
            s_state = SM_IDLE;
            set_wake_enabled(true);
        }
        display_hal_set_state(DISPLAY_STATE_ERROR);
    }

    cJSON_Delete(root);
}

static void handle_server_bin(const uint8_t *data, size_t len, void *ctx)
{
    (void)ctx;
    if (s_state == SM_IDLE || len < 2 || (len % 2) != 0) {
        return;
    }
    i2s_audio_write((const int16_t *)data, len / 2);
}

static void on_conn(bool connected, void *ctx)
{
    (void)ctx;
    if (connected) {
        send_hello();
        display_hal_set_state(DISPLAY_STATE_IDLE);
    } else {
        go_idle();
        display_hal_set_state(DISPLAY_STATE_ERROR);
    }
}

static void mic_uplink_task(void *arg)
{
    (void)arg;
    int16_t buf[512];
    while (1) {
        /* No mandamos mic mientras aún suena audio encolado (evita que Jarvis se escuche a sí mismo). */
        if (s_state == SM_IN_CALL && i2s_audio_mic_enabled() && !s_speaking && !i2s_audio_is_playing()) {
            int n = i2s_audio_read(buf, 512);
            if (n > 0) {
                jarvis_ws_send_bin(buf, (size_t)n * sizeof(int16_t));
            }
        } else {
            vTaskDelay(pdMS_TO_TICKS(20));
        }
    }
}

void jarvis_sm_start(const jarvis_config_t *cfg)
{
    s_cfg = cfg;
    if (!i2s_audio_init()) {
        ESP_LOGE(TAG, "audio init failed");
        display_hal_set_state(DISPLAY_STATE_ERROR);
        return;
    }
    i2s_audio_set_mic_enabled(false);

    jarvis_ws_callbacks_t cbs = {
        .on_text = handle_server_text,
        .on_bin = handle_server_bin,
        .on_conn = on_conn,
        .ctx = NULL,
    };
    if (!jarvis_ws_start(cfg, &cbs)) {
        ESP_LOGE(TAG, "devices WS failed to start");
        display_hal_set_state(DISPLAY_STATE_ERROR);
        return;
    }

    button_start(BOARD_BOOT_BUTTON, on_button, NULL);
#if CONFIG_JARVIS_WAKE_WORD
    wake_gate_start(cfg, on_wake, NULL);
#else
    (void)on_wake;
#endif
    xTaskCreate(mic_uplink_task, "mic_uplink", 4096, NULL, 6, NULL);
    ESP_LOGI(TAG, "state machine running (BOOT = llamar/colgar)");
}
