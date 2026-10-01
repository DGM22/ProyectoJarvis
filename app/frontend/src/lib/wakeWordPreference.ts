const STORAGE_KEY = 'jarvis:wake-word-enabled';

export function getWakeWordEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setWakeWordEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // Storage unavailable — silently ignore.
  }
}
