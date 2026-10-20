import { BadRequestException } from '@nestjs/common';
import { AttentionService, DEFAULT_ATTENTION } from './attention.service';

function setup(stored?: unknown) {
  const model = {
    findByPk: jest
      .fn()
      .mockResolvedValue(stored === undefined ? null : { value: stored }),
    upsert: jest.fn().mockResolvedValue(undefined),
  };
  return { service: new AttentionService(model as never), model };
}

describe('AttentionService', () => {
  it('defaults to Jarvis first when nothing is saved', async () => {
    expect(await setup().service.get()).toEqual(DEFAULT_ATTENTION);
  });

  it('falls back to the default when the stored value is corrupt', async () => {
    expect(
      await setup({ mode: 'sin-sentido', ringSeconds: 'x' }).service.get(),
    ).toEqual(DEFAULT_ATTENTION);
  });

  it('saves a valid change and keeps what was not sent', async () => {
    const { service, model } = setup({ mode: 'ring_first', ringSeconds: 30 });

    const next = await service.update({ mode: 'ai_only' }, 2);

    expect(next).toEqual({ mode: 'ai_only', ringSeconds: 30 });
    expect(model.upsert).toHaveBeenCalledWith({
      key: 'attention',
      value: next,
      updatedByPersonId: 2,
    });
    expect(await service.get()).toEqual(next); // sin volver a la BD
    expect(model.findByPk).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ mode: 'abrir_la_puerta' }],
    [{ ringSeconds: 3 }],
    [{ ringSeconds: 600 }],
    [{ ringSeconds: 20.5 }],
    [{ ringSeconds: '20' }],
    ['ring_first'],
    [null],
  ])('rejects invalid input %p', async (input) => {
    await expect(setup().service.update(input, 1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
