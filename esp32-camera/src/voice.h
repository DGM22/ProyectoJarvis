#pragma once

#include <stdint.h>

/**
 * Voz con Jarvis por el WebSocket `/devices` (mismo protocolo que la placa
 * Waveshare): PCM16LE mono 16 kHz en binario, control en JSON.
 *
 * Mic INMP441 en I2S0 y MAX98357A en I2S1. La reproducción corre en su propia
 * tarea; todo lo del socket se hace desde `voiceLoop()` (la librería no es
 * thread-safe).
 */

/** Instala I2S y la tarea de audio. Devuelve false si falla el hardware. */
bool voiceBegin();

/** Abre el socket de voz; llamar una vez con WiFi listo. */
void voiceConnect(const char *host, uint16_t port, const char *token, bool tls);

/** Llamar en cada `loop()`: socket + envío del micrófono. */
void voiceLoop();

/** Botón: inicia la conversación o cuelga si ya hay una. */
void voiceToggleSession();

/** True mientras hay conversación (pedida o activa). */
bool voiceInSession();
