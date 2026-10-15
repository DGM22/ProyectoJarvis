import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { RealtimeModule } from '../realtime/realtime.module';
import { CameraHubModule } from './camera-hub.module';
import { CameraGateway } from './camera.gateway';
import { CameraViewGateway } from './camera-view.gateway';
import { DevicesController } from './devices.controller';
import { DevicesGateway } from './devices.gateway';
import { DevicesRegistryService } from './devices-registry.service';
import { DevicesService } from './devices.service';
import { Device } from './models/device.model';

/**
 * Dispositivos físicos Jarvis (ESP32): voz en `/devices`, JPEG en `/camera`.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([Device]),
    RealtimeModule,
    CameraHubModule,
  ],
  controllers: [DevicesController],
  providers: [
    DevicesService,
    DevicesRegistryService,
    DevicesGateway,
    CameraGateway,
    CameraViewGateway,
  ],
  exports: [
    DevicesService,
    DevicesRegistryService,
    DevicesGateway,
    CameraHubModule,
  ],
})
export class DevicesModule {}
