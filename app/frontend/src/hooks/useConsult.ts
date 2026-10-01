import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '@/lib/api/http';
import { deriveWsUrl } from '@/lib/wsUrl';
import type { ConsultServerMessage, ConsultSnapshot } from '@/types/consult';

const RECONNECT_MS = 3000;
/** Conserva consultas terminadas un rato para mostrar el cierre en pantalla. */
const ENDED_VISIBLE_MS = 15_000;

type ConsultAction = 'consult.accept' | 'consult.decline' | 'consult.close';

/**
 * Suscripción al WS `/consult`: anillo del timbre y estado de la consulta.
 * Reconecta solo; el servidor manda un snapshot de lo activo al conectar.
 */
export function useConsult() {
  const [consults, setConsults] = useState<Record<string, ConsultSnapshot>>({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const ws = new WebSocket(`${deriveWsUrl(API_BASE_URL)}/consult`);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        if (!closed) setConnected(true);
      });

      ws.addEventListener('message', (event: MessageEvent<string>) => {
        if (closed || typeof event.data !== 'string') return;
        let message: ConsultServerMessage;
        try {
          message = JSON.parse(event.data) as ConsultServerMessage;
        } catch {
          return;
        }

        if (message.type === 'consult.snapshot') {
          setConsults(
            Object.fromEntries(message.consults.map((consult) => [consult.id, consult])),
          );
        } else if (message.type === 'consult.update') {
          setConsults((prev) => ({ ...prev, [message.consult.id]: message.consult }));
        }
      });

      ws.addEventListener('close', () => {
        if (closed) return;
        setConnected(false);
        reconnectTimer = setTimeout(connect, RECONNECT_MS);
      });

      ws.addEventListener('error', () => {
        ws.close();
      });
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  // Purga consultas cerradas para que el panel desaparezca solo.
  useEffect(() => {
    const id = window.setInterval(() => {
      const cutoff = Date.now() - ENDED_VISIBLE_MS;
      setConsults((prev) => {
        const entries = Object.entries(prev).filter(
          ([, consult]) =>
            !consult.endedAt || new Date(consult.endedAt).getTime() > cutoff,
        );
        return entries.length === Object.keys(prev).length
          ? prev
          : Object.fromEntries(entries);
      });
    }, 5000);
    return () => window.clearInterval(id);
  }, []);

  const send = useCallback((type: ConsultAction, consultId: string): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type, consultId }));
    return true;
  }, []);

  return {
    consults,
    connected,
    accept: useCallback((id: string) => send('consult.accept', id), [send]),
    decline: useCallback((id: string) => send('consult.decline', id), [send]),
    close: useCallback((id: string) => send('consult.close', id), [send]),
  };
}
