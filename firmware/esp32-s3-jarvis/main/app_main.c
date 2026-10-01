#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#include "board.h"
#include "display_hal.h"
#include "jarvis_sm.h"
#include "nvs_config.h"
#include "wifi_sta.h"

static const char *TAG = "app_main";

void app_main(void)
{
    ESP_LOGI(TAG, "Jarvis ESP32-S3 voice client boot");

    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }

    board_power_init();
    display_hal_init();

    static jarvis_config_t cfg;
    if (!nvs_config_load(&cfg)) {
        ESP_LOGE(TAG, "config load failed");
        return;
    }

    const wifi_sta_params_t wifi = {
        .ssid = cfg.wifi_ssid,
        .password = cfg.wifi_pass,
        .eap_username = cfg.wifi_eap_user,
        .mac = cfg.wifi_mac,
    };
    if (!wifi_sta_connect(&wifi)) {
        ESP_LOGE(TAG, "WiFi failed — check SSID/password in NVS or menuconfig; rebooting in 10 s");
        display_hal_set_state(DISPLAY_STATE_ERROR);
        vTaskDelay(pdMS_TO_TICKS(10000));
        esp_restart();
    }

    jarvis_sm_start(&cfg);
}
