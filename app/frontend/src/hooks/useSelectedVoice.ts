import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_VOICE_ID, VOICES, type VoiceId } from '@/constants/voices';

const STORAGE_KEY = 'jarvis:voice';

function getSnapshot(): VoiceId {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw && VOICES.some((v) => v.id === raw)) {
    return raw as VoiceId;
  }
  return DEFAULT_VOICE_ID;
}

function subscribe(callback: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback();
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

export function useSelectedVoice(): [VoiceId, (id: VoiceId) => void] {
  const voice = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_VOICE_ID);

  const setVoice = useCallback((id: VoiceId) => {
    localStorage.setItem(STORAGE_KEY, id);
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
  }, []);

  return [voice, setVoice];
}
