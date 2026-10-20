import { join } from 'path';

/**
 * Configuración tipada de la aplicación a partir de variables de entorno.
 *
 * Cada clave define un valor por defecto apto para desarrollo local, de modo que
 * el backend arranque sin un `.env` completo.
 */
export default () => ({
  backendPort: parseInt(process.env.BACKEND_PORT ?? '3000', 10),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  auth: {
    /** Firma las cookies de sesión. Sin él, las sesiones mueren al reiniciar. */
    secret: process.env.AUTH_SECRET ?? '',
    sessionDays: parseInt(process.env.AUTH_SESSION_DAYS ?? '30', 10),
  },
  app: {
    timezone: process.env.APP_TIMEZONE ?? 'America/Mexico_City',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    realtimeModel: process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime-2.1',
    realtimeVoice: process.env.OPENAI_REALTIME_VOICE ?? 'cedar',
    textModel: process.env.OPENAI_TEXT_MODEL ?? 'gpt-4.1',
    embeddingModel:
      process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
  },
  knowledgeBase: {
    // Resolved at runtime via entities.is_default when empty.
    defaultEntityId: process.env.KB_DEFAULT_ENTITY_ID ?? '',
    confidenceActiveThreshold: parseFloat(
      process.env.KB_CONFIDENCE_ACTIVE_THRESHOLD ?? '0.75',
    ),
    cosineSameFactThreshold: parseFloat(
      process.env.KB_COSINE_SAME_FACT_THRESHOLD ?? '0.92',
    ),
    tokenOverlapThreshold: parseFloat(
      process.env.KB_TOKEN_OVERLAP_THRESHOLD ?? '0.85',
    ),
    observationPromoteThreshold: parseInt(
      process.env.KB_OBSERVATION_PROMOTE_THRESHOLD ?? '3',
      10,
    ),
    passiveDefaultConfidence: parseFloat(
      process.env.KB_PASSIVE_DEFAULT_CONFIDENCE ?? '0.6',
    ),
    pendingReviewTtlDays: parseInt(
      process.env.KB_PENDING_REVIEW_TTL_DAYS ?? '30',
      10,
    ),
    reconciliationSimilarityThreshold: parseFloat(
      process.env.KB_RECONCILIATION_SIMILARITY_THRESHOLD ?? '0.9',
    ),
    rrfK: parseInt(process.env.KB_RRF_K ?? '60', 10),
    recencyHalfLifeDays: parseInt(
      process.env.KB_RECENCY_HALF_LIFE_DAYS ?? '180',
      10,
    ),
  },
  database: {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    username: process.env.POSTGRES_USER ?? 'jarvis',
    password: process.env.POSTGRES_PASSWORD ?? 'jarvis_secret',
    name: process.env.POSTGRES_DB ?? 'jarvis',
  },
  wakeword: {
    serviceUrl: process.env.WAKEWORD_SERVICE_URL ?? 'ws://localhost:8765',
    wsToken: process.env.WAKEWORD_WS_TOKEN ?? '',
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  aws: {
    // Sin región la verificación facial queda deshabilitada. Las credenciales
    // las resuelve el SDK (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY o rol IAM).
    region: process.env.AWS_REGION ?? '',
    faceMatchThreshold: parseFloat(process.env.FACE_MATCH_THRESHOLD ?? '90'),
  },
  monorepoRoot: join(__dirname, '../../../..'),
});
