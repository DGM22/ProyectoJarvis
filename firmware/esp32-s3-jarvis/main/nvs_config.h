#pragma once

#include <stdbool.h>
#include <stddef.h>

#define JARVIS_WIFI_SSID_MAX 64
#define JARVIS_WIFI_PASS_MAX 64
#define JARVIS_WIFI_EAP_USER_MAX 64
#define JARVIS_WIFI_MAC_MAX 18
#define JARVIS_URL_MAX 160
#define JARVIS_TOKEN_MAX 96

typedef struct {
    char wifi_ssid[JARVIS_WIFI_SSID_MAX];
    char wifi_pass[JARVIS_WIFI_PASS_MAX];
    /** Vacío → WPA2-PSK. */
    char wifi_eap_user[JARVIS_WIFI_EAP_USER_MAX];
    /** "AA:BB:CC:DD:EE:FF"; vacío → MAC de fábrica. */
    char wifi_mac[JARVIS_WIFI_MAC_MAX];
    /** Base del backend: `wss://xxx.ngrok-free.app` o `ws://192.168.1.10:3000`. */
    char backend_url[JARVIS_URL_MAX];
    char device_token[JARVIS_TOKEN_MAX];
} jarvis_config_t;

/** Carga config desde NVS; si faltan claves, usa defaults de compile-time. */
bool nvs_config_load(jarvis_config_t *out);

/** Arma `<backend_url><path>` normalizando http(s)→ws(s) y quitando la `/` final. */
void nvs_config_build_url(const jarvis_config_t *cfg, const char *path, char *out, size_t out_len);

/** Persiste la config actual en NVS. */
bool nvs_config_save(const jarvis_config_t *cfg);
