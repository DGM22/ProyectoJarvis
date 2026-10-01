import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { HouseholdService } from './household.service';
import type { HouseholdRole } from './models/household-member.model';

type HouseholdMemberBody = {
  name?: string;
  role?: HouseholdRole;
  notes?: string | null;
};

/** CRUD del roster de la casa para la pantalla de Configuración. */
@Controller('household')
export class HouseholdController {
  constructor(private readonly householdService: HouseholdService) {}

  @Get()
  list() {
    return this.householdService.list();
  }

  @Post()
  create(@Body() body: HouseholdMemberBody) {
    return this.householdService.create({
      name: body.name ?? '',
      role: body.role,
      notes: body.notes,
    });
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: HouseholdMemberBody,
  ) {
    return this.householdService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.householdService.remove(id);
  }
}
