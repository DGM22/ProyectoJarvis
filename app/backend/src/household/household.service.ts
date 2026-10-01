import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import {
  HOUSEHOLD_ROLES,
  HouseholdMember,
  type HouseholdRole,
} from './models/household-member.model';

export interface HouseholdMemberInput {
  name: string;
  role?: HouseholdRole;
  notes?: string | null;
}

export interface HouseholdMemberDto {
  id: number;
  name: string;
  role: HouseholdRole;
  notes: string | null;
}

const DEFAULT_OWNER: HouseholdMemberInput = {
  name: 'Daniel Garza',
  role: 'owner',
  notes: 'Dueño de la casa. Decide quién entra y recibe los paquetes.',
};

/** Roster de la casa (dueño y residentes) inyectado en los prompts de voz. */
@Injectable()
export class HouseholdService implements OnModuleInit {
  private readonly logger = new Logger(HouseholdService.name);

  constructor(
    @InjectModel(HouseholdMember)
    private readonly memberModel: typeof HouseholdMember,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const count = await this.memberModel.count();
      if (count === 0) {
        await this.create(DEFAULT_OWNER);
        this.logger.log(`Seeded household owner: ${DEFAULT_OWNER.name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Could not seed household owner: ${message}`);
    }
  }

  async list(): Promise<HouseholdMemberDto[]> {
    const members = await this.memberModel.findAll({
      order: [
        ['role', 'ASC'],
        ['name', 'ASC'],
      ],
    });
    return members.map((member) => this.toDto(member));
  }

  async create(input: HouseholdMemberInput): Promise<HouseholdMemberDto> {
    const member = await this.memberModel.create({
      name: this.requireName(input.name),
      role: this.parseRole(input.role ?? 'resident'),
      notes: input.notes?.trim() || null,
    });
    return this.toDto(member);
  }

  async update(
    id: number,
    input: Partial<HouseholdMemberInput>,
  ): Promise<HouseholdMemberDto> {
    const member = await this.findById(id);
    await member.update({
      name: input.name === undefined ? member.name : this.requireName(input.name),
      role: input.role === undefined ? member.role : this.parseRole(input.role),
      notes:
        input.notes === undefined ? member.notes : input.notes?.trim() || null,
    });
    return this.toDto(member);
  }

  /** Crea o actualiza por nombre (case-insensitive); lo usa la tool de voz. */
  async upsertByName(input: HouseholdMemberInput): Promise<HouseholdMemberDto> {
    const name = this.requireName(input.name);
    const existing = (await this.memberModel.findAll()).find(
      (member) => member.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      return this.update(existing.id, input);
    }
    return this.create(input);
  }

  async remove(id: number): Promise<{ deleted: true; id: number }> {
    const member = await this.findById(id);
    await member.destroy();
    return { deleted: true, id };
  }

  /** Bloque de texto para las instrucciones Realtime (timbre, seguridad, Jarvis). */
  async buildContextSummary(): Promise<string> {
    let members: HouseholdMemberDto[];
    try {
      members = await this.list();
    } catch {
      return '';
    }
    if (members.length === 0) {
      return 'Household roster is empty.';
    }

    const lines = members.map((member) => {
      const role = member.role === 'owner' ? 'dueño' : 'residente';
      const notes = member.notes ? ` — ${member.notes}` : '';
      return `- ${member.name} (${role})${notes}`;
    });

    return [
      'Personas que viven en la casa (no sabes si están en casa ahora; para confirmarlo hay que llamar al dueño):',
      ...lines,
    ].join('\n');
  }

  async getOwnerName(): Promise<string> {
    const owner = await this.memberModel.findOne({ where: { role: 'owner' } });
    return owner?.name ?? DEFAULT_OWNER.name;
  }

  private async findById(id: number): Promise<HouseholdMember> {
    const member = await this.memberModel.findByPk(id);
    if (!member) {
      throw new NotFoundException(`Household member not found: ${id}`);
    }
    return member;
  }

  private requireName(name: string | undefined): string {
    const trimmed = name?.trim();
    if (!trimmed) {
      throw new BadRequestException('name is required');
    }
    return trimmed;
  }

  private parseRole(role: string): HouseholdRole {
    if (!(HOUSEHOLD_ROLES as readonly string[]).includes(role)) {
      throw new BadRequestException(
        `Invalid role "${role}". Allowed: ${HOUSEHOLD_ROLES.join(', ')}`,
      );
    }
    return role as HouseholdRole;
  }

  private toDto(member: HouseholdMember): HouseholdMemberDto {
    return {
      id: member.id,
      name: member.name,
      role: member.role,
      notes: member.notes,
    };
  }
}
