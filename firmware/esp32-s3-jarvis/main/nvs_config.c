#include "nvs_config.h"

#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"

static const char *TAG = "nvs_config";
static const char *NS = "jarvis";

#ifndef CONFIG_JARVIS_WIFI_SSID
#define CONFIG_JARVIS_WIFI_SSID "YOUR_WIFI"
#endif
#ifndef CONFIG_JARVIS_WIFI_PASS
#define CONFIG_JARVIS_WIFI_PASS "YOUR_PASSWORD"
#endif
#ifndef CONFIG_JARVIS_WIFI_EAP_USERNAME
#define CONFIG_JARVIS_WIFI_EAP_USERNAME ""
#endif
#ifndef CONFIG_JARVIS_WIFI_MAC
#define CONFIG_JARVIS_WIFI_MAC ""
#endif
#ifndef CONFIG_JARVIS_BACKEND_URL
#define CONFIG_JARVIS_BACKEND_URL "wss://jarvis.gms-app.com"
#endif
#ifndef CONFIG_JARVIS_DEVICE_TOKEN
#define CONFIG_JARVIS_DEVICE_TOKEN "jdv_replace_me"
#endif

static void apply_defaults(jarvis_config_t *out)
{
    memset(out, 0, sizeof(*out));
    strncpy(out->wifi_ssid, CONFIG_JARVIS_WIFI_SSID, sizeof(out->wifi_ssid) - 1);
    strncpy(out->wifi_pass, CONFIG_JARVIS_WIFI_PASS, sizeof(out->wifi_pass) - 1);
    strncpy(out->wifi_eap_user, CONFIG_JARVIS_WIFI_EAP_USERNAME, sizeof(out->wifi_eap_user) - 1);
    strncpy(out->wifi_mac, CONFIG_JARVIS_WIFI_MAC, sizeof(out->wifi_mac) - 1);
    strncpy(out->backend_url, CONFIG_JARVIS_BACKEND_URL, sizeof(out->backend_url) - 1);
    strncpy(out->device_token, CONFIG_JARVIS_DEVICE_TOKEN, sizeof(out->device_token) - 1);
}

bool nvs_config_load(jarvis_config_t *out)
{
    apply_defaults(out);

    nvs_handle_t h;
    esp_err_t err = nvs_open(NS, NVS_READONLY, &h);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "NVS open failed (%s); using compile-time defaults",
                 esp_err_to_name(err));
        return true;
    }

    size_t len = sizeof(out->wifi_ssid);
    nvs_get_str(h, "wifi_ssid", out->wifi_ssid, &len);
    len = sizeof(out->wifi_pass);
    nvs_get_str(h, "wifi_pass", out->wifi_pass, &len);
    len = sizeof(out->wifi_eap_user);
    nvs_get_str(h, "wifi_eap_user", out->wifi_eap_user, &len);
    len = sizeof(out->wifi_mac);
    nvs_get_str(h, "wifi_mac", out->wifi_mac, &len);
    len = sizeof(out->backend_url);
    nvs_get_str(h, "backend_url", out->backend_url, &len);
    len = sizeof(out->device_token);
    nvs_get_str(h, "device_token", out->device_token, &len);
    nvs_close(h);
    ESP_LOGI(TAG, "Loaded config: backend=%s", out->backend_url);
    return true;
}

void nvs_config_build_url(const jarvis_config_t *cfg, const char *path, char *out, size_t out_len)
{
    const char *base = cfg->backend_url;
    const char *scheme = "";
    if (strncmp(base, "https://", 8) == 0) {
        scheme = "wss://";
        base += 8;
    } else if (strncmp(base, "http://", 7) == 0) {
        scheme = "ws://";
        base += 7;
    } else if (strstr(base, "://") == NULL) {
        scheme = "ws://";
    }
    size_t base_len = strlen(base);
    while (base_len > 0 && base[base_len - 1] == '/') {
        base_len--;
    }
    snprintf(out, out_len, "%s%.*s%s", scheme, (int)base_len, base, path);
}

bool nvs_config_save(const jarvis_config_t *cfg)
{
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) {
        return false;
    }
    nvs_set_str(h, "wifi_ssid", cfg->wifi_ssid);
    nvs_set_str(h, "wifi_pass", cfg->wifi_pass);
    nvs_set_str(h, "wifi_eap_user", cfg->wifi_eap_user);
    nvs_set_str(h, "wifi_mac", cfg->wifi_mac);
    nvs_set_str(h, "backend_url", cfg->backend_url);
    nvs_set_str(h, "device_token", cfg->device_token);
    nvs_commit(h);
    nvs_close(h);
    return true;
}
