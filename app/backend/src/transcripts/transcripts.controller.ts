import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { TranscriptsService } from './transcripts.service';

/** CRUD HTTP de transcripciones guardadas. */
@Controller('transcripts')
export class TranscriptsController {
  constructor(private readonly transcriptsService: TranscriptsService) {}

  @Get()
  list() {
    return this.transcriptsService.list();
  }

  @Get(':id/download')
  async download(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const { stream, filename } =
      await this.transcriptsService.openDownloadStream(id);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    stream.pipe(res);
  }

  @Get(':id/segments')
  getSegments(
    @Param('id', ParseIntPipe) id: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.transcriptsService.getSegments(id, offset, limit);
  }

  @Get(':id')
  getById(@Param('id', ParseIntPipe) id: number) {
    return this.transcriptsService.getById(id);
  }

  @Patch(':id')
  rename(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { title?: string },
  ) {
    return this.transcriptsService.rename(id, body.title ?? '');
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.transcriptsService.remove(id);
    return { ok: true };
  }
}
