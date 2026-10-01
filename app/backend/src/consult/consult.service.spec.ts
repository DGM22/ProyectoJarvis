import type WebSocket from 'ws';
import { ConsultService } from './consult.service';
import type { ConsultServerMessage, DoorbellController } from './consult.types';

function makeDoorbell(): jest.Mocked<DoorbellController> {
  return { pause: jest.fn(), resume: jest.fn() };
}

function makeViewer(): { socket: WebSocket; messages: ConsultServerMessage[] } {
  const messages: ConsultServerMessage[] = [];
  const socket = {
    readyState: 1,
    send: (raw: string) => messages.push(JSON.parse(raw) as ConsultServerMessage),
  } as unknown as WebSocket;
  return { socket, messages };
}

describe('ConsultService', () => {
  let service: ConsultService;
  let doorbell: jest.Mocked<DoorbellController>;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new ConsultService();
    doorbell = makeDoorbell();
    service.registerDoorbell('dev-1', doorbell);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('rings the web and pauses the doorbell on call_owner', () => {
    const viewer = makeViewer();
    service.addViewer(viewer.socket);

    const result = service.callOwner('dev-1', 'Repartidor con paquete para Daniel');

    expect(result.status).toBe('ringing');
    expect(doorbell.pause).toHaveBeenCalledTimes(1);
    const last = viewer.messages.at(-1);
    expect(last?.type).toBe('consult.update');
    expect(last?.type === 'consult.update' && last.consult.status).toBe('ringing');
  });

  it('rejects call_owner from a session that is not a doorbell', () => {
    expect(() => service.callOwner('web-call', 'hola')).toThrow();
  });

  it('delivers the owner instruction and resumes the doorbell', () => {
    const { consultId } = service.callOwner('dev-1', 'Visita para Daniel');
    service.accept(consultId);

    const result = service.instruct(consultId, 'Dile que ya bajo');

    expect(result.delivered).toBe(true);
    expect(doorbell.resume).toHaveBeenCalledWith(expect.stringContaining('Dile que ya bajo'));
    expect(service.getSnapshot(consultId).awaitingOwner).toBe(false);
  });

  it('instruct without id targets the only active consult (wake word path)', () => {
    const { consultId } = service.callOwner('dev-1', 'Paquete');

    const result = service.instruct(undefined, 'Que lo deje en la puerta');

    expect(result).toEqual({ delivered: true, consultId });
    expect(service.getSnapshot(consultId).status).toBe('answered');
  });

  it('marks missed and lets the doorbell take a message after the ring timeout', () => {
    const { consultId } = service.callOwner('dev-1', 'Vendedor');

    jest.advanceTimersByTime(45_000);

    expect(service.getSnapshot(consultId).status).toBe('missed');
    expect(doorbell.resume).toHaveBeenCalledWith(expect.stringContaining('recado'));
  });

  it('does not time out once the owner answered', () => {
    const { consultId } = service.callOwner('dev-1', 'Vendedor');
    service.accept(consultId);

    jest.advanceTimersByTime(60_000);

    expect(service.getSnapshot(consultId).status).toBe('answered');
    expect(doorbell.resume).not.toHaveBeenCalled();
  });

  it('resumes the doorbell if the owner hangs up without deciding', () => {
    const { consultId } = service.callOwner('dev-1', 'Visita');
    service.accept(consultId);
    const owner = { notify: jest.fn() };
    service.registerOwnerSession(consultId, owner);

    service.unregisterOwnerSession(consultId, owner);

    expect(doorbell.resume).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot(consultId).status).toBe('closed');
  });

  it('forwards new visitor details to the owner already on the call', () => {
    const { consultId } = service.callOwner('dev-1', 'Visita');
    service.accept(consultId);
    const owner = { notify: jest.fn() };
    service.registerOwnerSession(consultId, owner);
    service.instruct(consultId, 'Pregúntale su nombre');

    const again = service.callOwner('dev-1', 'Se llama Luis, viene por la tele');

    expect(again).toMatchObject({ status: 'owner_notified', consultId });
    expect(owner.notify).toHaveBeenCalledWith(expect.stringContaining('Luis'));
    expect(doorbell.pause).toHaveBeenCalledTimes(2);
  });

  it('ends the consult and warns the owner when the visitor leaves', () => {
    const { consultId } = service.callOwner('dev-1', 'Visita');
    service.accept(consultId);
    const owner = { notify: jest.fn() };
    service.registerOwnerSession(consultId, owner);

    service.unregisterDoorbell('dev-1');

    expect(owner.notify).toHaveBeenCalled();
    expect(service.getSnapshot(consultId).status).toBe('visitor_left');
    expect(service.listActive()).toHaveLength(0);
  });

  it('accept/decline arrive from the browser socket', () => {
    const viewer = makeViewer();
    service.addViewer(viewer.socket);
    const { consultId } = service.callOwner('dev-1', 'Visita');

    service.handleViewerMessage(
      viewer.socket,
      JSON.stringify({ type: 'consult.decline', consultId }),
    );

    expect(service.getSnapshot(consultId).status).toBe('declined');
    expect(doorbell.resume).toHaveBeenCalledTimes(1);
  });
});
