import { BadRequestException, Injectable } from '@nestjs/common';
import { HouseholdService } from '../../household/household.service';
import {
  HOUSEHOLD_ROLES,
  type HouseholdRole,
} from '../../household/models/household-member.model';
import type { RealtimeFunctionTool, Skill } from '../skill.interface';

/** Consulta y mantiene el roster de la casa por voz. */
@Injectable()
export class HouseholdSkill implements Skill {
  readonly name = 'household';

  constructor(private readonly householdService: HouseholdService) {}

  getTools(): RealtimeFunctionTool[] {
    return [
      {
        type: 'function',
        name: 'household_list',
        description:
          'List the people who live in the house (owner and residents). Use it when a visitor asks for someone or brings a package, to check the name is a real resident. It does NOT tell you who is home right now.',
        parameters: { type: 'object', properties: {} },
      },
      {
        type: 'function',
        name: 'household_save_member',
        description:
          'Add or update a person who lives in the house (matched by name). Only when the owner explicitly asks.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Full name' },
            role: {
              type: 'string',
              enum: HOUSEHOLD_ROLES,
              description: 'owner or resident (default resident)',
            },
            notes: {
              type: 'string',
              description: 'Optional notes, e.g. relationship or preferences',
            },
          },
          required: ['name'],
        },
      },
    ];
  }

  supports(toolName: string): boolean {
    return this.getTools().some((tool) => tool.name === toolName);
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (toolName) {
      case 'household_list':
        return { members: await this.householdService.list() };

      case 'household_save_member': {
        if (typeof args.name !== 'string' || !args.name.trim()) {
          throw new BadRequestException('name is required');
        }
        const member = await this.householdService.upsertByName({
          name: args.name,
          role:
            typeof args.role === 'string'
              ? (args.role as HouseholdRole)
              : undefined,
          notes: typeof args.notes === 'string' ? args.notes : undefined,
        });
        return { saved: true, member };
      }

      default:
        throw new Error(`Unsupported household tool: ${toolName}`);
    }
  }
}
