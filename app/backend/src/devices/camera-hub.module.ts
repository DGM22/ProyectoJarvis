import { Module } from '@nestjs/common';
import { CameraHubService } from './camera-hub.service';

/**
 * Relé de cámaras aislado de `DevicesModule` para que las skills lo importen
 * sin crear un ciclo (Devices → Realtime → Skills).
 */
@Module({
  providers: [CameraHubService],
  exports: [CameraHubService],
})
export class CameraHubModule {}
