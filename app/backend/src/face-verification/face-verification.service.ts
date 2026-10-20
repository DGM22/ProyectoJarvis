import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CameraHubService } from '../devices/camera-hub.service';
import { HouseholdService } from '../household/household.service';
import { FACE_COMPARER, type FaceComparer } from './face-comparer';

export type OwnerVerificationStatus =
  | 'match'
  | 'no_match'
  | 'no_face'
  | 'no_camera'
  | 'no_reference'
  | 'too_many_attempts'
  | 'unavailable';

export interface OwnerVerificationResult {
  status: OwnerVerificationStatus;
  /** Dueño con el que coincidió (solo en `match`). */
  ownerName?: string;
  /** Persona (`people.id`) con la que coincidió (solo en `match`). */
  ownerPersonId?: number;
  /** Mejor similitud obtenida, redondeada a un decimal. */
  similarity?: number;
  threshold: number;
  cameraDeviceId?: number;
  capturedAt?: string;
}

/** Intentos por sesión del timbre: evita probar fotos una tras otra. */
export const MAX_ATTEMPTS_PER_SESSION = 3;
const ATTEMPT_WINDOW_MS = 15 * 60_000;

/**
 * Verifica si quien está en la puerta es el dueño: toma una foto con la
 * cámara y la compara contra las fotos de referencia de los dueños.
 *
 * No hay prueba de vida: una foto impresa podría pasar. El resultado sirve
 * para ajustar la conversación, no para abrir la puerta.
 */
@Injectable()
export class FaceVerificationService {
  private readonly logger = new Logger(FaceVerificationService.name);
  private readonly attempts = new Map<
    string,
    { count: number; since: number }
  >();

  constructor(
    @Inject(FACE_COMPARER) private readonly comparer: FaceComparer,
    private readonly cameraHub: CameraHubService,
    private readonly householdService: HouseholdService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * @param sessionKey Sesión del timbre que pide la verificación (límite de intentos).
   */
  async verifyOwner(sessionKey: string): Promise<OwnerVerificationResult> {
    const threshold = this.threshold();
    if (!this.comparer.configured) {
      return { status: 'unavailable', threshold };
    }
    if (!this.registerAttempt(sessionKey)) {
      return { status: 'too_many_attempts', threshold };
    }

    const references = await this.householdService.listOwnerFacePhotos();
    if (references.length === 0) {
      return { status: 'no_reference', threshold };
    }

    const frame = await this.cameraHub.captureFrame();
    if (!frame) {
      return { status: 'no_camera', threshold };
    }
    const captured = {
      cameraDeviceId: frame.deviceId,
      capturedAt: new Date(frame.at).toISOString(),
    };

    let best: { name: string; personId: number; similarity: number } | null = null;
    try {
      for (const reference of references) {
        const comparison = await this.comparer.compare(
          reference.photo,
          frame.jpeg,
        );
        if (
          comparison.faceFound &&
          comparison.similarity !== null &&
          (!best || comparison.similarity > best.similarity)
        ) {
          best = {
            name: reference.name,
            personId: reference.memberId,
            similarity: comparison.similarity,
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Face comparison failed: ${message}`);
      return { status: 'unavailable', threshold, ...captured };
    }

    if (!best) {
      return { status: 'no_face', threshold, ...captured };
    }
    const similarity = Math.round(best.similarity * 10) / 10;
    if (best.similarity >= threshold) {
      this.logger.log(
        `Owner verified at the door: ${best.name} (${similarity}%)`,
      );
      return {
        status: 'match',
        ownerName: best.name,
        ownerPersonId: best.personId,
        similarity,
        threshold,
        ...captured,
      };
    }
    this.logger.warn(`Owner claim rejected at the door (best ${similarity}%)`);
    return { status: 'no_match', similarity, threshold, ...captured };
  }

  private threshold(): number {
    const value = this.configService.get<number>('aws.faceMatchThreshold');
    return typeof value === 'number' && Number.isFinite(value) ? value : 90;
  }

  /** Cuenta el intento; `false` si la sesión ya agotó los suyos. */
  private registerAttempt(sessionKey: string): boolean {
    const now = Date.now();
    for (const [key, entry] of this.attempts) {
      if (now - entry.since > ATTEMPT_WINDOW_MS) {
        this.attempts.delete(key);
      }
    }
    const entry = this.attempts.get(sessionKey) ?? { count: 0, since: now };
    if (entry.count >= MAX_ATTEMPTS_PER_SESSION) {
      return false;
    }
    entry.count += 1;
    this.attempts.set(sessionKey, entry);
    return true;
  }
}
