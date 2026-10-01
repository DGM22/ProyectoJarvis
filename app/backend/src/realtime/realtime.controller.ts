import {
  BadRequestException,
  Controller,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { RealtimeService } from './realtime.service';

/**
 * Endpoints HTTP del handshake de voz con OpenAI Realtime.
 *
 * El cuerpo de la petición es SDP en texto plano, por lo que `main.ts` registra
 * un parser específico para esta ruta.
 */
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtimeService: RealtimeService) {}

  /**
   * Intercambia la oferta SDP del navegador por la respuesta de OpenAI.
   *
   * @param req Petición cuyo cuerpo es la oferta SDP.
   * @param res Respuesta donde se escribe el SDP de vuelta.
   * @param voice Voz opcional a usar en la sesión.
   * @throws {BadRequestException} Si el `Content-Type` no es SDP ni texto plano.
   */
  @Post('calls')
  async createCall(
    @Req() req: Request,
    @Res() res: Response,
    @Query('voice') voice?: string,
    @Query('mode') mode?: string,
    @Query('consultId') consultId?: string,
  ): Promise<void> {
    if (mode !== undefined && mode !== 'assistant' && mode !== 'security') {
      throw new BadRequestException('mode must be assistant or security');
    }

    const contentType = req.headers['content-type'] ?? '';
    if (
      !contentType.includes('application/sdp') &&
      !contentType.includes('text/plain')
    ) {
      throw new BadRequestException(
        'Content-Type must be application/sdp or text/plain',
      );
    }

    const offerSdp =
      typeof req.body === 'string'
        ? req.body
        : Buffer.isBuffer(req.body)
          ? req.body.toString('utf8')
          : '';

    const answerSdp = await this.realtimeService.createCall(offerSdp, {
      voice,
      mode,
      consultId: consultId?.trim() || undefined,
    });

    res.setHeader('Content-Type', 'application/sdp');
    res.send(answerSdp);
  }
}
