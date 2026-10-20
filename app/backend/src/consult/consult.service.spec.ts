import type WebSocket from 'ws';
import { ConsultService } from './consult.service';
import type {
  ConsultServerMessage,
  DoorbellController,
  OwnerIntercomLink,
} from './consult.types';

function makeDoorbell(): jest.Mocked<DoorbellController> {
  return {
    pause: jest.fn(),
    resume: jest.fn(),
    startIntercom: jest.fn(),
    sendToVisitor: jest.fn(),
    setOwnerTalking: jest.fn(),
    stopIntercom: jest.fn(),
  };
}

function makeLink(): jest.Mocked<OwnerIntercomLink> {
  return { sendAudio: jest.fn(), sendState: jest.fn(), close: jest.fn() };
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

  it('does not interrupt the owner with visitor transcripts while he decides', () => {
    const { consultId } = service.callOwner('dev-1', 'Visita');
    service.accept(consultId);
    const owner = { notify: jest.fn() };
    service.registerOwnerSession(consultId, owner);

    service.appendTranscript('dev-1', 'visitor', 'Traigo dos cajas');

    expect(owner.notify).not.toHaveBeenCalled();
  });

  it('drops Whisper hallucinations from the visitor transcript', () => {
    const { consultId } = service.callOwner('dev-1', 'Visita');

    service.appendTranscript('dev-1', 'visitor', 'Un saludo y hasta la próxima.');

    expect(service.getSnapshot(consultId).transcript).toHaveLength(0);
  });

  describe('ring first (timbre tipo Ring)', () => {
    it('rings for the configured time, then the AI greets before taking a message', () => {
      const { consultId } = service.callOwner('dev-1', 'Alguien tocó el timbre', {
        ringMs: 10_000,
        ringFirst: true,
      });

      jest.advanceTimersByTime(9_999);
      expect(service.getSnapshot(consultId).status).toBe('ringing');
      expect(doorbell.resume).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(service.getSnapshot(consultId).status).toBe('missed');
      const instruction = doorbell.resume.mock.calls[0][0];
      expect(instruction).toEqual(expect.stringContaining('saludo'));
      expect(instruction).toEqual(expect.stringContaining('recado'));
    });

    it('greets only once, and only when the AI had not spoken yet', () => {
      const first = service.callOwner('dev-1', 'Visita', { ringFirst: true });
      service.accept(first.consultId);
      service.instruct(first.consultId, 'Dile que ya voy');
      expect(doorbell.resume.mock.calls[0][0]).toEqual(expect.stringContaining('saludo'));

      // Una consulta normal (la IA ya habló antes) no antepone saludo.
      const second = service.callOwner('dev-1', 'Otra visita');
      service.accept(second.consultId);
      service.instruct(second.consultId, 'Que lo deje en la puerta');
      expect(doorbell.resume.mock.calls[1][0]).not.toEqual(expect.stringContaining('saludo'));
    });

    it('knows whether someone has the app open to answer', () => {
      expect(service.hasViewers()).toBe(false);
      service.addViewer(makeViewer().socket);
      expect(service.hasViewers()).toBe(true);
    });
  });

  describe('intercom', () => {
    /** Consulta contestada con el interfón ya conectado y en vivo. */
    function liveIntercom() {
      const { consultId } = service.callOwner('dev-1', 'Visita para Daniel');
      service.accept(consultId);
      service.requestIntercom(consultId);
      const link = makeLink();
      expect(service.attachIntercom(consultId, link)).toBe(true);
      const [toOwner, handoff, onLive] = doorbell.startIntercom.mock.calls[0];
      onLive();
      return { consultId, link, toOwner, handoff };
    }

    it('rejects /intercom unless the consult requested it', () => {
      const { consultId } = service.callOwner('dev-1', 'Visita');
      service.accept(consultId);

      expect(service.attachIntercom(consultId, makeLink())).toBe(false);
      expect(service.attachIntercom('no-such-consult', makeLink())).toBe(false);
      expect(doorbell.startIntercom).not.toHaveBeenCalled();
    });

    it('requesting from a ringing consult answers it and asks the web to connect', () => {
      const viewer = makeViewer();
      service.addViewer(viewer.socket);
      const { consultId } = service.callOwner('dev-1', 'Visita');

      service.handleViewerMessage(
        viewer.socket,
        JSON.stringify({ type: 'consult.intercom.start', consultId }),
      );

      const snapshot = service.getSnapshot(consultId);
      expect(snapshot.status).toBe('answered');
      expect(snapshot.intercom).toBe('requested');
    });

    it('hands off with a short phrase and then routes audio both ways', () => {
      const { consultId, link, toOwner, handoff } = liveIntercom();

      expect(handoff).toEqual(expect.stringContaining('Te comunico'));
      expect(service.getSnapshot(consultId).intercom).toBe('on');
      expect(link.sendState).toHaveBeenCalledWith('on');

      const visitorVoice = Buffer.alloc(640, 1);
      toOwner(visitorVoice);
      expect(link.sendAudio).toHaveBeenCalledWith(visitorVoice);

      const ownerVoice = Buffer.alloc(640, 2);
      service.ownerAudio(consultId, link, ownerVoice);
      expect(doorbell.sendToVisitor).toHaveBeenCalledWith(ownerVoice);

      service.ownerTalking(consultId, link, true);
      expect(doorbell.setOwnerTalking).toHaveBeenCalledWith(true);
    });

    it('ignores audio from a stale link', () => {
      const { consultId } = liveIntercom();

      service.ownerAudio(consultId, makeLink(), Buffer.alloc(640));

      expect(doorbell.sendToVisitor).not.toHaveBeenCalled();
    });

    it('back to Jarvis: visitor waits and the owner AI is told to resume', () => {
      const { consultId, link } = liveIntercom();
      const owner = { notify: jest.fn() };
      service.registerOwnerSession(consultId, owner);

      service.detachIntercom(consultId, link, 'ai');

      const snapshot = service.getSnapshot(consultId);
      expect(snapshot.intercom).toBe('off');
      expect(snapshot.status).toBe('answered');
      expect(snapshot.awaitingOwner).toBe(true);
      expect(doorbell.stopIntercom).toHaveBeenCalledTimes(1);
      expect(doorbell.resume).not.toHaveBeenCalled();
      expect(owner.notify).toHaveBeenCalled();
    });

    it('hang up from the intercom closes the consult and the doorbell says goodbye', () => {
      const { consultId, link } = liveIntercom();

      service.detachIntercom(consultId, link, 'close');

      expect(service.getSnapshot(consultId).status).toBe('closed');
      expect(doorbell.resume).toHaveBeenCalledTimes(1);
    });

    it('hanging up Jarvis does not cut the direct talk', () => {
      const { consultId } = liveIntercom();
      const owner = { notify: jest.fn() };
      service.registerOwnerSession(consultId, owner);

      service.unregisterOwnerSession(consultId, owner);

      expect(service.getSnapshot(consultId).status).toBe('answered');
      expect(service.getSnapshot(consultId).intercom).toBe('on');
    });

    it('closes the owner socket when the visitor leaves', () => {
      const { consultId, link } = liveIntercom();

      service.unregisterDoorbell('dev-1');

      expect(link.close).toHaveBeenCalledWith('visitor_left');
      expect(service.getSnapshot(consultId).intercom).toBe('off');
    });

    it('an instruction through Jarvis stops the intercom first', () => {
      const { consultId, link } = liveIntercom();

      service.instruct(consultId, 'Dile que ya bajo');

      expect(link.close).toHaveBeenCalledWith('instructed');
      expect(doorbell.stopIntercom).toHaveBeenCalled();
      expect(doorbell.resume).toHaveBeenCalledWith(
        expect.stringContaining('ya bajo'),
      );
    });
  });
});
