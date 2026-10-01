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
    extractionMinChars: parseInt(
      process.env.KB_EXTRACTION_MIN_CHARS ?? '100',
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
    extractionEnabled:
      (process.env.KB_EXTRACTION_ENABLED ?? 'false').toLowerCase() === 'true',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ??
      'http://localhost:3000/google/auth/callback',
    tokenEncryptionKey: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ?? '',
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
  transcription: {
    model: process.env.TRANSCRIPTION_MODEL ?? 'gpt-4o-mini-transcribe',
    chunkSeconds: parseInt(process.env.TRANSCRIPTION_CHUNK_SECONDS ?? '60', 10),
    storageDir:
      process.env.TRANSCRIPTION_STORAGE_DIR ??
      join(process.cwd(), 'storage/transcripts'),
    queueConcurrency: parseInt(
      process.env.TRANSCRIPTION_QUEUE_CONCURRENCY ?? '3',
      10,
    ),
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  monorepoRoot: join(__dirname, '../../../..'),
});
