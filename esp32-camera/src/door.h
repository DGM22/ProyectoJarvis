#pragma once

#include <stdint.h>

/**
 * Servo de la puerta (SG90 o similar). El backend manda `door.open` cuando el
 * dueño pasa la verificación facial: el servo gira a "abierto", espera
 * `holdMs` y regresa a "cerrado". Todo sin bloquear el loop.
 *
 * El servo se alimenta de 5 V aparte (no del 3V3 de la placa) con GND común.
 */

/** Configura el PWM de 50 Hz en `pin` y deja el servo en "cerrado". */
bool doorBegin(int pin);

/** Abre la puerta `holdMs` ms; si ya estaba abierta, extiende el tiempo. */
void doorOpen(uint32_t holdMs);

/** Llamar en cada `loop()`: cierra al terminar el tiempo y suelta el PWM. */
void doorLoop();

/** True mientras el servo está en "abierto". */
bool doorIsOpen();
