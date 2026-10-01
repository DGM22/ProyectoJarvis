#pragma once

#include "nvs_config.h"

/**
 * State machine:
 * Idle → (wake | inbound) → Connecting → InCall → Idle
 *
 * Half-duplex: mic muted while display=speaking.
 */
void jarvis_sm_start(const jarvis_config_t *cfg);
