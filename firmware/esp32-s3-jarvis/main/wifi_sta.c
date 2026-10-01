#include "wifi_sta.h"

#include <stdio.h>
#include <string.h>

#include "esp_eap_client.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"

static const char *TAG = "wifi_sta";

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1
#define WIFI_MAX_RETRIES   10
#define WIFI_CONNECT_TIMEOUT_MS 30000

static EventGroupHandle_t s_wifi_events;
static int s_retry = 0;

static bool is_set(const char *value)
{
    return value != NULL && value[0] != '\0';
}

static void on_wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        const wifi_event_sta_disconnected_t *event = data;
        ESP_LOGW(TAG, "WiFi disconnected, reason=%d", event->reason);
        if (s_retry < WIFI_MAX_RETRIES) {
            s_retry++;
            ESP_LOGW(TAG, "retry connect (%d/%d)", s_retry, WIFI_MAX_RETRIES);
            esp_wifi_connect();
        } else {
            xEventGroupSetBits(s_wifi_events, WIFI_FAIL_BIT);
        }
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *event = data;
        ESP_LOGI(TAG, "IP: " IPSTR, IP2STR(&event->ip_info.ip));
        s_retry = 0;
        xEventGroupSetBits(s_wifi_events, WIFI_CONNECTED_BIT);
    }
}

/** Parsea "AA:BB:CC:DD:EE:FF" o "AA-BB-CC-DD-EE-FF" y exige una MAC unicast. */
static bool parse_mac(const char *text, uint8_t out[6])
{
    char sep = text[2];
    if (strlen(text) != 17 || (sep != ':' && sep != '-')) {
        return false;
    }

    const char fmt_colon[] = "%2hhx:%2hhx:%2hhx:%2hhx:%2hhx:%2hhx%n";
    const char fmt_dash[] = "%2hhx-%2hhx-%2hhx-%2hhx-%2hhx-%2hhx%n";
    int consumed = 0;
    int fields = sscanf(text, sep == ':' ? fmt_colon : fmt_dash,
                        &out[0], &out[1], &out[2], &out[3], &out[4], &out[5], &consumed);
    if (fields != 6 || consumed != 17) {
        return false;
    }

    static const uint8_t zero[6] = {0};
    return (out[0] & 0x01) == 0 && memcmp(out, zero, sizeof(zero)) != 0;
}

/** Debe llamarse con el modo STA ya fijado y antes de `esp_wifi_start()`. */
static void apply_custom_mac(const char *mac_text)
{
    if (!is_set(mac_text)) {
        return;
    }

    uint8_t mac[6];
    if (!parse_mac(mac_text, mac)) {
        ESP_LOGE(TAG, "MAC inválida \"%s\" (formato AA:BB:CC:DD:EE:FF, primer byte par); uso la de fábrica",
                 mac_text);
        return;
    }
    if ((mac[0] & 0x02) == 0) {
        ESP_LOGW(TAG, "MAC %s no es administrada localmente; asegúrate de que no choque con otro equipo",
                 mac_text);
    }

    esp_err_t err = esp_wifi_set_mac(WIFI_IF_STA, mac);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_wifi_set_mac falló (%s); uso la de fábrica", esp_err_to_name(err));
    }
}

static void configure_enterprise(const char *username, const char *password)
{
    ESP_ERROR_CHECK(esp_eap_client_set_identity((const unsigned char *)username, strlen(username)));
    ESP_ERROR_CHECK(esp_eap_client_set_username((const unsigned char *)username, strlen(username)));
    ESP_ERROR_CHECK(esp_eap_client_set_password((const unsigned char *)password, strlen(password)));
    ESP_ERROR_CHECK(esp_wifi_sta_enterprise_enable());
}

bool wifi_sta_connect(const wifi_sta_params_t *params)
{
    const bool enterprise = is_set(params->eap_username);

    s_wifi_events = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &on_wifi_event, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &on_wifi_event, NULL));

    wifi_config_t wifi_config = {0};
    strncpy((char *)wifi_config.sta.ssid, params->ssid, sizeof(wifi_config.sta.ssid) - 1);
    const char *security = "open";
    if (enterprise) {
        // En Enterprise la contraseña va por EAP, no en `sta.password` (eso es PSK).
        wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_ENTERPRISE;
        security = "WPA2-Enterprise";
    } else if (is_set(params->password)) {
        strncpy((char *)wifi_config.sta.password, params->password,
                sizeof(wifi_config.sta.password) - 1);
        wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
        security = "WPA2-PSK";
    } else {
        // Red abierta (p. ej. validada por MAC registrada).
        wifi_config.sta.threshold.authmode = WIFI_AUTH_OPEN;
    }

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    apply_custom_mac(params->mac);
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    if (enterprise) {
        configure_enterprise(params->eap_username, params->password);
    }

    ESP_ERROR_CHECK(esp_wifi_start());
    // Sin ahorro de energía: audio en tiempo real.
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));

    uint8_t active_mac[6];
    if (esp_wifi_get_mac(WIFI_IF_STA, active_mac) == ESP_OK) {
        ESP_LOGI(TAG, "Connecting to %s (%s) with MAC " MACSTR, params->ssid, security,
                 MAC2STR(active_mac));
    }

    EventBits_t bits = xEventGroupWaitBits(s_wifi_events, WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
                                           pdFALSE, pdFALSE,
                                           pdMS_TO_TICKS(WIFI_CONNECT_TIMEOUT_MS));
    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "Connected to %s", params->ssid);
        return true;
    }

    ESP_LOGE(TAG, "Failed to connect to %s", params->ssid);
    return false;
}
