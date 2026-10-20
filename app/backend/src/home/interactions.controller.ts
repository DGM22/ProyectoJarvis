import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InteractionsService,
  type HistoryFilter,
  type VisitHistoryItem,
  type VisitSummary,
} from './interactions.service';

const FILTERS: readonly HistoryFilter[] = ['all', 'ai', 'owner', 'recognized', 'missed'];

/** Historial de visitas a la puerta (requiere sesión, como todo). */
@Controller('interactions')
export class InteractionsController {
  constructor(
    private readonly interactions: InteractionsService,
    private readonly configService: ConfigService,
  ) {}

  /** Contadores de hoy (zona horaria de la casa). */
  @Get('summary')
  summary(): Promise<VisitSummary> {
    return this.interactions.summary(
      this.configService.get<string>('app.timezone') ?? 'America/Mexico_City',
    );
  }

  @Get()
  history(
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('filter') filter?: string,
  ): Promise<VisitHistoryItem[]> {
    const parsedFilter = (filter ?? 'all') as HistoryFilter;
    if (!FILTERS.includes(parsedFilter)) {
      throw new BadRequestException(`filter must be one of ${FILTERS.join(', ')}`);
    }
    const parsedBefore = before ? Number(before) : undefined;
    if (parsedBefore !== undefined && !Number.isInteger(parsedBefore)) {
      throw new BadRequestException('before must be an interaction id');
    }
    return this.interactions.history({
      limit: Math.min(Math.max(Number(limit) || 20, 1), 100),
      before: parsedBefore,
      filter: parsedFilter,
    });
  }
}
