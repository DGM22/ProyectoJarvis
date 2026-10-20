import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ConsultModule } from '../consult/consult.module';
import { HomeModule } from '../home/home.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { CameraHubModule } from './camera-hub.module';
import { CameraGateway } from './camera.gateway';
import { CameraViewGateway } from './camera-view.gateway';
import { DevicesController } from './devices.controller';
import { DevicesGateway } from './devices.gateway';
import { DevicesRegistryService } from './devices-registry.service';
import { DevicesService } from './devices.service';
import { LiveGateway } from './live.gateway';
import { LiveSessionService } from './live-session.service';
import { Device } from './models/device.model';

/**
 * Dispositivos físicos Jarvis (ESP32): voz en `/devices`, JPEG en `/camera`.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([Device]),
    HomeModule,
    ConsultModule,
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
    LiveSessionService,
    LiveGateway,
  ],
  exports: [
    DevicesService,
    DevicesRegistryService,
    DevicesGateway,
    CameraHubModule,
  ],
})
export class DevicesModule {}
