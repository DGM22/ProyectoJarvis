import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SequelizeModule } from '@nestjs/sequelize';
import { HouseholdMember } from '../household/models/household-member.model';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { User } from './models/user.model';

/**
 * Login por usuario y contraseña. Global: los gateways WebSocket del navegador
 * usan `AuthService.userFromRequest` para validar la cookie de sesión.
 */
@Global()
@Module({
  imports: [SequelizeModule.forFeature([User, HouseholdMember])],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
