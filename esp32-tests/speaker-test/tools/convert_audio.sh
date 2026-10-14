#!/usr/bin/env bash
# Convierte cualquier audio/video (mp3, mp4, m4a, wav...) al formato que
# reproduce speaker-test: WAV PCM16 LE mono, normalizado para no saturar.
#
#   ./tools/convert_audio.sh ~/Downloads/cancion.mp4 musica        # 16 kHz
#   ./tools/convert_audio.sh ~/Downloads/cancion.mp4 musica 32000  # 32 kHz
#
# Luego: pio run -t uploadfs
set -euo pipefail
cd "$(dirname "$0")/.."

IN="${1:?uso: convert_audio.sh <archivo> <nombre> [rate]}"
NAME="${2:?falta el nombre de salida (ej. musica)}"
RATE="${3:-16000}"

case "$RATE" in
  8000|16000|32000|44100|48000) ;;
  *) echo "Rate $RATE no lo soporta el MAX98357A (usa 16000 o 32000)"; exit 1 ;;
esac

mkdir -p data
# loudnorm: volumen parejo (-18 LUFS) y picos max -3 dBFS para no recortar.
ffmpeg -hide_banner -loglevel error -y -i "$IN" -vn -ac 1 -ar "$RATE" \
  -af "loudnorm=I=-18:TP=-3:LRA=11" -c:a pcm_s16le "data/$NAME.wav"

ls -lh "data/$NAME.wav"
du -ch data/*.wav | tail -1 | awk '{print "Total en data/: "$1" (max ~5.4 MB)"}'
echo "Ahora: pio run -t uploadfs"
