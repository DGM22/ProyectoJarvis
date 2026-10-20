import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { WsAdapter } from '@nestjs/platform-ws';
import { json, raw, text } from 'express';
import { AppModule } from './app.module';
import { FACE_PHOTO_MAX_BYTES } from './household/household.service';

/**
 * Arranca la aplicación Nest.
 *
 * El body parser global viene deshabilitado porque `/realtime/calls` recibe SDP
 * en texto plano y necesita su propio parser antes del de JSON.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const configService = app.get(ConfigService);

  // `FRONTEND_ORIGIN` admite varios orígenes separados por coma (p. ej. cuando
  // Vite salta de 5173 a 5174 porque el puerto está ocupado).
  const frontendOrigins = (
    configService.get<string>('frontendOrigin') ?? 'http://localhost:5173'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const port = configService.get<number>('backendPort') ?? 3000;

  // Se usa el adapter `ws` en vez del de socket.io por defecto, para que el
  // navegador pueda conectarse con la API WebSocket nativa.
  app.useWebSocketAdapter(new WsAdapter(app));

  app.use('/realtime/calls', text({ type: ['application/sdp', 'text/plain'] }));
  // Fotos de referencia para la verificación facial (cuerpo = imagen cruda).
  app.use(
    '/household',
    raw({ type: ['image/jpeg', 'image/png'], limit: FACE_PHOTO_MAX_BYTES }),
  );
  app.use(json());

  // Detrás de Cloudflare → Traefik: la IP real y el protocolo vienen en
  // X-Forwarded-* (límite de intentos de login y cookie Secure).
  app.getHttpAdapter().getInstance().set('trust proxy', true);

  app.enableCors({
    // Con `credentials: true` no vale `*`: se refleja solo un origen de la lista.
    origin: frontendOrigins,
    // La sesión viaja en cookie: en dev el front (5173) y el back (3000) son
    // orígenes distintos y el navegador solo la manda con credenciales.
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await app.listen(port);
  console.log(`Jarvis backend listening on http://localhost:${port}`);
}

void bootstrap();
