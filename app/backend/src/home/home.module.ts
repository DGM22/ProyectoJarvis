import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ConsultModule } from '../consult/consult.module';
import { AttentionController } from './attention.controller';
import { AttentionService } from './attention.service';
import { HomeService } from './home.service';
import { InteractionsController } from './interactions.controller';
import { InteractionsService } from './interactions.service';
import { Access } from './models/access.model';
import { AppSetting } from './models/app-setting.model';
import { ActuatorActivation } from './models/actuator-activation.model';
import { Actuator } from './models/actuator.model';
import { AiResponse } from './models/ai-response.model';
import { Interaction } from './models/interaction.model';
import { OwnerNotification } from './models/notification.model';
import { PipelineError } from './models/pipeline-error.model';
import { Recognition } from './models/recognition.model';
import { SensorReading } from './models/sensor-reading.model';
import { Sensor } from './models/sensor.model';

const MODELS = [
  Sensor,
  Actuator,
  Interaction,
  SensorReading,
  Recognition,
  AiResponse,
  Access,
  ActuatorActivation,
  OwnerNotification,
  PipelineError,
  AppSetting,
];

/** Sensores, actuadores y el historial de eventos de la puerta. */
@Module({
  imports: [SequelizeModule.forFeature(MODELS), ConsultModule],
  controllers: [InteractionsController, AttentionController],
  providers: [HomeService, InteractionsService, AttentionService],
  exports: [HomeService, InteractionsService, AttentionService, SequelizeModule],
})
export class HomeModule {}
