import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { HouseholdController } from './household.controller';
import { HouseholdService } from './household.service';
import { HouseholdMember } from './models/household-member.model';

/** Quién vive en la casa: contexto compartido por timbre, seguridad y Jarvis. */
@Module({
  imports: [SequelizeModule.forFeature([HouseholdMember])],
  controllers: [HouseholdController],
  providers: [HouseholdService],
  exports: [HouseholdService],
})
export class HouseholdModule {}
