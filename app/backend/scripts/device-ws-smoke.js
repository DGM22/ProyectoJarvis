/**
 * Cliente de prueba del protocolo /devices (sin hardware).
 *
 * Uso:
 *   DEVICE_TOKEN=jdv_... BACKEND_URL=ws://localhost:3000 node scripts/device-ws-smoke.js
 *
 * Tras hello.ack envía session.request reason=wake y escucha display.set / audio.
 */
const WebSocket = require('ws');

const token = process.env.DEVICE_TOKEN;
const backend = (process.env.BACKEND_URL || 'ws://localhost:3000').replace(
  /\/$/,
  '',
);

if (!token) {
  console.error('Set DEVICE_TOKEN');
  process.exit(1);
}

const url = `${backend}/devices?token=${encodeURIComponent(token)}`;
const ws = new WebSocket(url);

ws.on('open', () => {
  console.log('connected');
  ws.send(
    JSON.stringify({
      type: 'hello',
      firmwareVersion: 'smoke-0.1',
      capabilities: ['voice'],
    }),
  );
});

ws.on('message', (data, isBinary) => {
  if (isBinary) {
    console.log(`audio frame ${data.length} bytes`);
    return;
  }
  const text = data.toString();
  console.log('←', text);
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  if (msg.type === 'hello.ack') {
    ws.send(JSON.stringify({ type: 'session.request', reason: 'wake' }));
  }
  if (msg.type === 'session.ready') {
    console.log('session ready — speak into a real device or end with Ctrl+C');
  }
});

ws.on('close', (code, reason) => {
  console.log('closed', code, reason.toString());
});

ws.on('error', (err) => {
  console.error(err);
});
