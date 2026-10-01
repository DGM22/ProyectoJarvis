#include "i2s_audio.h"

#include <string.h>

#include "board.h"
#include "driver/i2s_std.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/stream_buffer.h"
#include "freertos/task.h"

static const char *TAG = "i2s_audio";

#define CHUNK_FRAMES 256
#define PLAYBACK_BUF_BYTES (32 * 1024) /* ~1 s de PCM16 mono 16 kHz */
/* El audio llega por internet a ráfagas: juntamos ~250 ms antes de sonar para
 * que el buffer no se vacíe entre paquetes (se oía como estática/cortes). */
#define PREBUFFER_BYTES (8 * 1024)
/* Si ya no llega más audio (respuesta corta), sonar lo que haya tras este tiempo. */
#define PREBUFFER_IDLE_MS 150
/* 0–100. La curva es lineal en dB: 100 = OUT_MAX_DB, 75 ≈ -12 dB (muy bajito). */
#define OUT_VOLUME 100
#define OUT_MAX_DB 6.0f
#define MIC_GAIN_DB 30.0f

static esp_codec_dev_handle_t s_codec = NULL;
static StreamBufferHandle_t s_play_buf = NULL;
static volatile bool s_mic_enabled = false;
static volatile bool s_play_active = false;
static volatile TickType_t s_last_write_tick = 0;

static void playback_task(void *arg)
{
    (void)arg;
    int16_t mono[CHUNK_FRAMES];
    int16_t stereo[CHUNK_FRAMES * 2];
    bool primed = false;

    while (1) {
        if (!primed) {
            size_t avail = xStreamBufferBytesAvailable(s_play_buf);
            bool stalled = avail > 0 &&
                           (xTaskGetTickCount() - s_last_write_tick) > pdMS_TO_TICKS(PREBUFFER_IDLE_MS);
            if (avail < PREBUFFER_BYTES && !stalled) {
                vTaskDelay(pdMS_TO_TICKS(10));
                continue;
            }
            primed = true;
        }
        size_t n = xStreamBufferReceive(s_play_buf, mono, sizeof(mono), pdMS_TO_TICKS(100));
        if (n == 0) {
            /* Se vació: volver a juntar colchón antes de seguir sonando. */
            primed = false;
            s_play_active = false;
            continue;
        }
        s_play_active = true;
        size_t frames = n / sizeof(int16_t);
        for (size_t i = 0; i < frames; i++) {
            stereo[2 * i] = mono[i];
            stereo[2 * i + 1] = mono[i];
        }
        esp_codec_dev_write(s_codec, stereo, (int)(frames * 2 * sizeof(int16_t)));
    }
}

bool i2s_audio_init(void)
{
    i2s_chan_handle_t tx = NULL;
    i2s_chan_handle_t rx = NULL;

    i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
    /* Sin auto_clear el DMA repite el último buffer → zumbido al quedarse sin audio. */
    chan_cfg.auto_clear = true;
    ESP_ERROR_CHECK(i2s_new_channel(&chan_cfg, &tx, &rx));

    i2s_std_config_t std_cfg = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(I2S_SAMPLE_RATE_HZ),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
        .gpio_cfg =
            {
                .mclk = BOARD_I2S_MCLK,
                .bclk = BOARD_I2S_BCLK,
                .ws = BOARD_I2S_WS,
                .dout = BOARD_I2S_DOUT,
                .din = BOARD_I2S_DIN,
            },
    };
    ESP_ERROR_CHECK(i2s_channel_init_std_mode(tx, &std_cfg));
    ESP_ERROR_CHECK(i2s_channel_init_std_mode(rx, &std_cfg));

    audio_codec_i2s_cfg_t i2s_if_cfg = {
        .port = I2S_NUM_0,
        .rx_handle = rx,
        .tx_handle = tx,
    };
    const audio_codec_data_if_t *data_if = audio_codec_new_i2s_data(&i2s_if_cfg);

    audio_codec_i2c_cfg_t i2c_cfg = {
        .port = BOARD_I2C_PORT,
        .addr = ES8311_CODEC_DEFAULT_ADDR,
        .bus_handle = board_i2c_bus(),
    };
    const audio_codec_ctrl_if_t *ctrl_if = audio_codec_new_i2c_ctrl(&i2c_cfg);
    const audio_codec_gpio_if_t *gpio_if = audio_codec_new_gpio();

    es8311_codec_cfg_t es_cfg = {
        .codec_mode = ESP_CODEC_DEV_WORK_MODE_BOTH,
        .ctrl_if = ctrl_if,
        .gpio_if = gpio_if,
        .pa_pin = BOARD_PA_EN,
        .use_mclk = true,
        .hw_gain.pa_gain = 6,
    };
    const audio_codec_if_t *codec_if = es8311_codec_new(&es_cfg);
    if (!data_if || !ctrl_if || !codec_if) {
        ESP_LOGE(TAG, "ES8311 init failed (¿I2C/power?)");
        return false;
    }

    esp_codec_dev_cfg_t dev_cfg = {
        .dev_type = ESP_CODEC_DEV_TYPE_IN_OUT,
        .codec_if = codec_if,
        .data_if = data_if,
    };
    s_codec = esp_codec_dev_new(&dev_cfg);
    if (!s_codec) {
        return false;
    }

    esp_codec_dev_sample_info_t fs = {
        .sample_rate = I2S_SAMPLE_RATE_HZ,
        .channel = 2,
        .bits_per_sample = 16,
    };
    if (esp_codec_dev_open(s_codec, &fs) != ESP_CODEC_DEV_OK) {
        ESP_LOGE(TAG, "codec open failed");
        return false;
    }
    esp_codec_dev_vol_map_t vol_map[] = {{.vol = 0, .db_value = -50.0f}, {.vol = 100, .db_value = OUT_MAX_DB}};
    esp_codec_dev_vol_curve_t vol_curve = {.vol_map = vol_map, .count = 2};
    esp_codec_dev_set_vol_curve(s_codec, &vol_curve);
    esp_codec_dev_set_out_vol(s_codec, OUT_VOLUME);
    esp_codec_dev_set_in_gain(s_codec, MIC_GAIN_DB);

    s_play_buf = xStreamBufferCreate(PLAYBACK_BUF_BYTES, 1);
    if (!s_play_buf) {
        return false;
    }
    xTaskCreate(playback_task, "audio_play", 4096, NULL, 7, NULL);

    ESP_LOGI(TAG, "ES8311 ready @ %d Hz", I2S_SAMPLE_RATE_HZ);
    return true;
}

int i2s_audio_read(int16_t *dst, size_t max_samples)
{
    if (!s_codec) {
        return -1;
    }
    int16_t stereo[CHUNK_FRAMES * 2];
    size_t done = 0;
    while (done < max_samples) {
        size_t frames = max_samples - done;
        if (frames > CHUNK_FRAMES) {
            frames = CHUNK_FRAMES;
        }
        if (esp_codec_dev_read(s_codec, stereo, (int)(frames * 2 * sizeof(int16_t))) !=
            ESP_CODEC_DEV_OK) {
            return done > 0 ? (int)done : -1;
        }
        /* El ES8311 es mono; promediar L/R funciona sin importar en qué slot llegue. */
        for (size_t i = 0; i < frames; i++) {
            dst[done + i] = (int16_t)(((int32_t)stereo[2 * i] + stereo[2 * i + 1]) / 2);
        }
        done += frames;
    }
    return (int)done;
}

int i2s_audio_write(const int16_t *src, size_t samples)
{
    if (!s_play_buf) {
        return -1;
    }
    size_t sent = xStreamBufferSend(s_play_buf, src, samples * sizeof(int16_t), pdMS_TO_TICKS(2000));
    if (sent > 0) {
        s_play_active = true;
        s_last_write_tick = xTaskGetTickCount();
    }
    return (int)(sent / sizeof(int16_t));
}

bool i2s_audio_is_playing(void)
{
    return s_play_active || (s_play_buf && xStreamBufferBytesAvailable(s_play_buf) > 0);
}

void i2s_audio_flush_playback(void)
{
    if (s_play_buf) {
        xStreamBufferReset(s_play_buf);
    }
}

void i2s_audio_set_mic_enabled(bool enabled)
{
    s_mic_enabled = enabled;
}

bool i2s_audio_mic_enabled(void)
{
    return s_mic_enabled;
}
