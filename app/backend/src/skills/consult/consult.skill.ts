import { BadRequestException, Injectable } from '@nestjs/common';
import { ConsultService } from '../../consult/consult.service';
import type {
  RealtimeFunctionTool,
  Skill,
  ToolExecutionContext,
} from '../skill.interface';

/**
 * Llamadas entre agentes: el timbre llama al dueño (`call_owner`) y el dueño
 * responde al timbre (`instruct_doorbell`) desde su sesión web.
 */
@Injectable()
export class ConsultSkill implements Skill {
  readonly name = 'consult';

  constructor(private readonly consultService: ConsultService) {}

  getTools(): RealtimeFunctionTool[] {
    return [
      {
        type: 'function',
        name: 'call_owner',
        description:
          'Doorbell only. Call the house owner in the web app so he decides what to tell the visitor. Pauses you (the visitor waits) until the owner answers or the ring times out. Call it again with new details if the visitor adds information while waiting.',
        parameters: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description:
                'Spanish summary for the owner: who the visitor is, what they want, who they ask for (e.g. "Repartidor de Amazon con un paquete para Daniel, pregunta si lo deja en la puerta").',
            },
          },
          required: ['summary'],
        },
      },
      {
        type: 'function',
        name: 'instruct_doorbell',
        description:
          'Deliver the owner\'s decision to the doorbell agent so it speaks to the visitor now (e.g. "Dile que deje el paquete en la puerta y gracias"). Write it as a clear instruction in Spanish.',
        parameters: {
          type: 'object',
          properties: {
            instruction: {
              type: 'string',
              description: 'What the doorbell agent must tell or do with the visitor',
            },
            consult_id: {
              type: 'string',
              description: 'Optional consult id; defaults to the active doorbell consult',
            },
          },
          required: ['instruction'],
        },
      },
      {
        type: 'function',
        name: 'end_consult',
        description:
          'Close the active doorbell consult when the matter is resolved or the owner says he is done.',
        parameters: {
          type: 'object',
          properties: {
            consult_id: {
              type: 'string',
              description: 'Optional consult id; defaults to the active doorbell consult',
            },
          },
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
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    switch (toolName) {
      case 'call_owner': {
        if (context?.channel !== 'device' || context.mode !== 'doorbell') {
          throw new BadRequestException('call_owner is only available from the doorbell');
        }
        return this.consultService.callOwner(
          context.sessionKey,
          this.requireString(args.summary, 'summary'),
        );
      }

      case 'instruct_doorbell':
        return this.consultService.instruct(
          this.resolveConsultId(args, context),
          this.requireString(args.instruction, 'instruction'),
        );

      case 'end_consult': {
        const snapshot = this.consultService.close(
          this.resolveConsultId(args, context),
        );
        return { closed: true, consultId: snapshot.id, status: snapshot.status };
      }

      default:
        throw new Error(`Unsupported consult tool: ${toolName}`);
    }
  }

  private resolveConsultId(
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): string | undefined {
    if (typeof args.consult_id === 'string' && args.consult_id.trim()) {
      return args.consult_id.trim();
    }
    return context?.consultId;
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${field} is required`);
    }
    return value.trim();
  }
}
