import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsultService } from '../consult/consult.service';
import { RealtimeSessionConfigService } from './realtime-session-config.service';
import { RealtimeSidebandService } from './sideband/realtime-sideband.service';

/** Personas que el navegador puede abrir; `doorbell` es exclusivo del ESP32. */
export type WebCallMode = 'assistant' | 'security';

export interface CreateCallOptions {
  voice?: string;
  mode?: WebCallMode;
  consultId?: string;
}

/**
 * Crea sesiones de voz contra la API Realtime de OpenAI.
 *
 * Actúa como proxy del handshake SDP: recibe la oferta del navegador, adjunta
 * la configuración de sesión (instrucciones, herramientas y voz) y devuelve la
 * respuesta SDP para que el audio viaje directo por WebRTC.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly sessionConfigService: RealtimeSessionConfigService,
    private readonly sidebandService: RealtimeSidebandService,
    private readonly consultService: ConsultService,
  ) {}

  /**
   * Negocia una llamada Realtime y engancha el canal lateral de herramientas.
   *
   * @param offerSdp Oferta SDP generada por el navegador.
   * @param options Voz y persona; `security` exige una consulta del timbre activa.
   * @returns La respuesta SDP que el navegador debe aplicar como descripción remota.
   */
  async createCall(
    offerSdp: string,
    options: CreateCallOptions = {},
  ): Promise<string> {
    const apiKey = this.configService.get<string>('openai.apiKey');
    const model = this.configService.get<string>('openai.realtimeModel');

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured on the server',
      );
    }

    if (!model) {
      throw new InternalServerErrorException(
        'Realtime model is not configured',
      );
    }

    if (!offerSdp?.trim()) {
      throw new BadRequestException('SDP offer body is required');
    }

    const mode = options.mode ?? 'assistant';
    if (mode === 'security') {
      if (!options.consultId) {
        throw new BadRequestException('consultId is required for security calls');
      }
      // Contestar desde otra pestaña o directo por HTTP también detiene el anillo.
      this.consultService.accept(options.consultId);
    }

    const voice = this.sessionConfigService.resolveVoice(options.voice);
    const sessionConfig = await this.sessionConfigService.buildSessionConfig(
      model,
      voice,
      { mode, consultId: options.consultId },
    );
    const form = new FormData();
    form.set('sdp', offerSdp);
    form.set('session', JSON.stringify(sessionConfig));

    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
      });
    } catch (error) {
      this.logger.error(
        'Failed to reach OpenAI realtime/calls endpoint',
        error,
      );
      throw new ServiceUnavailableException(
        'Unable to reach OpenAI Realtime API',
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(
        `OpenAI realtime/calls failed (${response.status}): ${errorBody}`,
      );
      throw new ServiceUnavailableException(
        'OpenAI rejected the realtime call request',
      );
    }

    const answerSdp = await response.text();
    const callId = this.extractCallId(response.headers.get('location'));

    if (callId) {
      this.sidebandService.attach(callId, {
        mode,
        consultId: options.consultId,
      });
    } else {
      this.logger.warn(
        'OpenAI did not return a Location header; sideband tools will not attach',
      );
    }

    return answerSdp;
  }

  /**
   * Obtiene el identificador de llamada del header `Location` de OpenAI.
   *
   * @param locationHeader Valor del header, o `null` si no vino en la respuesta.
   */
  private extractCallId(locationHeader: string | null): string | null {
    if (!locationHeader) {
      return null;
    }

    const parts = locationHeader.split('/').filter(Boolean);
    return parts.at(-1) ?? null;
  }
}
