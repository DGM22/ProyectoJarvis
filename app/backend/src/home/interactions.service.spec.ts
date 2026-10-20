import type { ConsultEvent, ConsultListener } from '../consult/consult.types';
import { InteractionsService } from './interactions.service';

/** Modelo Sequelize de mentira: solo lo que usa el servicio. */
function model() {
  return {
    create: jest.fn().mockResolvedValue({ id: 10 }),
    bulkCreate: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue([1]),
    findOne: jest.fn().mockResolvedValue({ id: 5 }),
  };
}

function setup() {
  let listener: ConsultListener = () => undefined;
  const consultService = { addListener: (l: ConsultListener) => (listener = l) };
  const homeService = {
    ensureDeviceDefaults: jest.fn().mockResolvedValue(undefined),
    findSensor: jest.fn().mockResolvedValue({ id: 3 }),
  };
  const interactionModel = model();
  const actuatorModel = model();
  const aiResponseModel = model();
  const notificationModel = model();
  const recognitionModel = model();
  const errorModel = model();
  const sequelize = { query: jest.fn().mockResolvedValue([{ person_id: 1 }, { person_id: 2 }]) };

  const service = new InteractionsService(
    homeService as never,
    consultService as never,
    interactionModel as never,
    actuatorModel as never,
    aiResponseModel as never,
    notificationModel as never,
    recognitionModel as never,
    errorModel as never,
    sequelize as never,
  );
  service.onModuleInit();

  /** El listener corre async (void); esperar a que termine la escritura. */
  const emit = async (event: ConsultEvent) => {
    listener(event);
    await new Promise((resolve) => setImmediate(resolve));
  };

  return {
    service,
    emit,
    interactionModel,
    aiResponseModel,
    notificationModel,
    recognitionModel,
    errorModel,
  };
}

describe('InteractionsService', () => {
  it('records a full visit answered by the owner', async () => {
    const t = setup();
    await t.service.startVisit('dev-2-1', 2, 'button');
    expect(t.interactionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ sensorId: 3, reason: 'Tocaron el timbre', handledByAi: true }),
    );

    await t.emit({ type: 'transcript', sessionKey: 'dev-2-1', role: 'visitor', text: 'Vengo con Daniel' });
    await t.emit({ type: 'transcript', sessionKey: 'dev-2-1', role: 'doorbell', text: 'Un momento' });
    expect(t.aiResponseModel.create).toHaveBeenCalledWith({
      interactionId: 10,
      actuatorId: 5,
      responseText: 'Un momento',
    });

    await t.emit({ type: 'ringing', consultId: 'c1', sessionKey: 'dev-2-1', summary: 'Visita' });
    expect(t.notificationModel.bulkCreate).toHaveBeenCalledWith([
      { interactionId: 10, personId: 1 },
      { interactionId: 10, personId: 2 },
    ]);

    await t.emit({ type: 'answered', consultId: 'c1', sessionKey: 'dev-2-1', personId: 1 });
    expect(t.notificationModel.update).toHaveBeenCalledWith(
      expect.objectContaining({ response: 'open' }),
      { where: { interactionId: 10, personId: 1, response: null } },
    );
    expect(t.notificationModel.update).toHaveBeenCalledWith(
      expect.objectContaining({ response: 'expired' }),
      { where: { interactionId: 10, response: null } },
    );

    await t.service.endVisit('dev-2-1');
    expect(t.interactionModel.update).toHaveBeenCalledWith(
      { transcript: 'Visitante: Vengo con Daniel\nJarvis: Un momento', handledByAi: false },
      { where: { id: 10 } },
    );
  });

  it('a visit nobody answered stays handled by the AI', async () => {
    const t = setup();
    await t.service.startVisit('dev-2-1', 2, 'button');
    await t.emit({ type: 'ringing', consultId: 'c1', sessionKey: 'dev-2-1', summary: 'Visita' });
    await t.emit({ type: 'ended', consultId: 'c1', sessionKey: 'dev-2-1', status: 'missed' });
    await t.service.endVisit('dev-2-1');

    expect(t.interactionModel.update).toHaveBeenCalledWith(
      expect.objectContaining({ handledByAi: true }),
      { where: { id: 10 } },
    );
  });

  it('stores face recognition and errors for the live visit', async () => {
    const t = setup();
    await t.service.startVisit('dev-2-1', 2, 'button');

    await t.service.recordRecognition('dev-2-1', { recognized: true, personId: 1, confidence: 0.982 });
    expect(t.recognitionModel.create).toHaveBeenCalledWith({
      interactionId: 10,
      recognized: true,
      personId: 1,
      confidence: '0.982',
    });

    await t.service.recordError(2, 'dev-2-1', 'realtime', 'socket closed');
    expect(t.errorModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 2, interactionId: 10, code: 'realtime' }),
    );
  });

  it('never throws into the call if the database fails', async () => {
    const t = setup();
    t.interactionModel.create.mockRejectedValueOnce(new Error('db down'));
    await expect(t.service.startVisit('dev-2-1', 2, 'button')).resolves.toBeUndefined();
    await expect(t.service.endVisit('dev-2-1')).resolves.toBeUndefined();
  });
});
