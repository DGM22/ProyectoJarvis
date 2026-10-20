import { API_BASE_URL, apiFetch, jsonRequest, parseJson } from './http';

export type AttentionMode = 'ai_first' | 'ring_first' | 'ai_only';

export interface AttentionSettings {
  mode: AttentionMode;
  ringSeconds: number;
}

export const MIN_RING_SECONDS = 8;
export const MAX_RING_SECONDS = 60;

export async function getAttention(): Promise<AttentionSettings> {
  return parseJson(await apiFetch(`${API_BASE_URL}/settings/attention`));
}

export async function saveAttention(input: Partial<AttentionSettings>): Promise<AttentionSettings> {
  return parseJson(await apiFetch(`${API_BASE_URL}/settings/attention`, jsonRequest('PUT', input)));
}
