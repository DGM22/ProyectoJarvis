import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
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

  /**
   * Sube la foto de referencia para la verificación facial. El cuerpo es la
   * imagen cruda (`image/jpeg` o `image/png`); `main.ts` registra el parser.
   */
  @Put(':id/face-photo')
  setFacePhoto(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.householdService.setFacePhoto(id, req.body);
  }

  @Get(':id/face-photo')
  async getFacePhoto(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const { data, mime } = await this.householdService.getFacePhoto(id);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store');
    res.send(data);
  }

  @Delete(':id/face-photo')
  clearFacePhoto(@Param('id', ParseIntPipe) id: number) {
    return this.householdService.clearFacePhoto(id);
  }
}
