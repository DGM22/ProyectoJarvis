import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { isToolAllowedInMode } from './session-tools';
import type {
  RealtimeFunctionTool,
  SessionMode,
  Skill,
  ToolExecutionContext,
} from './skill.interface';
import { SKILLS } from './skill.interface';

/**
 * Punto único de acceso a las skills disponibles.
 *
 * Publica las herramientas hacia la sesión Realtime, las despacha por nombre y
 * registra cada ejecución en el historial de actividad.
 */
@Injectable()
export class SkillsRegistryService {
  private readonly skills: Skill[];
  private readonly toolToSkill = new Map<string, Skill>();

  constructor(
    @Inject(SKILLS) skills: Skill[],
    private readonly activityLogService: ActivityLogService,
  ) {
    this.skills = skills;

    // Índice inverso construido una sola vez para resolver herramientas en O(1).
    for (const skill of skills) {
      for (const tool of skill.getTools()) {
        this.toolToSkill.set(tool.name, skill);
      }
    }
  }

  /** Devuelve todas las herramientas expuestas por las skills registradas. */
  getAllTools(): RealtimeFunctionTool[] {
    return this.skills.flatMap((skill) => skill.getTools());
  }

  /** Tools publicadas a una sesión según su persona. */
  getToolsForMode(mode: SessionMode): RealtimeFunctionTool[] {
    return this.getAllTools().filter((tool) =>
      isToolAllowedInMode(tool.name, mode),
    );
  }

  /**
   * Ejecuta una herramienta y deja constancia del resultado.
   *
   * @param toolName Nombre de la herramienta pedida por el modelo.
   * @param args Argumentos ya deserializados.
   * @param context Sesión que la pidió; restringe tools por modo.
   * @throws {NotFoundException} Si ninguna skill declara esa herramienta.
   * @throws {ForbiddenException} Si la tool no está permitida en ese modo.
   * @throws {ServiceUnavailableException} Si la ejecución falla.
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    const skill = this.toolToSkill.get(toolName);
    if (!skill) {
      throw new NotFoundException(`Unknown tool: ${toolName}`);
    }
    if (context && !isToolAllowedInMode(toolName, context.mode)) {
      throw new ForbiddenException(
        `Tool ${toolName} is not allowed in ${context.mode} mode`,
      );
    }

    try {
      const result = await skill.execute(toolName, args, context);

      void this.activityLogService.record({
        skillName: skill.name,
        toolName,
        status: 'success',
        args,
        result,
      });

      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Tool execution failed';

      void this.activityLogService.record({
        skillName: skill.name,
        toolName,
        status: 'error',
        args,
        errorMessage: message,
      });

      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      throw new ServiceUnavailableException(message);
    }
  }
}
