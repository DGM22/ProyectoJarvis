#include "button.h"

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "button";

#define BUTTON_POLL_MS 10
#define BUTTON_DEBOUNCE_MS 40

typedef struct {
    gpio_num_t gpio;
    button_press_cb_t on_press;
    void *ctx;
} button_t;

static void button_task(void *arg)
{
    button_t *btn = (button_t *)arg;
    bool pressed = false;
    int stable_ms = 0;

    while (1) {
        bool level_pressed = gpio_get_level(btn->gpio) == 0;
        if (level_pressed != pressed) {
            stable_ms += BUTTON_POLL_MS;
            if (stable_ms >= BUTTON_DEBOUNCE_MS) {
                pressed = level_pressed;
                stable_ms = 0;
                if (pressed) {
                    ESP_LOGI(TAG, "GPIO%d pressed", (int)btn->gpio);
                    btn->on_press(btn->ctx);
                }
            }
        } else {
            stable_ms = 0;
        }
        vTaskDelay(pdMS_TO_TICKS(BUTTON_POLL_MS));
    }
}

void button_start(gpio_num_t gpio, button_press_cb_t on_press, void *ctx)
{
    gpio_config_t io = {
        .pin_bit_mask = 1ULL << gpio,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&io));

    static button_t btn;
    btn.gpio = gpio;
    btn.on_press = on_press;
    btn.ctx = ctx;
    xTaskCreate(button_task, "button", 4096, &btn, 5, NULL);
}
