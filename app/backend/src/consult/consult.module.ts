import { Module } from '@nestjs/common';
import { ConsultGateway } from './consult.gateway';
import { ConsultService } from './consult.service';

/** Consultas timbre ↔ dueño. Sin dependencias para que skills y realtime lo importen. */
@Module({
  providers: [ConsultService, ConsultGateway],
  exports: [ConsultService],
})
export class ConsultModule {}
