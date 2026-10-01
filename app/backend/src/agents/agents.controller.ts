import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AgentsService } from './agents.service';

type UpdateAgentBody = {
  name?: string;
  purpose?: string;
  systemPrompt?: string;
  status?: 'active' | 'inactive';
};

/** Agentes de sistema (timbre, seguridad): lectura y edición de la persona. */
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  list() {
    return this.agentsService.list();
  }

  @Patch(':slug')
  update(@Param('slug') slug: string, @Body() body: UpdateAgentBody) {
    return this.agentsService.update(slug, body);
  }

  @Post(':slug/reset')
  reset(@Param('slug') slug: string) {
    return this.agentsService.reset(slug);
  }
}
