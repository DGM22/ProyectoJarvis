import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { AppSetting } from './models/app-setting.model';

/**
 * Cómo atiende la puerta cuando alguien toca el timbre:
 * - `ai_first`: Jarvis contesta y te llama solo si hace falta (como siempre).
 * - `ring_first`: primero suena en tu app (tipo Ring); si nadie contesta en
 *   `ringSeconds`, atiende Jarvis.
 * - `ai_only`: no molestar. Jarvis atiende y toma recado sin llamarte.
 */
export const ATTENTION_MODES = ['ai_first', 'ring_first', 'ai_only'] as const;
export type AttentionMode = (typeof ATTENTION_MODES)[number];

export interface AttentionSettings {
  mode: AttentionMode;
  /** Cuánto suena antes de que atienda Jarvis (solo `ring_first`). */
  ringSeconds: number;
}

export const DEFAULT_ATTENTION: AttentionSettings = { mode: 'ai_first', ringSeconds: 20 };
export const MIN_RING_SECONDS = 8;
export const MAX_RING_SECONDS = 60;

const KEY = 'attention';

/** Lee y guarda el modo de atención (con caché: se consulta en cada timbrazo). */
@Injectable()
export class AttentionService {
  private cache: AttentionSettings | null = null;

  constructor(@InjectModel(AppSetting) private readonly settingModel: typeof AppSetting) {}

  async get(): Promise<AttentionSettings> {
    if (this.cache) {
      return this.cache;
    }
    const row = await this.settingModel.findByPk(KEY);
    this.cache = this.normalize(row?.value);
    return this.cache;
  }

  async update(input: unknown, personId: number | null): Promise<AttentionSettings> {
    const current = await this.get();
    const next = this.validate(input, current);
    await this.settingModel.upsert({ key: KEY, value: next, updatedByPersonId: personId });
    this.cache = next;
    return next;
  }

  /** Valida lo que manda la web; lo que falta se queda como estaba. */
  validate(input: unknown, current: AttentionSettings): AttentionSettings {
    if (typeof input !== 'object' || input === null) {
      throw new BadRequestException('Se esperaba un objeto con mode y/o ringSeconds');
    }
    const { mode, ringSeconds } = input as Record<string, unknown>;
    if (mode !== undefined && !ATTENTION_MODES.includes(mode as AttentionMode)) {
      throw new BadRequestException(`mode debe ser uno de: ${ATTENTION_MODES.join(', ')}`);
    }
    if (
      ringSeconds !== undefined &&
      (typeof ringSeconds !== 'number' ||
        !Number.isInteger(ringSeconds) ||
        ringSeconds < MIN_RING_SECONDS ||
        ringSeconds > MAX_RING_SECONDS)
    ) {
      throw new BadRequestException(
        `ringSeconds debe ser un entero entre ${MIN_RING_SECONDS} y ${MAX_RING_SECONDS}`,
      );
    }
    return {
      mode: (mode as AttentionMode | undefined) ?? current.mode,
      ringSeconds: (ringSeconds as number | undefined) ?? current.ringSeconds,
    };
  }

  private normalize(value: unknown): AttentionSettings {
    try {
      return this.validate(value ?? {}, DEFAULT_ATTENTION);
    } catch {
      // Un valor corrupto en la BD no debe dejar la puerta sin atender.
      return DEFAULT_ATTENTION;
    }
  }
}
