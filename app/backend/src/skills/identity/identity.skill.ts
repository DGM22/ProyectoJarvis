import { BadRequestException, Injectable } from '@nestjs/common';
import {
  FaceVerificationService,
  type OwnerVerificationResult,
} from '../../face-verification/face-verification.service';
import type {
  RealtimeFunctionTool,
  Skill,
  ToolExecutionContext,
} from '../skill.interface';

/** Qué debe hacer el agente del timbre con cada resultado. */
const GUIDANCE: Record<OwnerVerificationResult['status'], string> = {
  match:
    'La cara coincide con la foto del dueño. Salúdalo por su nombre y atiéndelo como el dueño (puedes tomar sus recados o instrucciones). La verificación facial no es prueba absoluta: no abras la puerta ni digas si hay alguien en casa.',
  no_match:
    'La cara NO coincide con la foto del dueño. No lo trates como el dueño ni le des información de la casa. Dile con amabilidad que no pudiste confirmar su identidad y llama call_owner explicando que alguien dice ser el dueño y la verificación facial no coincidió.',
  no_face:
    'No se vio una cara clara en la cámara. Pide al visitante que se acerque y mire de frente a la cámara, y vuelve a llamar verify_owner_face una vez más.',
  no_camera:
    'La cámara de la puerta no está disponible. No puedes confirmar su identidad: trátalo como visitante y llama call_owner explicando que dice ser el dueño.',
  no_reference:
    'No hay foto de referencia del dueño. No puedes confirmar su identidad: trátalo como visitante y llama call_owner explicando que dice ser el dueño.',
  too_many_attempts:
    'Ya se agotaron los intentos de verificación. No lo trates como el dueño: llama call_owner explicando que alguien dice ser el dueño y no se pudo verificar.',
  unavailable:
    'La verificación facial no está disponible ahora. Trátalo como visitante y llama call_owner explicando que dice ser el dueño.',
};

/**
 * Identidad en la puerta: cuando alguien dice ser el dueño, se toma una foto
 * con la cámara y se compara con la foto de referencia (AWS Rekognition).
 */
@Injectable()
export class IdentitySkill implements Skill {
  readonly name = 'identity';

  constructor(private readonly faceVerification: FaceVerificationService) {}

  getTools(): RealtimeFunctionTool[] {
    return [
      {
        type: 'function',
        name: 'verify_owner_face',
        description:
          'Doorbell only. Use when the visitor says they are the owner of the house. Takes a photo with the door camera and compares it with the owner\'s reference photo. Before calling, ask the visitor to look at the camera. Follow the "guidance" field of the result.',
        parameters: {
          type: 'object',
          properties: {
            claimed_name: {
              type: 'string',
              description: 'Name the visitor gave, if any',
            },
          },
        },
      },
    ];
  }

  supports(toolName: string): boolean {
    return toolName === 'verify_owner_face';
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    if (toolName !== 'verify_owner_face') {
      throw new Error(`Unsupported identity tool: ${toolName}`);
    }
    if (context?.channel !== 'device' || context.mode !== 'doorbell') {
      throw new BadRequestException(
        'verify_owner_face is only available from the doorbell',
      );
    }

    const result = await this.faceVerification.verifyOwner(context.sessionKey);
    return {
      ...result,
      claimedName:
        typeof args.claimed_name === 'string' && args.claimed_name.trim()
          ? args.claimed_name.trim()
          : null,
      guidance: GUIDANCE[result.status],
    };
  }
}
