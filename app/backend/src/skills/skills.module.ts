import { Module } from '@nestjs/common';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { ConsultModule } from '../consult/consult.module';
import { GoogleModule } from '../google/google.module';
import { HouseholdModule } from '../household/household.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { GoogleCalendarSkill } from './calendar/google-calendar.skill';
import { ConsultSkill } from './consult/consult.skill';
import { GoogleTasksSkill } from './tasks/google-tasks.skill';
import { GoogleGmailSkill } from './gmail/google-gmail.skill';
import { GoogleDriveSkill } from './drive/google-drive.skill';
import { HouseholdSkill } from './household/household.skill';
import { KnowledgeBaseSkill } from './knowledge-base/kb.skill';
import { SKILLS } from './skill.interface';
import { SkillsRegistryService } from './skills-registry.service';

/**
 * Registra las skills disponibles y el registro que las despacha.
 *
 * El provider `SKILLS` agrupa todas las instancias en un arreglo para que
 * `SkillsRegistryService` no dependa de cada skill por separado.
 */
@Module({
  imports: [
    GoogleModule,
    ActivityLogModule,
    KnowledgeBaseModule,
    HouseholdModule,
    ConsultModule,
  ],
  providers: [
    GoogleCalendarSkill,
    GoogleTasksSkill,
    GoogleGmailSkill,
    GoogleDriveSkill,
    KnowledgeBaseSkill,
    HouseholdSkill,
    ConsultSkill,
    {
      provide: SKILLS,
      useFactory: (
        calendarSkill: GoogleCalendarSkill,
        tasksSkill: GoogleTasksSkill,
        gmailSkill: GoogleGmailSkill,
        driveSkill: GoogleDriveSkill,
        knowledgeBaseSkill: KnowledgeBaseSkill,
        householdSkill: HouseholdSkill,
        consultSkill: ConsultSkill,
      ) => [
        calendarSkill,
        tasksSkill,
        gmailSkill,
        driveSkill,
        knowledgeBaseSkill,
        householdSkill,
        consultSkill,
      ],
      inject: [
        GoogleCalendarSkill,
        GoogleTasksSkill,
        GoogleGmailSkill,
        GoogleDriveSkill,
        KnowledgeBaseSkill,
        HouseholdSkill,
        ConsultSkill,
      ],
    },
    SkillsRegistryService,
  ],
  exports: [SkillsRegistryService],
})
export class SkillsModule {}
