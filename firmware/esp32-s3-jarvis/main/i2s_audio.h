#pragma once

#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

#define I2S_SAMPLE_RATE_HZ 16000
#define I2S_BITS_PER_SAMPLE 16

/**
 * HAL de audio para el codec ES8311 de la Waveshare ESP32-S3-ePaper-1.54.
 *
 * API mono PCM16 16 kHz; internamente el bus I2S va en estéreo y se
 * convierte. La reproducción pasa por un buffer (~1 s) para no bloquear el
 * WebSocket mientras suena.
 */
bool i2s_audio_init(void);

/** Lee exactamente max_samples muestras PCM16 mono del micrófono. */
int i2s_audio_read(int16_t *dst, size_t max_samples);

/** Encola PCM16 mono para el speaker (bloquea si el buffer está lleno). */
int i2s_audio_write(const int16_t *src, size_t samples);

/** true mientras quede audio pendiente de reproducir. */
bool i2s_audio_is_playing(void);

/** Descarta el audio encolado (al colgar). */
void i2s_audio_flush_playback(void);

/** Habilita el envío del mic al servidor (half-duplex: off mientras speaking). */
void i2s_audio_set_mic_enabled(bool enabled);

bool i2s_audio_mic_enabled(void);
