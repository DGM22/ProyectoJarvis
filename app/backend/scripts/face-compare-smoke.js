/**
 * Prueba de la verificación facial sin el flujo de voz.
 *
 * Uso (desde app/backend, con AWS_REGION y credenciales en el .env de la raíz):
 *
 *   node scripts/face-compare-smoke.js referencia.jpg otra.jpg
 *     Compara dos fotos locales: valida credenciales/permisos de Rekognition.
 *
 *   node scripts/face-compare-smoke.js referencia.jpg
 *     Toma un frame en vivo de la cámara de la puerta (WS /camera-view),
 *     lo guarda en face-compare-frame.jpg y lo compara con la referencia.
 *     CAMERA_VIEW_URL=ws://localhost:3000/camera-view por defecto
 *     (en el servidor con Traefik: wss://jarvis.gms-app.com/api/camera-view).
 */
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const {
  CompareFacesCommand,
  RekognitionClient,
} = require('@aws-sdk/client-rekognition');

require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

/** Igual que el backend: los primeros frames tras encender salen oscuros. */
const WARMUP_MS = 600;
const FRAME_TIMEOUT_MS = 8000;

const [referencePath, candidatePath] = process.argv.slice(2);
if (!referencePath) {
  console.error(
    'Uso: node scripts/face-compare-smoke.js referencia.jpg [otra.jpg]',
  );
  process.exit(1);
}
if (!process.env.AWS_REGION) {
  console.error('Falta AWS_REGION (y credenciales) en el .env');
  process.exit(1);
}

function captureFrame() {
  const url = process.env.CAMERA_VIEW_URL || 'ws://localhost:3000/camera-view';
  console.log(`Conectando a ${url} …`);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('No llegó ningún frame: ¿la cámara está en línea?'));
    }, FRAME_TIMEOUT_MS);

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        console.log(`  ${data.toString()}`);
        return;
      }
      if (Date.now() - startedAt < WARMUP_MS) {
        return;
      }
      clearTimeout(timer);
      ws.close();
      resolve(Buffer.from(data));
    });
    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function main() {
  const reference = fs.readFileSync(referencePath);
  let candidate;
  if (candidatePath) {
    candidate = fs.readFileSync(candidatePath);
  } else {
    candidate = await captureFrame();
    fs.writeFileSync('face-compare-frame.jpg', candidate);
    console.log(
      `Frame guardado en face-compare-frame.jpg (${candidate.length} bytes)`,
    );
  }

  const client = new RekognitionClient({ region: process.env.AWS_REGION });
  const output = await client.send(
    new CompareFacesCommand({
      SourceImage: { Bytes: reference },
      TargetImage: { Bytes: candidate },
      SimilarityThreshold: 0,
      QualityFilter: 'AUTO',
    }),
  );

  const threshold = parseFloat(process.env.FACE_MATCH_THRESHOLD || '90');
  const similarities = (output.FaceMatches || []).map((m) => m.Similarity);
  const best = similarities.length > 0 ? Math.max(...similarities) : null;
  console.log(
    `Caras comparadas: ${similarities.length}, sin parecido: ${(output.UnmatchedFaces || []).length}`,
  );
  if (best === null) {
    console.log('Resultado: no_face (no se encontró una cara utilizable)');
  } else {
    console.log(
      `Resultado: ${best >= threshold ? 'match' : 'no_match'} — similitud ${best.toFixed(1)}% (umbral ${threshold}%)`,
    );
  }
}

main().catch((error) => {
  console.error(`Error: ${error.name || ''} ${error.message}`);
  process.exit(1);
});
