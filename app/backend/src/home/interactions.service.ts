import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ConsultService } from '../consult/consult.service';
import type { ConsultEvent } from '../consult/consult.types';
import { HomeService } from './home.service';
import { Actuator } from './models/actuator.model';
import { AiResponse } from './models/ai-response.model';
import { Interaction } from './models/interaction.model';
import { OwnerNotification } from './models/notification.model';
import { PipelineError } from './models/pipeline-error.model';
import { Recognition } from './models/recognition.model';

export type VisitReason = 'button' | 'wake' | 'inbound';

const REASON_TEXT: Record<VisitReason, string> = {
  button: 'Tocaron el timbre',
  wake: 'Activación por voz en la puerta',
  inbound: 'Llamada desde la app',
};

/** Visita en curso (en memoria) mientras dura la sesión del dispositivo. */
interface LiveVisit {
  interactionId: number;
  deviceId: number;
  speakerId: number | null;
  lines: string[];
  /** El dueño intervino (contestó o habló directo): no la atendió solo la IA. */
  ownerAnswered: boolean;
}

/** Contadores del día para el inicio de la app. */
export interface VisitSummary {
  total: number;
  /** Atendidas solo por Jarvis. */
  byAi: number;
  /** Las que contestaste tú. */
  byOwner: number;
  /** Se avisó a alguien y nadie contestó. */
  missed: number;
  lastVisitAt: string | null;
}

export type HistoryFilter = 'all' | 'ai' | 'owner' | 'recognized' | 'missed';

export interface VisitHistoryItem {
  id: number;
  occurredAt: string;
  reason: string | null;
  handledByAi: boolean;
  deviceName: string;
  transcript: string | null;
  consultId: string | null;
  recognition: { recognized: boolean; personName: string | null; confidence: number | null } | null;
  notifications: Array<{ personName: string; response: string | null; respondedAt: string | null }>;
  aiResponses: number;
  errors: number;
}

/**
 * Historial de la puerta: cada sesión del dispositivo es una `interaction`, y
 * de ella cuelgan lo que dijo la IA, a quién se le avisó y qué contestó, el
 * reconocimiento facial y los errores. Escribe sin bloquear la llamada: si la
 * base falla, se registra en el log y la visita sigue.
 */
@Injectable()
export class InteractionsService implements OnModuleInit {
  private readonly logger = new Logger(InteractionsService.name);
  private readonly live = new Map<string, LiveVisit>();

  constructor(
    private readonly homeService: HomeService,
    private readonly consultService: ConsultService,
    @InjectModel(Interaction) private readonly interactionModel: typeof Interaction,
    @InjectModel(Actuator) private readonly actuatorModel: typeof Actuator,
    @InjectModel(AiResponse) private readonly aiResponseModel: typeof AiResponse,
    @InjectModel(OwnerNotification)
    private readonly notificationModel: typeof OwnerNotification,
    @InjectModel(Recognition) private readonly recognitionModel: typeof Recognition,
    @InjectModel(PipelineError) private readonly errorModel: typeof PipelineError,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  onModuleInit(): void {
    this.consultService.addListener((event) => {
      void this.safely(`consult ${event.type}`, () => this.onConsultEvent(event));
    });
  }

  /** Empieza una visita al abrirse la sesión del dispositivo. */
  async startVisit(
    sessionKey: string,
    deviceId: number,
    reason: VisitReason,
    note?: string,
  ): Promise<void> {
    await this.safely('start visit', async () => {
      await this.homeService.ensureDeviceDefaults(deviceId);
      const sensor = await this.homeService.findSensor(
        deviceId,
        reason === 'button' ? 'doorbell_button' : 'microphone',
      );
      if (!sensor) return;
      const speaker = await this.actuatorModel.findOne({ where: { deviceId, type: 'speaker' } });
      const interaction = await this.interactionModel.create({
        sensorId: sensor.id,
        reason: (note ? `${REASON_TEXT[reason]} · ${note}` : REASON_TEXT[reason]).slice(0, 100),
        handledByAi: true,
      });
      this.live.set(sessionKey, {
        interactionId: interaction.id,
        deviceId,
        speakerId: speaker?.id ?? null,
        lines: [],
        ownerAnswered: false,
      });
    });
  }

  /** Alguien de la casa abrió la cámara y habló por la bocina sin que tocaran. */
  async recordLiveSession(deviceId: number, personName: string): Promise<void> {
    await this.safely('live session', async () => {
      await this.homeService.ensureDeviceDefaults(deviceId);
      const sensor = await this.homeService.findSensor(deviceId, 'microphone');
      if (!sensor) return;
      await this.interactionModel.create({
        sensorId: sensor.id,
        reason: `Hablaste por la puerta desde la app (${personName})`.slice(0, 100),
        handledByAi: false,
      });
    });
  }

  /** Cierra la visita: guarda la conversación y quién la atendió. */
  async endVisit(sessionKey: string): Promise<void> {
    const visit = this.live.get(sessionKey);
    this.live.delete(sessionKey);
    if (!visit) return;
    await this.safely('end visit', async () => {
      await this.interactionModel.update(
        {
          transcript: visit.lines.length > 0 ? visit.lines.join('\n') : null,
          handledByAi: !visit.ownerAnswered,
        },
        { where: { id: visit.interactionId } },
      );
      // Avisos que nadie contestó antes de que se fuera el visitante.
      await this.notificationModel.update(
        { response: 'expired', respondedAt: new Date() },
        { where: { interactionId: visit.interactionId, response: null } },
      );
    });
  }

  async recordError(
    deviceId: number,
    sessionKey: string | null,
    code: string,
    description: string,
  ): Promise<void> {
    const interactionId = sessionKey ? (this.live.get(sessionKey)?.interactionId ?? null) : null;
    await this.safely('record error', () =>
      this.errorModel.create({
        deviceId,
        interactionId,
        code: code.slice(0, 20),
        description: description.slice(0, 2000),
      }),
    );
  }

  /** Resultado del reconocimiento facial de la visita en curso. */
  async recordRecognition(
    sessionKey: string,
    result: { recognized: boolean; personId: number | null; confidence: number | null },
  ): Promise<void> {
    const visit = this.live.get(sessionKey);
    if (!visit) return;
    await this.safely('record recognition', () =>
      this.recognitionModel.create({
        interactionId: visit.interactionId,
        recognized: result.recognized,
        personId: result.recognized ? result.personId : null,
        confidence:
          result.confidence === null ? null : Math.min(1, Math.max(0, result.confidence)).toFixed(3),
      }),
    );
  }

  /**
   * Resumen del día en la zona horaria de la casa. Solo cuentan las visitas
   * (sensor del timbre o del micrófono con una sesión), no las vistas en vivo.
   */
  async summary(timezone: string): Promise<VisitSummary> {
    const [row] = await this.sequelize.query<{
      total: number;
      by_ai: number;
      by_owner: number;
      missed: number;
      last_visit_at: Date | null;
    }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE i.handled_by_ai)::int AS by_ai,
              COUNT(*) FILTER (WHERE NOT i.handled_by_ai)::int AS by_owner,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM notifications n WHERE n.interaction_id = i.id)
                                 AND NOT EXISTS (SELECT 1 FROM notifications n
                                                  WHERE n.interaction_id = i.id AND n.response = 'open'))::int AS missed,
              (SELECT MAX(occurred_at) FROM interactions) AS last_visit_at
         FROM interactions i
        WHERE i.occurred_at >= (date_trunc('day', NOW() AT TIME ZONE :tz) AT TIME ZONE :tz)`,
      { type: QueryTypes.SELECT, replacements: { tz: timezone } },
    );
    return {
      total: row.total,
      byAi: row.by_ai,
      byOwner: row.by_owner,
      missed: row.missed,
      lastVisitAt: row.last_visit_at ? new Date(row.last_visit_at).toISOString() : null,
    };
  }

  /** Visitas más recientes con sus banderas, paginadas por id. */
  async history(options: {
    limit: number;
    before?: number;
    filter: HistoryFilter;
  }): Promise<VisitHistoryItem[]> {
    const filters: Record<HistoryFilter, string> = {
      all: 'TRUE',
      ai: 'i.handled_by_ai',
      owner: 'NOT i.handled_by_ai',
      recognized:
        'EXISTS (SELECT 1 FROM recognitions r WHERE r.interaction_id = i.id AND r.recognized)',
      missed: `EXISTS (SELECT 1 FROM notifications n WHERE n.interaction_id = i.id)
               AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.interaction_id = i.id AND n.response = 'open')`,
    };
    const rows = await this.sequelize.query<{
      id: number;
      occurred_at: Date;
      reason: string | null;
      handled_by_ai: boolean;
      device_name: string;
      transcript: string | null;
      consult_id: string | null;
      recognition: VisitHistoryItem['recognition'] & { confidence: string | number | null };
      notifications: VisitHistoryItem['notifications'] | null;
      ai_responses: number;
      errors: number;
    }>(
      `SELECT i.id, i.occurred_at, i.reason, i.handled_by_ai, i.transcript, i.consult_id,
              d.name AS device_name,
              (SELECT json_build_object('recognized', r.recognized, 'personName', p.name,
                                        'confidence', r.confidence)
                 FROM recognitions r LEFT JOIN people p ON p.id = r.person_id
                WHERE r.interaction_id = i.id ORDER BY r.id DESC LIMIT 1) AS recognition,
              (SELECT json_agg(json_build_object('personName', p.name, 'response', n.response,
                                                 'respondedAt', n.responded_at) ORDER BY n.id)
                 FROM notifications n JOIN people p ON p.id = n.person_id
                WHERE n.interaction_id = i.id) AS notifications,
              (SELECT COUNT(*) FROM ai_responses a WHERE a.interaction_id = i.id)::int AS ai_responses,
              (SELECT COUNT(*) FROM pipeline_errors e WHERE e.interaction_id = i.id)::int AS errors
         FROM interactions i
         JOIN sensors s ON s.id = i.sensor_id
         JOIN devices d ON d.id = s.device_id
        WHERE (CAST(:before AS INTEGER) IS NULL OR i.id < :before)
          AND ${filters[options.filter]}
        ORDER BY i.id DESC
        LIMIT :limit`,
      {
        type: QueryTypes.SELECT,
        replacements: { before: options.before ?? null, limit: options.limit },
      },
    );
    return rows.map((row) => ({
      id: row.id,
      occurredAt: new Date(row.occurred_at).toISOString(),
      reason: row.reason,
      handledByAi: row.handled_by_ai,
      deviceName: row.device_name,
      transcript: row.transcript,
      consultId: row.consult_id,
      recognition: row.recognition
        ? {
            recognized: row.recognition.recognized,
            personName: row.recognition.personName,
            confidence: row.recognition.confidence === null ? null : Number(row.recognition.confidence),
          }
        : null,
      notifications: row.notifications ?? [],
      aiResponses: row.ai_responses,
      errors: row.errors,
    }));
  }

  private async onConsultEvent(event: ConsultEvent): Promise<void> {
    const visit = this.live.get(event.sessionKey);
    if (!visit) return;

    switch (event.type) {
      case 'transcript': {
        const who = event.role === 'visitor' ? 'Visitante' : 'Jarvis';
        visit.lines.push(`${who}: ${event.text}`);
        if (event.role === 'doorbell' && visit.speakerId !== null) {
          await this.aiResponseModel.create({
            interactionId: visit.interactionId,
            actuatorId: visit.speakerId,
            responseText: event.text,
          });
        }
        return;
      }
      case 'ringing': {
        await this.interactionModel.update(
          { consultId: event.consultId },
          { where: { id: visit.interactionId } },
        );
        // Se avisa a quien puede contestar: personas activas con cuenta.
        const people = await this.sequelize.query<{ person_id: number }>(
          `SELECT DISTINCT u.person_id FROM users u
             JOIN people p ON p.id = u.person_id WHERE p.active`,
          { type: QueryTypes.SELECT },
        );
        if (people.length > 0) {
          await this.notificationModel.bulkCreate(
            people.map(({ person_id }) => ({
              interactionId: visit.interactionId,
              personId: person_id,
            })),
          );
        }
        return;
      }
      case 'answered':
      case 'declined': {
        if (event.type === 'answered') {
          visit.ownerAnswered = true;
        }
        await this.answerNotifications(
          visit.interactionId,
          event.personId,
          event.type === 'answered' ? 'open' : 'ignore',
        );
        return;
      }
      case 'intercom':
        visit.ownerAnswered = true;
        return;
      case 'ended':
        if (event.status === 'missed') {
          await this.notificationModel.update(
            { response: 'expired', respondedAt: new Date() },
            { where: { interactionId: visit.interactionId, response: null } },
          );
        }
        return;
    }
  }

  /** Marca la respuesta de quien contestó; los demás avisos quedan expirados. */
  private async answerNotifications(
    interactionId: number,
    personId: number | null,
    response: 'open' | 'ignore',
  ): Promise<void> {
    const now = new Date();
    if (personId !== null) {
      await this.notificationModel.update(
        { response, respondedAt: now },
        { where: { interactionId, personId, response: null } },
      );
    }
    await this.notificationModel.update(
      { response: 'expired', respondedAt: now },
      { where: { interactionId, response: null } },
    );
  }

  private async safely(label: string, task: () => Promise<unknown>): Promise<void> {
    try {
      await task();
    } catch (error) {
      this.logger.error(
        `Historial (${label}) falló: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
