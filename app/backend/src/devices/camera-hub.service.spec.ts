import type WebSocket from 'ws';
import { CameraHubService } from './camera-hub.service';

function makeSocket(): { socket: WebSocket; sent: string[] } {
  const sent: string[] = [];
  const socket = {
    OPEN: 1,
    readyState: 1,
    send: (data: unknown) => {
      if (typeof data === 'string') {
        sent.push((JSON.parse(data) as { type: string }).type);
      }
    },
    close: jest.fn(),
  } as unknown as WebSocket;
  return { socket, sent };
}

const jpeg = (marker: number) => Buffer.from([0xff, 0xd8, 0xff, marker]);

describe('CameraHubService.captureFrame', () => {
  let hub: CameraHubService;

  beforeEach(() => {
    jest.useFakeTimers();
    hub = new CameraHubService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns null without an online camera', async () => {
    await expect(hub.captureFrame()).resolves.toBeNull();
  });

  it('turns the stream on, skips warm-up frames and turns it off again', async () => {
    const camera = makeSocket();
    hub.registerCamera(3, camera.socket, 'Puerta');
    expect(camera.sent).toEqual([]);

    const capture = hub.captureFrame();
    expect(camera.sent).toEqual(['stream.on']);

    hub.forwardJpeg(3, jpeg(1)); // arranque del sensor: se descarta
    jest.advanceTimersByTime(700);
    hub.forwardJpeg(3, jpeg(2));

    await expect(capture).resolves.toMatchObject({
      deviceId: 3,
      jpeg: jpeg(2),
    });
    expect(camera.sent).toEqual(['stream.on', 'stream.off']);
  });

  it('reuses a fresh frame while someone is already watching', async () => {
    const camera = makeSocket();
    const viewer = makeSocket();
    hub.registerCamera(3, camera.socket, 'Puerta');
    hub.addViewer(viewer.socket);
    hub.forwardJpeg(3, jpeg(5));

    await expect(hub.captureFrame()).resolves.toMatchObject({ jpeg: jpeg(5) });
    expect(camera.sent).toEqual(['stream.on']);
  });

  it('falls back to a warm-up frame when no better one arrives in time', async () => {
    const camera = makeSocket();
    hub.registerCamera(3, camera.socket, 'Puerta');

    const capture = hub.captureFrame(1000);
    hub.forwardJpeg(3, jpeg(1));
    jest.advanceTimersByTime(1000);

    await expect(capture).resolves.toMatchObject({ jpeg: jpeg(1) });
    expect(camera.sent).toEqual(['stream.on', 'stream.off']);
  });

  it('keeps the stream on for viewers after a capture finishes', async () => {
    const camera = makeSocket();
    const viewer = makeSocket();
    hub.registerCamera(3, camera.socket, 'Puerta');

    const capture = hub.captureFrame();
    hub.addViewer(viewer.socket);
    jest.advanceTimersByTime(700);
    hub.forwardJpeg(3, jpeg(2));
    await capture;

    expect(camera.sent).toEqual(['stream.on']);
  });
});
