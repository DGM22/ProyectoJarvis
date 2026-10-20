import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchVisitHistory,
  type HistoryFilter,
  type VisitHistoryItem,
} from '@/lib/api/interactions';

const REFRESH_MS = 30_000;

/** Historial paginado; se refresca solo para que aparezcan las visitas nuevas. */
export function useVisitHistory(filter: HistoryFilter, pageSize = 20) {
  const [items, setItems] = useState<VisitHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const requestRef = useRef(0);

  const loadFirstPage = useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const page = await fetchVisitHistory({ filter, limit: pageSize });
      if (request !== requestRef.current) return;
      setItems(page);
      setHasMore(page.length === pageSize);
      setError(null);
    } catch (err) {
      if (request === requestRef.current) {
        setError(err instanceof Error ? err.message : 'No se pudo cargar el historial');
      }
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [filter, pageSize]);

  useEffect(() => {
    setLoading(true);
    setItems([]);
    void loadFirstPage();
    const id = window.setInterval(() => void loadFirstPage(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    const last = items.at(-1);
    if (!last) return;
    const page = await fetchVisitHistory({ filter, before: last.id, limit: pageSize });
    setItems((current) => [...current, ...page]);
    setHasMore(page.length === pageSize);
  }, [filter, items, pageSize]);

  return { items, loading, error, hasMore, loadMore, refresh: loadFirstPage };
}
