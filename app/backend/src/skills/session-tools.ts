import type { SessionMode } from './skill.interface';

/** Lo único que el visitante puede disparar desde el timbre. */
export const DOORBELL_TOOL_NAMES: readonly string[] = [
  'household_list',
  'kb_search',
  'kb_save_fact',
  'call_owner',
];

/** Tools que solo tienen sentido desde el timbre. */
const DOORBELL_ONLY_TOOL_NAMES: readonly string[] = ['call_owner'];

/** Decide si una tool se publica/ejecuta en una sesión de ese modo. */
export function isToolAllowedInMode(toolName: string, mode: SessionMode): boolean {
  if (mode === 'doorbell') {
    return DOORBELL_TOOL_NAMES.includes(toolName);
  }
  return !DOORBELL_ONLY_TOOL_NAMES.includes(toolName);
}
