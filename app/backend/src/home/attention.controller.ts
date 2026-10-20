import { Body, Controller, Get, Put } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service';
import { CurrentUser, OwnerOnly } from '../auth/auth.decorators';
import { AttentionService, type AttentionSettings } from './attention.service';

/** Modo de atención de la puerta: lo ve cualquiera con sesión, lo cambia el dueño. */
@Controller('settings/attention')
export class AttentionController {
  constructor(private readonly attention: AttentionService) {}

  @Get()
  get(): Promise<AttentionSettings> {
    return this.attention.get();
  }

  @OwnerOnly()
  @Put()
  update(@Body() body: unknown, @CurrentUser() user: AuthUser): Promise<AttentionSettings> {
    return this.attention.update(body, user.personId);
  }
}
