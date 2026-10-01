#pragma once

#include <stdbool.h>

typedef struct {
    const char *ssid;
    /** NULL o "" sin usuario EAP → red abierta. */
    const char *password;
    /** NULL o "" → WPA2-PSK; con valor → WPA2-Enterprise (PEAP/TTLS). */
    const char *eap_username;
    /** "AA:BB:CC:DD:EE:FF" (acepta `-`); NULL o "" → MAC de fábrica. */
    const char *mac;
} wifi_sta_params_t;

/** Conecta WiFi STA y bloquea hasta IP o timeout (~30s). */
bool wifi_sta_connect(const wifi_sta_params_t *params);
