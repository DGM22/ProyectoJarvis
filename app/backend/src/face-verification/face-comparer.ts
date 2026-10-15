import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CompareFacesCommand,
  InvalidParameterException,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';

/** Resultado de comparar una foto de referencia contra una foto de la puerta. */
export interface FaceComparison {
  /** `false` si Rekognition no encontró una cara utilizable. */
  faceFound: boolean;
  /** Similitud (0–100) de la cara más parecida de la foto de la puerta. */
  similarity: number | null;
}

/** Abstracción del proveedor para poder probar la verificación sin AWS. */
export interface FaceComparer {
  readonly configured: boolean;
  compare(reference: Buffer, candidate: Buffer): Promise<FaceComparison>;
}

export const FACE_COMPARER = Symbol('FACE_COMPARER');

/**
 * AWS Rekognition `CompareFaces`. Las credenciales salen de la cadena estándar
 * del SDK (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, perfil o rol de IAM);
 * aquí solo se exige la región.
 */
@Injectable()
export class RekognitionFaceComparer implements FaceComparer {
  private readonly logger = new Logger(RekognitionFaceComparer.name);
  private readonly client: RekognitionClient | null;

  constructor(configService: ConfigService) {
    const region = configService.get<string>('aws.region');
    this.client = region ? new RekognitionClient({ region }) : null;
    if (!this.client) {
      this.logger.warn('AWS_REGION is not set: face verification is disabled');
    }
  }

  get configured(): boolean {
    return this.client !== null;
  }

  async compare(reference: Buffer, candidate: Buffer): Promise<FaceComparison> {
    if (!this.client) {
      throw new Error('Rekognition is not configured');
    }
    try {
      const output = await this.client.send(
        new CompareFacesCommand({
          SourceImage: { Bytes: reference },
          TargetImage: { Bytes: candidate },
          // Umbral 0 para conocer la similitud aunque no llegue al mínimo;
          // la decisión de coincidencia la toma FaceVerificationService.
          SimilarityThreshold: 0,
          QualityFilter: 'AUTO',
        }),
      );
      const similarities = (output.FaceMatches ?? [])
        .map((match) => match.Similarity)
        .filter((value): value is number => typeof value === 'number');
      const unmatched = output.UnmatchedFaces?.length ?? 0;
      if (similarities.length === 0 && unmatched === 0) {
        return { faceFound: false, similarity: null };
      }
      return {
        faceFound: true,
        similarity: similarities.length > 0 ? Math.max(...similarities) : 0,
      };
    } catch (error) {
      // Rekognition responde InvalidParameter cuando alguna imagen no tiene cara.
      if (error instanceof InvalidParameterException) {
        this.logger.warn(`CompareFaces without usable face: ${error.message}`);
        return { faceFound: false, similarity: null };
      }
      throw error;
    }
  }
}
