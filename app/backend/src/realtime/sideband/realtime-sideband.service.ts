import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import { ConsultService } from '../../consult/consult.service';
import type { OwnerSessionController } from '../../consult/consult.types';
import type { SessionMode } from '../../skills/skill.interface';
import { SkillsRegistryService } from '../../skills/skills-registry.service';

interface RealtimeFunctionCallItem {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
}

interface RealtimeResponseDoneEvent {
  type: 'response.done';
  response?: {
    output?: Array<{ type: string; call_id?: string; name?: string; arguments?: string }>;
  };
}

export interface SidebandAttachOptions {
  mode: SessionMode;
  consultId?: string;
}

interface SidebandConnection {
  ws: WebSocket;
  options: SidebandAttachOptions;
  owner: OwnerSessionController | null;
  responseActive: boolean;
  queuedResponse: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Canal lateral que ejecuta las herramientas pedidas durante una llamada.
 *
 * El audio viaja por WebRTC entre el navegador y OpenAI, así que este servicio
 * abre un WebSocket paralelo por llamada para atender los `function_call` y
 * devolver sus resultados al modelo. En modo `security` también recibe los
 * mensajes nuevos del timbre para contárselos al dueño.
 */
@Injectable()
export class RealtimeSidebandService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeSidebandService.name);
  private readonly connections = new Map<string, SidebandConnection>();

  constructor(
    private readonly configService: ConfigService,
    private readonly skillsRegistry: SkillsRegistryService,
    private readonly consultService: ConsultService,
  ) {}

  /**
   * Abre el canal lateral de una llamada, si no existe ya.
   *
   * @param callId Identificador de llamada devuelto por OpenAI.
   * @param options Persona de la llamada y consulta del timbre asociada.
   * @throws {ServiceUnavailableException} Si falta la API key de OpenAI.
   */
  attach(callId: string, options: SidebandAttachOptions): void {
    if (this.connections.has(callId)) {
      return;
    }

    const apiKey = this.configService.get<string>('openai.apiKey');
    if (!apiKey) {
      throw new ServiceUnavailableException('OPENAI_API_KEY is not configured');
    }

    const ws = new WebSocket(
      `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    const connection: SidebandConnection = {
      ws,
      options,
      owner: null,
      responseActive: false,
      queuedResponse: false,
    };
    this.connections.set(callId, connection);

    if (options.mode === 'security' && options.consultId) {
      const consultId = options.consultId;
      const owner: OwnerSessionController = {
        notify: (text) => this.notifyOwner(connection, text),
      };
      connection.owner = owner;
      this.consultService.registerOwnerSession(consultId, owner);
    }

    ws.on('open', () => {
      this.logger.log(`Sideband connected for call ${callId} (${options.mode})`);
    });

    ws.on('message', (data) => {
      void this.handleMessage(callId, connection, data.toString());
    });

    ws.on('close', () => {
      this.release(callId, connection);
      this.logger.log(`Sideband closed for call ${callId}`);
    });

    ws.on('error', (error) => {
      this.logger.error(`Sideband error for call ${callId}`, error);
      this.release(callId, connection);
    });
  }

  /**
   * Cierra el canal lateral de una llamada concreta.
   *
   * @param callId Identificador de llamada devuelto por OpenAI.
   */
  detach(callId: string): void {
    const connection = this.connections.get(callId);
    if (connection) {
      connection.ws.close();
      this.release(callId, connection);
    }
  }

  /** Cierra todos los canales laterales al apagar la aplicación. */
  onModuleDestroy(): void {
    for (const [callId, connection] of this.connections.entries()) {
      connection.ws.close();
      this.release(callId, connection);
    }
  }

  private release(callId: string, connection: SidebandConnection): void {
    if (this.connections.get(callId) === connection) {
      this.connections.delete(callId);
    }
    if (connection.owner && connection.options.consultId) {
      this.consultService.unregisterOwnerSession(
        connection.options.consultId,
        connection.owner,
      );
      connection.owner = null;
    }
  }

  /** Inyecta un aviso del timbre y pide a Jarvis que se lo diga al dueño. */
  private notifyOwner(connection: SidebandConnection, text: string): void {
    this.send(connection.ws, {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [{ type: 'input_text', text }],
      },
    });
    this.requestResponse(connection);
  }

  private requestResponse(connection: SidebandConnection): void {
    if (connection.responseActive) {
      connection.queuedResponse = true;
      return;
    }
    connection.responseActive = true;
    this.send(connection.ws, { type: 'response.create' });
  }

  /**
   * Procesa un evento del canal lateral y despacha las herramientas pedidas.
   *
   * `response.done` agrupa las llamadas a función de ese turno; también libera
   * la respuesta encolada si el timbre avisó mientras Jarvis hablaba.
   */
  private async handleMessage(
    callId: string,
    connection: SidebandConnection,
    raw: string,
  ): Promise<void> {
    let event: unknown;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    if (!isRecord(event) || typeof event.type !== 'string') {
      return;
    }

    if (event.type === 'response.created') {
      connection.responseActive = true;
      return;
    }

    if (event.type === 'error') {
      const message =
        isRecord(event.error) && typeof event.error.message === 'string'
          ? event.error.message
          : '';
      if (!/active response/i.test(message)) {
        connection.responseActive = false;
      }
      return;
    }

    if (event.type !== 'response.done') {
      return;
    }
    connection.responseActive = false;

    const responseDone = event as unknown as RealtimeResponseDoneEvent;
    const functionCalls = (responseDone.response?.output ?? []).filter(
      (item): item is RealtimeFunctionCallItem =>
        item.type === 'function_call' &&
        typeof item.call_id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.arguments === 'string',
    );

    for (const functionCall of functionCalls) {
      await this.executeFunctionCall(callId, connection, functionCall);
    }

    if (functionCalls.length > 0 || connection.queuedResponse) {
      connection.queuedResponse = false;
      this.requestResponse(connection);
    }
  }

  /**
   * Ejecuta una herramienta y devuelve su salida al modelo.
   *
   * Los errores se serializan como resultado en lugar de propagarse, para que la
   * conversación pueda continuar y el modelo explique el fallo al usuario.
   */
  private async executeFunctionCall(
    callId: string,
    connection: SidebandConnection,
    functionCall: RealtimeFunctionCallItem,
  ): Promise<void> {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(functionCall.arguments) as Record<string, unknown>;
    } catch {
      args = {};
    }

    let output: unknown;
    try {
      output = await this.skillsRegistry.execute(functionCall.name, args, {
        channel: 'web',
        sessionKey: callId,
        mode: connection.options.mode,
        consultId: connection.options.consultId,
      });
    } catch (error) {
      output = {
        error:
          error instanceof Error ? error.message : 'Tool execution failed',
      };
    }

    this.send(connection.ws, {
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: functionCall.call_id,
        output: JSON.stringify(output),
      },
    });
  }

  /**
   * Envía un evento por el canal lateral si el socket sigue abierto.
   *
   * @param ws Socket del canal lateral.
   * @param payload Evento a serializar como JSON.
   */
  private send(ws: WebSocket, payload: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }
}
