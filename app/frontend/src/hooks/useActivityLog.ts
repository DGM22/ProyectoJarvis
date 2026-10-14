import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '@/lib/api/http';

export interface ActivityEntry {
  id: number;
  skillName: string;
  toolName: string;
  status: 'success' | 'error';
  summary: string;
  detail: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
}

export function useActivityLog(pollIntervalMs = 5000) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/activity-log?limit=50`);
      if (!res.ok) return;
      const data = (await res.json()) as ActivityEntry[];
      setEntries(data);
    } catch {
      // silently ignore polling failures
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchEntries();

    intervalRef.current = setInterval(() => {
      if (!document.hidden) {
        void fetchEntries();
      }
    }, pollIntervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchEntries, pollIntervalMs]);

  return { entries, loading, refetch: fetchEntries };
}
