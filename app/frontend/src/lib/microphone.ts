/** Mic con limpieza del navegador: lo que usan Jarvis, el interfón y el wake word. */
export const VOICE_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/**
 * Pide el micrófono con mensajes en español en vez del error crudo del
 * navegador.
 *
 * `navigator.mediaDevices` solo existe en contextos seguros (`https://` o
 * `http://localhost`). Abriendo la app por `http://` con IP o dominio, Safari
 * revienta con "undefined is not an object (evaluating
 * 'navigator.mediaDevices.getUserMedia')".
 */
export async function requestMicrophone(
  audio: MediaTrackConstraints = VOICE_AUDIO_CONSTRAINTS,
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      window.isSecureContext
        ? 'Este navegador no permite usar el micrófono'
        : `El micrófono solo funciona con HTTPS. Abre la app en https://${window.location.host} (no por http:// ni por IP).`,
    );
  }

  try {
    return await navigator.mediaDevices.getUserMedia({ audio });
  } catch (err) {
    if (err instanceof DOMException) {
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        throw new Error(
          'Permiso de micrófono denegado: actívalo en la configuración del navegador para este sitio',
        );
      }
      if (err.name === 'NotFoundError') {
        throw new Error('No se encontró ningún micrófono');
      }
      if (err.name === 'NotReadableError') {
        throw new Error('El micrófono está ocupado por otra app o pestaña');
      }
    }
    throw err;
  }
}
