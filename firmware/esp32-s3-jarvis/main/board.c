#include "board.h"

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "board";
static i2c_master_bus_handle_t s_i2c_bus = NULL;

void board_power_init(void)
{
    gpio_config_t io = {
        .pin_bit_mask = (1ULL << BOARD_EPD_PWR) | (1ULL << BOARD_AUDIO_PWR) | (1ULL << BOARD_VBAT_PWR),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&io));

    gpio_set_level(BOARD_VBAT_PWR, 1);
    gpio_set_level(BOARD_EPD_PWR, 0);
    gpio_set_level(BOARD_AUDIO_PWR, 0);
    /* Da tiempo a que el ES8311 arranque antes de hablarle por I2C. */
    vTaskDelay(pdMS_TO_TICKS(50));
    ESP_LOGI(TAG, "EPD + audio power on");
}

i2c_master_bus_handle_t board_i2c_bus(void)
{
    if (s_i2c_bus) {
        return s_i2c_bus;
    }
    i2c_master_bus_config_t cfg = {
        .i2c_port = BOARD_I2C_PORT,
        .sda_io_num = BOARD_I2C_SDA,
        .scl_io_num = BOARD_I2C_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    ESP_ERROR_CHECK(i2c_new_master_bus(&cfg, &s_i2c_bus));
    return s_i2c_bus;
}
