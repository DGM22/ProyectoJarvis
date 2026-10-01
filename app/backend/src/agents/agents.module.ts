import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Agent } from './models/agent.model';
import { AgentsService } from './agents.service';
import { AgentsController } from './agents.controller';

/** Agentes de sistema (timbre, seguridad) con prompt editable en Postgres. */
@Module({
  imports: [SequelizeModule.forFeature([Agent])],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
