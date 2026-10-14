import { Module } from '@nestjs/common';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { ConsultModule } from '../consult/consult.module';
import { HouseholdModule } from '../household/household.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { ConsultSkill } from './consult/consult.skill';
import { HouseholdSkill } from './household/household.skill';
import { KnowledgeBaseSkill } from './knowledge-base/kb.skill';
import { SKILLS } from './skill.interface';
import { SkillsRegistryService } from './skills-registry.service';

/**
 * Registra las skills de la casa y el registro que las despacha.
 *
 * El provider `SKILLS` agrupa todas las instancias en un arreglo para que
 * `SkillsRegistryService` no dependa de cada skill por separado.
 */
@Module({
  imports: [
    ActivityLogModule,
    KnowledgeBaseModule,
    HouseholdModule,
    ConsultModule,
  ],
  providers: [
    KnowledgeBaseSkill,
    HouseholdSkill,
    ConsultSkill,
    {
      provide: SKILLS,
      useFactory: (
        knowledgeBaseSkill: KnowledgeBaseSkill,
        householdSkill: HouseholdSkill,
        consultSkill: ConsultSkill,
      ) => [knowledgeBaseSkill, householdSkill, consultSkill],
      inject: [KnowledgeBaseSkill, HouseholdSkill, ConsultSkill],
    },
    SkillsRegistryService,
  ],
  exports: [SkillsRegistryService],
})
export class SkillsModule {}
