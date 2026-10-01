import { useCallback, useEffect, useState } from 'react';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export interface TranscriptSummary {
  id: number;
  title: string;
  status: 'recording' | 'completed' | 'failed';
  durationSeconds: number | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptSegment {
  id: number;
  sequenceNumber: number;
  text: string;
  language: string | null;
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
}

/** Metadatos del transcript sin el cuerpo completo. */
export interface TranscriptMeta extends TranscriptSummary {
  segmentCount: number;
}

export interface TranscriptSegmentsPage {
  segments: TranscriptSegment[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export function useTranscripts() {
  const [transcripts, setTranscripts] = useState<TranscriptSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/transcripts`);
      if (!res.ok) return;
      const data = (await res.json()) as TranscriptSummary[];
      setTranscripts(data);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const rename = useCallback(
    async (id: number, title: string) => {
      const res = await fetch(`${API_BASE_URL}/transcripts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        throw new Error('No se pudo renombrar');
      }
      await refetch();
    },
    [refetch],
  );

  const remove = useCallback(
    async (id: number) => {
      const res = await fetch(`${API_BASE_URL}/transcripts/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error('No se pudo eliminar');
      }
      await refetch();
    },
    [refetch],
  );

  const getMeta = useCallback(async (id: number): Promise<TranscriptMeta> => {
    const res = await fetch(`${API_BASE_URL}/transcripts/${id}`);
    if (!res.ok) {
      throw new Error('No se pudo cargar el transcript');
    }
    return (await res.json()) as TranscriptMeta;
  }, []);

  const getSegments = useCallback(
    async (
      id: number,
      offset = 0,
      limit = 20,
    ): Promise<TranscriptSegmentsPage> => {
      const res = await fetch(
        `${API_BASE_URL}/transcripts/${id}/segments?offset=${offset}&limit=${limit}`,
      );
      if (!res.ok) {
        throw new Error('No se pudieron cargar los segmentos');
      }
      return (await res.json()) as TranscriptSegmentsPage;
    },
    [],
  );

  const downloadUrl = useCallback((id: number) => {
    return `${API_BASE_URL}/transcripts/${id}/download`;
  }, []);

  return {
    transcripts,
    loading,
    refetch,
    rename,
    remove,
    getMeta,
    getSegments,
    downloadUrl,
  };
}
