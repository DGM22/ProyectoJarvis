import { useCallback, useSyncExternalStore } from 'react';
import {
  getWakeWordEnabled,
  setWakeWordEnabled as persistWakeWordEnabled,
} from '@/lib/wakeWordPreference';

const STORAGE_KEY = 'jarvis:wake-word-enabled';

function subscribe(callback: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback();
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

export function useWakeWordPreference(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(
    subscribe,
    getWakeWordEnabled,
    () => false,
  );

  const setEnabled = useCallback((next: boolean) => {
    persistWakeWordEnabled(next);
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
  }, []);

  return [enabled, setEnabled];
}
