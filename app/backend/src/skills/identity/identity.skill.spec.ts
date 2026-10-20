import type { ConfigService } from '@nestjs/config';
import type {
  FaceVerificationService,
  OwnerVerificationResult,
} from '../../face-verification/face-verification.service';
import type { InteractionsService } from '../../home/interactions.service';
import type { ToolExecutionContext } from '../skill.interface';
import { IdentitySkill } from './identity.skill';

function setup(result: OwnerVerificationResult) {
  const verifyOwner = jest.fn(() => Promise.resolve(result));
  const recordRecognition = jest.fn(() => Promise.resolve());
  const recordDoorOpened = jest.fn(() => Promise.resolve());
  const skill = new IdentitySkill(
    { verifyOwner } as unknown as FaceVerificationService,
    { recordRecognition, recordDoorOpened } as unknown as InteractionsService,
    { get: () => 4000 } as unknown as ConfigService,
  );
  return { skill, recordDoorOpened };
}

function doorbell(
  openDoor?: (holdMs: number) => boolean,
): ToolExecutionContext {
  return {
    channel: 'device',
    sessionKey: 'dev-1-1',
    mode: 'doorbell',
    openDoor,
  };
}

describe('IdentitySkill', () => {
  it('opens the door when the owner face matches', async () => {
    const { skill, recordDoorOpened } = setup({
      status: 'match',
      ownerName: 'Ana',
      ownerPersonId: 2,
      similarity: 97.5,
      threshold: 90,
    });
    const openDoor = jest.fn(() => true);

    const output = await skill.execute(
      'verify_owner_face',
      {},
      doorbell(openDoor),
    );

    expect(openDoor).toHaveBeenCalledWith(4000);
    expect(recordDoorOpened).toHaveBeenCalledWith('dev-1-1', 2, 4000);
    expect(output).toMatchObject({ status: 'match', doorOpened: true });
  });

  it('does not open the door without a match', async () => {
    const { skill, recordDoorOpened } = setup({
      status: 'no_match',
      similarity: 60,
      threshold: 90,
    });
    const openDoor = jest.fn(() => true);

    const output = await skill.execute(
      'verify_owner_face',
      {},
      doorbell(openDoor),
    );

    expect(openDoor).not.toHaveBeenCalled();
    expect(recordDoorOpened).not.toHaveBeenCalled();
    expect(output).toMatchObject({ status: 'no_match', doorOpened: false });
  });

  it('reports doorOpened false when the device is gone', async () => {
    const { skill, recordDoorOpened } = setup({
      status: 'match',
      ownerName: 'Ana',
      ownerPersonId: 2,
      similarity: 97.5,
      threshold: 90,
    });

    const output = await skill.execute(
      'verify_owner_face',
      {},
      doorbell(() => false),
    );

    expect(recordDoorOpened).not.toHaveBeenCalled();
    expect(output).toMatchObject({ status: 'match', doorOpened: false });
  });
});
