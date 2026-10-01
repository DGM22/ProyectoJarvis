import { createReadStream, existsSync } from 'fs';
import { unlink } from 'fs/promises';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transcript } from './models/transcript.model';
import { TranscriptSegment } from './models/transcript-segment.model';

@Injectable()
export class TranscriptsService {
  constructor(
    @InjectModel(Transcript)
    private readonly transcriptModel: typeof Transcript,
    @InjectModel(TranscriptSegment)
    private readonly segmentModel: typeof TranscriptSegment,
  ) {}

  async list() {
    const rows = await this.transcriptModel.findAll({
      order: [['startedAt', 'DESC']],
    });

    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      durationSeconds: t.durationSeconds,
      startedAt: t.startedAt,
      endedAt: t.endedAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  }

  async getById(id: number) {
    const transcript = await this.transcriptModel.findByPk(id);
    if (!transcript) {
      throw new NotFoundException(`Transcript ${id} not found`);
    }

    const segmentCount = await this.segmentModel.count({
      where: { transcriptId: id },
    });

    return {
      id: transcript.id,
      title: transcript.title,
      status: transcript.status,
      durationSeconds: transcript.durationSeconds,
      startedAt: transcript.startedAt,
      endedAt: transcript.endedAt,
      createdAt: transcript.createdAt,
      updatedAt: transcript.updatedAt,
      segmentCount,
    };
  }

  /**
   * Página de segmentos para el visor incremental del frontend.
   *
   * Una junta de 10h con chunks de 60s son ~600 filas; el cliente las pide
   * de a `limit` para no montar todo el texto de golpe.
   */
  async getSegments(
    id: number,
    offset = 0,
    limit = 20,
  ): Promise<{
    segments: Array<{
      id: number;
      sequenceNumber: number;
      text: string;
      language: string | null;
      status: string;
      createdAt: Date;
    }>;
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
  }> {
    const transcript = await this.transcriptModel.findByPk(id);
    if (!transcript) {
      throw new NotFoundException(`Transcript ${id} not found`);
    }

    const safeOffset = Math.max(0, offset);
    const safeLimit = Math.min(100, Math.max(1, limit));

    const { rows, count } = await this.segmentModel.findAndCountAll({
      where: { transcriptId: id },
      order: [['sequenceNumber', 'ASC']],
      offset: safeOffset,
      limit: safeLimit,
    });

    return {
      segments: rows.map((s) => ({
        id: s.id,
        sequenceNumber: s.sequenceNumber,
        text: s.text,
        language: s.language,
        status: s.status,
        createdAt: s.createdAt,
      })),
      total: count,
      offset: safeOffset,
      limit: safeLimit,
      hasMore: safeOffset + rows.length < count,
    };
  }

  async rename(id: number, title: string) {
    const transcript = await this.transcriptModel.findByPk(id);
    if (!transcript) {
      throw new NotFoundException(`Transcript ${id} not found`);
    }

    const trimmed = title.trim();
    if (!trimmed) {
      throw new BadRequestException('Title cannot be empty');
    }

    await transcript.update({ title: trimmed });
    return {
      id: transcript.id,
      title: transcript.title,
    };
  }

  async remove(id: number): Promise<void> {
    const transcript = await this.transcriptModel.findByPk(id);
    if (!transcript) {
      throw new NotFoundException(`Transcript ${id} not found`);
    }

    if (transcript.filePath && existsSync(transcript.filePath)) {
      try {
        await unlink(transcript.filePath);
      } catch {
        // ignore missing file
      }
    }

    await transcript.destroy();
  }

  async openDownloadStream(id: number): Promise<{
    stream: ReturnType<typeof createReadStream>;
    filename: string;
  }> {
    const transcript = await this.transcriptModel.findByPk(id);
    if (!transcript) {
      throw new NotFoundException(`Transcript ${id} not found`);
    }

    if (!transcript.filePath || !existsSync(transcript.filePath)) {
      throw new NotFoundException(`Transcript file for ${id} not found`);
    }

    const safeTitle = transcript.title
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 80);

    return {
      stream: createReadStream(transcript.filePath),
      filename: `${safeTitle || `transcript-${id}`}.txt`,
    };
  }
}
