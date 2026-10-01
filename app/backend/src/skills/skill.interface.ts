/** Declaración de herramienta en el formato que espera OpenAI Realtime. */
export interface RealtimeFunctionTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Persona de la sesión de voz: `assistant` (Jarvis + Google), `doorbell`
 * (visitante en el timbre) o `security` (dueño atendiendo una consulta).
 */
export type SessionMode = 'assistant' | 'doorbell' | 'security';

/** Quién pidió la herramienta; permite a las skills actuar sobre su propia sesión. */
export interface ToolExecutionContext {
  channel: 'device' | 'web';
  /** Clave del puente ESP32 o `callId` de WebRTC. */
  sessionKey: string;
  mode: SessionMode;
  /** Consulta del timbre asociada a una llamada web en modo `security`. */
  consultId?: string;
}

/**
 * Contrato de una capacidad que Jarvis puede ejecutar por voz.
 *
 * Cada skill agrupa las herramientas de un dominio (Calendar, Tasks, Gmail,
 * Drive) y sabe resolverlas por nombre.
 */
export interface Skill {
  readonly name: string;
  getTools(): RealtimeFunctionTool[];
  supports(toolName: string): boolean;
  execute(
    toolName: string,
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown>;
}

/** Token de inyección para el arreglo de skills registradas. */
export const SKILLS = Symbol('SKILLS');
