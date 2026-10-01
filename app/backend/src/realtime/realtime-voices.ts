/** Voces admitidas por la API Realtime de OpenAI. */
export const REALTIME_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
] as const;

export type RealtimeVoice = (typeof REALTIME_VOICES)[number];

/**
 * Type guard que valida si un valor arbitrario es una voz soportada.
 *
 * @param value Valor recibido desde la petición del cliente.
 */
export function isRealtimeVoice(value: unknown): value is RealtimeVoice {
  return (
    typeof value === 'string' &&
    (REALTIME_VOICES as readonly string[]).includes(value)
  );
}
