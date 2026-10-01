import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EmbeddingResult {
  vector: number[];
  model: string;
}

/**
 * Cliente mínimo de embeddings vía fetch a OpenAI.
 *
 * No usa el SDK oficial a propósito: el resto del backend ya habla con
 * OpenAI con `fetch` directo.
 */
@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Genera el embedding de un texto con el modelo configurado.
   *
   * @param text Texto canónico a embeber.
   */
  async embed(text: string): Promise<EmbeddingResult> {
    const apiKey = this.configService.get<string>('openai.apiKey');
    if (!apiKey) {
      throw new ServiceUnavailableException('OPENAI_API_KEY is not configured');
    }

    const model =
      this.configService.get<string>('openai.embeddingModel') ??
      'text-embedding-3-small';

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: text,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Embeddings API failed (${response.status}): ${body}`);
      throw new ServiceUnavailableException(
        `OpenAI embeddings failed (${response.status})`,
      );
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
      model?: string;
    };

    const vector = payload.data?.[0]?.embedding;
    if (!vector || !Array.isArray(vector) || vector.length === 0) {
      throw new ServiceUnavailableException(
        'OpenAI embeddings returned an empty vector',
      );
    }

    return {
      vector,
      model: payload.model ?? model,
    };
  }
}
