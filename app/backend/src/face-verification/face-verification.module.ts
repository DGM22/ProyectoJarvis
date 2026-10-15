import { Module } from '@nestjs/common';
import { CameraHubModule } from '../devices/camera-hub.module';
import { HouseholdModule } from '../household/household.module';
import { FACE_COMPARER, RekognitionFaceComparer } from './face-comparer';
import { FaceVerificationService } from './face-verification.service';

/** Verificación facial del dueño en el timbre (cámara + AWS Rekognition). */
@Module({
  imports: [CameraHubModule, HouseholdModule],
  providers: [
    { provide: FACE_COMPARER, useClass: RekognitionFaceComparer },
    FaceVerificationService,
  ],
  exports: [FaceVerificationService],
})
export class FaceVerificationModule {}
