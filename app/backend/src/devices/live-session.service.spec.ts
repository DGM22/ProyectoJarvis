import type { OwnerIntercomLink } from '../consult/consult.types';
import { LiveSessionService } from './live-session.service';

function makeLink(): jest.Mocked<OwnerIntercomLink> {
  return { sendAudio: jest.fn(), sendState: jest.fn(), close: jest.fn() };
}

function setup(options: { online?: boolean; inCall?: boolean } = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const registry = {
    isOnline: jest.fn().mockReturnValue(options.online ?? true),
    getBridgeKey: jest.fn().mockReturnValue('dev-2-1'),
    send: jest.fn((_id: number, message: Record<string, unknown>) => {
      sent.push(message);
      return true;
    }),
    sendBinary: jest.fn().mockReturnValue(true),
  };
  const devicesService = { markStatus: jest.fn().mockResolvedValue(undefined) };
  const realtimeBridge = {
    isInCall: jest.fn().mockReturnValue(options.inCall ?? false),
  };
  const interactions = {
    recordLiveSession: jest.fn().mockResolvedValue(undefined),
  };
  const service = new LiveSessionService(
    registry as never,
    devicesService as never,
    realtimeBridge as never,
    interactions as never,
  );
  return { service, registry, devicesService, interactions, sent };
}

describe('LiveSessionService', () => {
  it('opens the door audio without ringing: intercom mode, then session ready', async () => {
    const t = setup();
    const link = makeLink();

    await expect(t.service.start(2, link, 'Daniel')).resolves.toEqual({
      ok: true,
    });

    expect(t.sent.map((m) => m.type)).toEqual([
      'intercom.start',
      'session.ready',
      'display.set',
    ]);
    expect(link.sendState).toHaveBeenCalledWith('on');
    expect(t.devicesService.markStatus).toHaveBeenCalledWith(2, 'in_call');
    expect(t.interactions.recordLiveSession).toHaveBeenCalledWith(2, 'Daniel');
    expect(t.service.isLive(2)).toBe(true);
  });

  it('refuses when the door is offline, busy with a visitor or already live', async () => {
    const offline = setup({ online: false });
    await expect(
      offline.service.start(2, makeLink(), 'Daniel'),
    ).resolves.toMatchObject({
      ok: false,
      code: 4404,
    });

    const visitor = setup({ inCall: true });
    await expect(
      visitor.service.start(2, makeLink(), 'Daniel'),
    ).resolves.toMatchObject({
      ok: false,
      code: 4409,
    });

    const twice = setup();
    await twice.service.start(2, makeLink(), 'Daniel');
    await expect(
      twice.service.start(2, makeLink(), 'Otra'),
    ).resolves.toMatchObject({
      ok: false,
      code: 4409,
    });
  });

  it('routes audio both ways and only for the owner of the session', async () => {
    const t = setup();
    const link = makeLink();
    await t.service.start(2, link, 'Daniel');

    const doorVoice = Buffer.alloc(640, 1);
    t.service.deviceAudio(2, doorVoice);
    expect(link.sendAudio).toHaveBeenCalledWith(doorVoice);

    const ownerVoice = Buffer.alloc(640, 2);
    t.service.ownerAudio(2, link, ownerVoice);
    expect(t.registry.sendBinary).toHaveBeenCalledWith(2, ownerVoice);

    t.service.ownerAudio(2, makeLink(), ownerVoice); // enlace ajeno
    expect(t.registry.sendBinary).toHaveBeenCalledTimes(1);

    t.service.ownerTalking(2, link, true);
    expect(t.sent.at(-1)).toEqual({ type: 'display.set', state: 'speaking' });
  });

  it('hang up returns the door to idle', async () => {
    const t = setup();
    const link = makeLink();
    await t.service.start(2, link, 'Daniel');
    t.sent.length = 0;

    t.service.stop(2, link);

    expect(t.sent.map((m) => m.type)).toEqual([
      'intercom.end',
      'session.end',
      'display.set',
    ]);
    expect(t.devicesService.markStatus).toHaveBeenLastCalledWith(2, 'idle');
    expect(t.service.isLive(2)).toBe(false);
  });

  it('a visitor pressing the bell ends the live session and tells the owner', async () => {
    const t = setup();
    const link = makeLink();
    await t.service.start(2, link, 'Daniel');

    t.service.endByDevice(2, 'Alguien tocó el timbre');

    expect(link.close).toHaveBeenCalledWith('Alguien tocó el timbre');
    expect(t.service.isLive(2)).toBe(false);
    // Una segunda llamada no hace nada (ya no hay sesión).
    t.service.endByDevice(2, 'otra vez');
    expect(link.close).toHaveBeenCalledTimes(1);
  });
});
