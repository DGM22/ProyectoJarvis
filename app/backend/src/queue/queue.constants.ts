/** Token de inyección para la conexión Redis compartida (ioredis). */
export const REDIS_CONNECTION = Symbol('REDIS_CONNECTION');

/** Nombre de la cola de mantenimiento/reconciliación de KB. */
export const KB_MAINTENANCE_QUEUE_NAME = 'kb-maintenance';

/** Token de inyección para la cola de mantenimiento de KB. */
export const KB_MAINTENANCE_QUEUE = Symbol('KB_MAINTENANCE_QUEUE');

export type KbMaintenanceJob =
  | { type: 'reconcile' }
  | { type: 'vacuum_and_ttl' };
