import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { RealtimeModule } from '../realtime/realtime.module';
import { CameraHubService } from './camera-hub.service';
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
  imports: [SequelizeModule.forFeature([Device]), RealtimeModule],
  controllers: [DevicesController],
  providers: [
    DevicesService,
    DevicesRegistryService,
    DevicesGateway,
    CameraHubService,
    CameraGateway,
    CameraViewGateway,
  ],
  exports: [
    DevicesService,
    DevicesRegistryService,
    DevicesGateway,
    CameraHubService,
  ],
})
export class DevicesModule {}
