#!/usr/bin/env bash
# Genera una voz en español (TTS de macOS) parecida a la respuesta de la IA,
# en el formato de Jarvis: PCM16 mono 16 kHz.
#
#   ./tools/make_voice.sh "Hola, soy Jarvis. ¿En qué te ayudo?"
#   ./tools/make_voice.sh "texto" otra_voz Eddy
set -euo pipefail
cd "$(dirname "$0")/.."

TEXT="${1:-Hola, soy Jarvis. Esta es una prueba de la bocina. Si me escuchas claro y sin ruido, el amplificador y la bocina estan funcionando bien. Uno, dos, tres, cuatro, cinco.}"
NAME="${2:-voz}"
VOICE="${3:-Paulina}"

TMP="$(mktemp -t jarvis_voice).aiff"
say -v "$VOICE" -o "$TMP" "$TEXT"
./tools/convert_audio.sh "$TMP" "$NAME" 16000
rm -f "$TMP"
