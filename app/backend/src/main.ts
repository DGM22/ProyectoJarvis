import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { WsAdapter } from '@nestjs/platform-ws';
import { json, text } from 'express';
import { AppModule } from './app.module';

/**
 * Arranca la aplicación Nest.
 *
 * El body parser global viene deshabilitado porque `/realtime/calls` recibe SDP
 * en texto plano y necesita su propio parser antes del de JSON.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const configService = app.get(ConfigService);

  const frontendOrigin =
    configService.get<string>('frontendOrigin') ?? 'http://localhost:5173';
  const port = configService.get<number>('backendPort') ?? 3000;

  // Se usa el adapter `ws` en vez del de socket.io por defecto, para que el
  // navegador pueda conectarse con la API WebSocket nativa.
  app.useWebSocketAdapter(new WsAdapter(app));

  app.use('/realtime/calls', text({ type: ['application/sdp', 'text/plain'] }));
  app.use(json());

  app.enableCors({
    origin: frontendOrigin,
    methods: ['GET', 'POST', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await app.listen(port);
  console.log(`Jarvis backend listening on http://localhost:${port}`);
}

void bootstrap();
