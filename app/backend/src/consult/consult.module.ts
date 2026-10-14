import { Module } from '@nestjs/common';
import { ConsultGateway } from './consult.gateway';
import { ConsultService } from './consult.service';
import { IntercomGateway } from './intercom.gateway';

/**
 * Consultas timbre ↔ dueño (y su interfón directo). Sin dependencias para que
 * skills y realtime lo importen.
 */
@Module({
  providers: [ConsultService, ConsultGateway, IntercomGateway],
  exports: [ConsultService],
})
export class ConsultModule {}
