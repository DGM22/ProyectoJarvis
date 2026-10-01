import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { GoogleCredential } from './models/google-credential.model';
import { GoogleAuthService } from './google-auth.service';
import { GoogleAuthController } from './google-auth.controller';
import { TokenEncryptionService } from './crypto/token-encryption.service';

/** Autenticación con Google y cifrado de sus credenciales. */
@Module({
  imports: [SequelizeModule.forFeature([GoogleCredential])],
  controllers: [GoogleAuthController],
  providers: [GoogleAuthService, TokenEncryptionService],
  exports: [GoogleAuthService],
})
export class GoogleModule {}
