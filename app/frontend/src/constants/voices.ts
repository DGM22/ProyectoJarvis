export const VOICES = [
  { id: 'neutra', name: 'Neutra', hint: 'Equilibrada · por defecto', realtime: 'cedar' },
  { id: 'grave', name: 'Grave', hint: 'Pausada · tono bajo', realtime: 'echo' },
  { id: 'clara', name: 'Clara', hint: 'Rápida · articulada', realtime: 'marin' },
  { id: 'calida', name: 'Cálida', hint: 'Suave · conversacional', realtime: 'coral' },
] as const;

export type VoiceId = (typeof VOICES)[number]['id'];

export type RealtimeVoice = (typeof VOICES)[number]['realtime'];

export const DEFAULT_VOICE_ID: VoiceId = 'neutra';

export const DEFAULT_REALTIME_VOICE: RealtimeVoice = 'cedar';

/** All OpenAI Realtime voices still accepted by the backend API. */
export const REALTIME_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
] as const;

export type ApiRealtimeVoice = (typeof REALTIME_VOICES)[number];

export function toRealtimeVoice(id: VoiceId): RealtimeVoice {
  const voice = VOICES.find((item) => item.id === id);
  return voice?.realtime ?? DEFAULT_REALTIME_VOICE;
}

export function isRealtimeVoice(value: string): value is ApiRealtimeVoice {
  return (REALTIME_VOICES as readonly string[]).includes(value);
}
