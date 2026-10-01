import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { ActivityLogEntry } from './models/activity-log-entry.model';

interface RecordParams {
  skillName: string;
  toolName: string;
  status: 'success' | 'error';
  args: Record<string, unknown>;
  result?: unknown;
  errorMessage?: string;
}

/**
 * Historial de acciones ejecutadas por Jarvis.
 *
 * Alimenta la vista de actividad reciente del frontend y el resumen de contexto
 * que se inyecta en las sesiones de voz.
 */
@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);

  constructor(
    @InjectModel(ActivityLogEntry)
    private readonly activityLogModel: typeof ActivityLogEntry,
  ) {}

  /**
   * Guarda una entrada del historial.
   *
   * Los fallos de escritura solo se registran en el log: el historial no debe
   * tumbar la ejecución de la herramienta que lo originó.
   *
   * @param params Datos de la ejecución a registrar.
   */
  async record(params: RecordParams): Promise<void> {
    const summary = this.buildSummary(
      params.toolName,
      params.status,
      params.args,
      params.result,
      params.errorMessage,
    );

    const detail: Record<string, unknown> = { args: params.args };
    if (params.result !== undefined) {
      detail.result = params.result;
    }

    try {
      await this.activityLogModel.create({
        skillName: params.skillName,
        toolName: params.toolName,
        status: params.status,
        summary,
        detail,
        errorMessage: params.errorMessage ?? null,
      });
    } catch (error) {
      this.logger.error('Failed to record activity log entry', error);
    }
  }

  /**
   * Lista las entradas más recientes, de la más nueva a la más antigua.
   *
   * @param limit Número máximo de entradas a devolver.
   */
  async listRecent(limit = 50): Promise<ActivityLogEntry[]> {
    return this.activityLogModel.findAll({
      order: [['created_at', 'DESC']],
      limit,
    });
  }

  /**
   * Arma un resumen en texto de las últimas acciones para el prompt de sesión.
   *
   * Las entradas se invierten a orden cronológico porque el modelo interpreta
   * mejor la secuencia de lo más antiguo a lo más reciente.
   *
   * @param limit Número de acciones a incluir.
   * @returns Texto listo para el prompt, o cadena vacía si no hay historial.
   */
  async buildContextSummary(limit = 10): Promise<string> {
    const entries = await this.activityLogModel.findAll({
      order: [['created_at', 'DESC']],
      limit,
    });

    if (entries.length === 0) {
      return '';
    }

    const lines = entries
      .reverse()
      .map((e) => `- [${e.status}] ${e.summary}`);

    return `Recent actions you performed:\n${lines.join('\n')}`;
  }

  /**
   * Traduce una ejecución a una frase corta en español para la interfaz.
   *
   * @param toolName Herramienta ejecutada.
   * @param status Resultado de la ejecución.
   * @param args Argumentos con los que se invocó.
   * @param result Salida de la herramienta, si hubo éxito.
   * @param errorMessage Mensaje de error, si falló.
   */
  private buildSummary(
    toolName: string,
    status: 'success' | 'error',
    args: Record<string, unknown>,
    result?: unknown,
    errorMessage?: string,
  ): string {
    if (status === 'error') {
      const base = TOOL_LABELS[toolName] ?? toolName;
      return `Error al ejecutar ${base}: ${errorMessage ?? 'desconocido'}`;
    }

    const r = (result ?? {}) as Record<string, unknown>;

    switch (toolName) {
      case 'create_calendar_event':
        return `Agendaste "${s(args.title)}"${args.start ? ` el ${s(args.start)}` : ''}`;
      case 'list_calendar_events':
        return 'Consultaste los próximos eventos del calendario';
      case 'update_calendar_event':
        return `Actualizaste el evento "${s(args.title ?? r.title ?? args.eventId)}"`;
      case 'delete_calendar_event':
        return `Eliminaste un evento del calendario`;

      case 'create_task':
        return `Creaste la tarea "${s(args.title)}"`;
      case 'list_tasks':
        return 'Consultaste la lista de tareas';
      case 'get_task':
        return `Consultaste los detalles de una tarea`;
      case 'update_task':
        return `Actualizaste la tarea "${s(args.title ?? r.title ?? args.taskId)}"`;
      case 'complete_task':
        return `Completaste la tarea "${s(r.title ?? args.taskId)}"`;
      case 'delete_task':
        return 'Eliminaste una tarea';

      case 'list_gmail_messages':
        return 'Revisaste la bandeja de Gmail';
      case 'get_gmail_message':
        return 'Leíste un correo de Gmail';
      case 'create_gmail_draft':
        return `Redactaste un borrador${args.to ? ` para ${s(args.to)}` : ''}${args.subject ? ` con asunto "${s(args.subject)}"` : ''}`;
      case 'update_gmail_draft':
        return 'Actualizaste un borrador de Gmail';
      case 'delete_gmail_message':
        return 'Eliminaste un correo de Gmail';

      case 'create_drive_file':
        return `Creaste el archivo "${s(args.name ?? args.title)}" en Drive`;
      case 'list_drive_files':
        return 'Consultaste archivos de Drive';
      case 'get_drive_file':
        return 'Consultaste un archivo de Drive';
      case 'update_drive_file':
        return `Actualizaste un archivo en Drive`;
      case 'delete_drive_file':
        return 'Eliminaste un archivo de Drive';

      case 'create_agent':
        return `Creaste el agente "${s(args.name ?? r.name)}"`;
      case 'list_agents':
        return 'Consultaste los agentes especializados disponibles';
      case 'run_agent':
        return `Ejecutaste el agente "${s(args.slug ?? r.agentSlug)}"`;
      case 'update_agent':
        return `Actualizaste el agente "${s(args.name ?? r.name ?? args.slug)}"`;
      case 'delete_agent':
        return `Eliminaste el agente "${s(args.slug)}"`;

      case 'kb_search':
        return `Consultaste la knowledge base${args.query ? ` sobre "${s(args.query)}"` : ''}`;
      case 'kb_save_fact':
        return `Guardaste el hecho "${s(args.subject)}"`;
      case 'kb_disputed_fact':
        return `Detectaste una posible contradicción en "${s(args.subject)}"`;
      case 'kb_passive_extract':
        return `Aprendiste (pasivo) el hecho "${s(args.subject)}"`;

      default:
        return `Ejecutaste ${toolName}`;
    }
  }
}

/**
 * Convierte un valor desconocido en texto seguro para interpolar.
 *
 * @param value Valor arbitrario proveniente de los argumentos o del resultado.
 */
function s(value: unknown): string {
  return value == null ? '' : String(value);
}

/** Nombres legibles de cada herramienta, usados en los mensajes de error. */
const TOOL_LABELS: Record<string, string> = {
  create_calendar_event: 'crear evento',
  list_calendar_events: 'listar eventos',
  update_calendar_event: 'actualizar evento',
  delete_calendar_event: 'eliminar evento',
  create_task: 'crear tarea',
  list_tasks: 'listar tareas',
  get_task: 'obtener tarea',
  update_task: 'actualizar tarea',
  complete_task: 'completar tarea',
  delete_task: 'eliminar tarea',
  list_gmail_messages: 'listar correos',
  get_gmail_message: 'leer correo',
  create_gmail_draft: 'crear borrador',
  update_gmail_draft: 'actualizar borrador',
  delete_gmail_message: 'eliminar correo',
  create_drive_file: 'crear archivo',
  list_drive_files: 'listar archivos',
  get_drive_file: 'obtener archivo',
  update_drive_file: 'actualizar archivo',
  delete_drive_file: 'eliminar archivo',
  create_agent: 'crear agente',
  list_agents: 'listar agentes',
  run_agent: 'ejecutar agente',
  update_agent: 'actualizar agente',
  delete_agent: 'eliminar agente',
  kb_search: 'buscar en knowledge base',
  kb_save_fact: 'guardar hecho',
  kb_disputed_fact: 'registrar disputa de hecho',
  kb_passive_extract: 'extraer hecho pasivo',
};
