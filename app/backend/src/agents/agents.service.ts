import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import {
  DOORBELL_AGENT_NAME,
  DOORBELL_AGENT_PURPOSE,
  DOORBELL_AGENT_SLUG,
  DOORBELL_AGENT_SYSTEM_PROMPT,
} from './doorbell-agent.constants';
import { Agent } from './models/agent.model';
import {
  SECURITY_AGENT_NAME,
  SECURITY_AGENT_PURPOSE,
  SECURITY_AGENT_SLUG,
  SECURITY_AGENT_SYSTEM_PROMPT,
} from './security-agent.constants';

export interface UpdateAgentParams {
  name?: string;
  purpose?: string;
  systemPrompt?: string;
  status?: 'active' | 'inactive';
}

export interface AgentDto {
  id: number;
  slug: string;
  name: string;
  purpose: string;
  systemPrompt: string;
  status: 'active' | 'inactive';
  updatedAt: Date;
}

interface SystemAgentDefinition {
  slug: string;
  name: string;
  purpose: string;
  systemPrompt: string;
}

const SYSTEM_AGENTS: readonly SystemAgentDefinition[] = [
  {
    slug: DOORBELL_AGENT_SLUG,
    name: DOORBELL_AGENT_NAME,
    purpose: DOORBELL_AGENT_PURPOSE,
    systemPrompt: DOORBELL_AGENT_SYSTEM_PROMPT,
  },
  {
    slug: SECURITY_AGENT_SLUG,
    name: SECURITY_AGENT_NAME,
    purpose: SECURITY_AGENT_PURPOSE,
    systemPrompt: SECURITY_AGENT_SYSTEM_PROMPT,
  },
];

export type SystemAgentSlug = typeof DOORBELL_AGENT_SLUG | typeof SECURITY_AGENT_SLUG;

/**
 * Agentes de sistema (timbre y seguridad). Se crean solos al arrancar y su
 * persona se edita desde la app; no se crean ni ejecutan por voz.
 */
@Injectable()
export class AgentsService implements OnModuleInit {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    @InjectModel(Agent)
    private readonly agentModel: typeof Agent,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureSystemAgents();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Could not ensure system agents: ${message}`);
    }
  }

  /** Crea los agentes de sistema que falten; no pisa prompts ya editados. */
  async ensureSystemAgents(): Promise<void> {
    for (const definition of SYSTEM_AGENTS) {
      const existing = await this.agentModel.findOne({
        where: { slug: definition.slug },
      });
      if (existing) {
        continue;
      }
      await this.agentModel.create({
        ...definition,
        model: null,
        status: 'active',
      });
      this.logger.log(`Created system agent slug=${definition.slug}`);
    }
  }

  /**
   * Persona activa de un agente de sistema, o el default de código si la fila
   * falta, está inactiva o la base no responde.
   */
  async getSystemPrompt(slug: SystemAgentSlug): Promise<string> {
    const fallback =
      SYSTEM_AGENTS.find((definition) => definition.slug === slug)
        ?.systemPrompt ?? '';

    try {
      const agent = await this.agentModel.findOne({
        where: { slug, status: 'active' },
      });
      const prompt = agent?.systemPrompt?.trim();
      if (prompt) {
        return prompt;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`System prompt fallback for ${slug}: ${message}`);
    }

    return fallback;
  }

  async list(): Promise<AgentDto[]> {
    const agents = await this.agentModel.findAll({ order: [['name', 'ASC']] });
    return agents.map((agent) => this.toDto(agent));
  }

  async update(slug: string, params: UpdateAgentParams): Promise<AgentDto> {
    const agent = await this.findBySlug(slug);

    const systemPrompt = params.systemPrompt?.trim();
    if (params.systemPrompt !== undefined && !systemPrompt) {
      throw new BadRequestException('systemPrompt cannot be empty');
    }

    await agent.update({
      name: params.name?.trim() || agent.name,
      purpose: params.purpose?.trim() || agent.purpose,
      systemPrompt: systemPrompt ?? agent.systemPrompt,
      status: params.status ?? agent.status,
    });

    return this.toDto(agent);
  }

  /** Restaura la persona por defecto de un agente de sistema. */
  async reset(slug: string): Promise<AgentDto> {
    const agent = await this.findBySlug(slug);
    const definition = SYSTEM_AGENTS.find((item) => item.slug === agent.slug);
    if (!definition) {
      throw new BadRequestException(`${agent.slug} is not a system agent`);
    }
    await agent.update({
      name: definition.name,
      purpose: definition.purpose,
      systemPrompt: definition.systemPrompt,
      status: 'active',
    });
    return this.toDto(agent);
  }

  private async findBySlug(slug: string): Promise<Agent> {
    const normalized = slug.trim().toLowerCase();
    const agent = await this.agentModel.findOne({ where: { slug: normalized } });
    if (!agent) {
      throw new NotFoundException(`Agent not found: ${normalized}`);
    }
    return agent;
  }

  private toDto(agent: Agent): AgentDto {
    return {
      id: agent.id,
      slug: agent.slug,
      name: agent.name,
      purpose: agent.purpose,
      systemPrompt: agent.systemPrompt,
      status: agent.status,
      updatedAt: agent.updatedAt,
    };
  }
}
