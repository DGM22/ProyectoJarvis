import { Module } from '@nestjs/common';
import { WakeWordGateway } from './wake-word.gateway';
import { WakeWordBridgeService } from './wake-word-bridge.service';

/**
 * Expone la detección de palabra de activación ("Hey Jarvis").
 *
 * El navegador transmite audio al gateway y este lo reenvía al microservicio
 * Python que corre openWakeWord, manteniendo a Nest como único punto de
 * entrada y de trazabilidad.
 */
@Module({
  providers: [WakeWordGateway, WakeWordBridgeService],
})
export class WakeWordModule {}
