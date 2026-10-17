import type { ConfigService } from '@nestjs/config';
import type {
  CameraHubService,
  CapturedFrame,
} from '../devices/camera-hub.service';
import type {
  HouseholdService,
  MemberFacePhoto,
} from '../household/household.service';
import type { FaceComparer, FaceComparison } from './face-comparer';
import {
  FaceVerificationService,
  MAX_ATTEMPTS_PER_SESSION,
} from './face-verification.service';

const FRAME: CapturedFrame = {
  deviceId: 7,
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
  at: Date.parse('2026-10-14T18:00:00Z'),
};

function owner(memberId: number, name: string): MemberFacePhoto {
  return { memberId, name, photo: Buffer.from(`ref-${memberId}`) };
}

function setup(options: {
  configured?: boolean;
  owners?: MemberFacePhoto[];
  frame?: CapturedFrame | null;
  comparisons?: Array<FaceComparison | Error>;
  threshold?: number;
}) {
  const comparisons = [...(options.comparisons ?? [])];
  const compare = jest.fn((): Promise<FaceComparison> => {
    const next = comparisons.shift() ?? { faceFound: false, similarity: null };
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  const comparer: FaceComparer = {
    configured: options.configured ?? true,
    compare,
  };
  const captureFrame = jest.fn(() =>
    Promise.resolve(options.frame === undefined ? FRAME : options.frame),
  );
  const listOwnerFacePhotos = jest.fn(() =>
    Promise.resolve(options.owners ?? [owner(1, 'Daniel')]),
  );
  const service = new FaceVerificationService(
    comparer,
    { captureFrame, turnOnLed: jest.fn() } as unknown as CameraHubService,
    { listOwnerFacePhotos } as unknown as HouseholdService,
    { get: () => options.threshold ?? 90 } as unknown as ConfigService,
  );
  return { service, compare, captureFrame };
}

describe('FaceVerificationService', () => {
  it('is unavailable when Rekognition is not configured', async () => {
    const { service, captureFrame } = setup({ configured: false });
    await expect(service.verifyOwner('s1')).resolves.toMatchObject({
      status: 'unavailable',
    });
    expect(captureFrame).not.toHaveBeenCalled();
  });

  it('needs an owner reference photo', async () => {
    const { service, captureFrame } = setup({ owners: [] });
    await expect(service.verifyOwner('s1')).resolves.toMatchObject({
      status: 'no_reference',
    });
    expect(captureFrame).not.toHaveBeenCalled();
  });

  it('reports no_camera when no frame can be captured', async () => {
    const { service, compare } = setup({ frame: null });
    await expect(service.verifyOwner('s1')).resolves.toMatchObject({
      status: 'no_camera',
    });
    expect(compare).not.toHaveBeenCalled();
  });

  it('matches the owner whose photo is most similar above the threshold', async () => {
    const { service, compare } = setup({
      owners: [owner(1, 'Daniel'), owner(2, 'Ana')],
      comparisons: [
        { faceFound: true, similarity: 40.12 },
        { faceFound: true, similarity: 98.765 },
      ],
    });

    const result = await service.verifyOwner('s1');

    expect(result).toMatchObject({
      status: 'match',
      ownerName: 'Ana',
      similarity: 98.8,
      threshold: 90,
      cameraDeviceId: 7,
      capturedAt: '2026-10-14T18:00:00.000Z',
    });
    expect(compare).toHaveBeenCalledWith(Buffer.from('ref-2'), FRAME.jpeg);
  });

  it('rejects a face below the threshold without naming the owner', async () => {
    const { service } = setup({
      comparisons: [{ faceFound: true, similarity: 89.9 }],
    });
    const result = await service.verifyOwner('s1');
    expect(result).toMatchObject({ status: 'no_match', similarity: 89.9 });
    expect(result.ownerName).toBeUndefined();
  });

  it('reports no_face when Rekognition finds no usable face', async () => {
    const { service } = setup({
      comparisons: [{ faceFound: false, similarity: null }],
    });
    await expect(service.verifyOwner('s1')).resolves.toMatchObject({
      status: 'no_face',
    });
  });

  it('is unavailable when the AWS call fails', async () => {
    const { service } = setup({ comparisons: [new Error('AccessDenied')] });
    await expect(service.verifyOwner('s1')).resolves.toMatchObject({
      status: 'unavailable',
    });
  });

  it('limits attempts per doorbell session', async () => {
    const { service } = setup({});
    for (let i = 0; i < MAX_ATTEMPTS_PER_SESSION; i += 1) {
      await expect(service.verifyOwner('s1')).resolves.toMatchObject({
        status: 'no_face',
      });
    }
    await expect(service.verifyOwner('s1')).resolves.toMatchObject({
      status: 'too_many_attempts',
    });
    // Otra sesión del timbre tiene sus propios intentos.
    await expect(service.verifyOwner('s2')).resolves.toMatchObject({
      status: 'no_face',
    });
  });
});
