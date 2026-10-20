import { useState, type ReactNode } from 'react';
import { AlertTriangle, Bell, BellOff, Bot, ChevronDown, ScanFace, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VisitHistoryItem } from '@/lib/api/interactions';

type Tone = 'accent' | 'ok' | 'danger' | 'neutral';

const TONES: Record<Tone, string> = {
  accent: 'border-accent-400/60 bg-accent-wash text-accent-400',
  ok: 'border-ok/50 bg-ok/10 text-ok',
  danger: 'border-danger/50 bg-danger/10 text-danger-soft',
  neutral: 'border-border bg-overlay text-text-mid',
};

function Flag({ icon, tone, children }: { icon: ReactNode; tone: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        TONES[tone],
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
}

/** Resumen de los avisos: quién abrió/ignoró, o que nadie contestó. */
function notificationFlag(visit: VisitHistoryItem): ReactNode {
  if (visit.notifications.length === 0) return null;
  const opened = visit.notifications.find((n) => n.response === 'open');
  if (opened) {
    return (
      <Flag icon={<Bell size={11} />} tone="ok">
        Abrió {opened.personName}
      </Flag>
    );
  }
  const ignored = visit.notifications.find((n) => n.response === 'ignore');
  if (ignored) {
    return (
      <Flag icon={<BellOff size={11} />} tone="neutral">
        Rechazó {ignored.personName}
      </Flag>
    );
  }
  if (visit.notifications.every((n) => n.response === 'expired')) {
    return (
      <Flag icon={<BellOff size={11} />} tone="danger">
        Nadie contestó
      </Flag>
    );
  }
  return (
    <Flag icon={<Bell size={11} />} tone="neutral">
      Avisado a {visit.notifications.length}
    </Flag>
  );
}

function recognitionFlag(visit: VisitHistoryItem): ReactNode {
  const recognition = visit.recognition;
  if (!recognition) return null;
  if (!recognition.recognized) {
    return (
      <Flag icon={<ScanFace size={11} />} tone="neutral">
        No reconocido
      </Flag>
    );
  }
  const percent =
    recognition.confidence !== null ? ` · ${Math.round(recognition.confidence * 100)}%` : '';
  return (
    <Flag icon={<ScanFace size={11} />} tone="ok">
      {recognition.personName ?? 'Reconocido'}
      {percent}
    </Flag>
  );
}

/** Una visita del historial; se expande para ver la conversación. */
export function VisitCard({ visit }: { visit: VisitHistoryItem }) {
  const [open, setOpen] = useState(false);
  const lines = visit.transcript?.split('\n').filter(Boolean) ?? [];
  const lastLine = lines.at(-1);

  return (
    <article className="rounded-2xl border border-border bg-surface transition-colors hover:border-accent-600/60">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 p-4 text-left"
        disabled={lines.length === 0}
      >
        <span
          className={cn(
            'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            visit.handledByAi ? 'bg-accent-wash text-accent-400' : 'bg-ok/15 text-ok',
          )}
        >
          {visit.handledByAi ? <Bot size={18} /> : <User size={18} />}
        </span>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-semibold text-text-hi">
              {visit.reason ?? 'Visita'}
            </p>
            <time
              className="shrink-0 font-mono text-[11px] text-text-low"
              dateTime={visit.occurredAt}
            >
              {formatTime(visit.occurredAt)}
            </time>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Flag
              icon={visit.handledByAi ? <Bot size={11} /> : <User size={11} />}
              tone={visit.handledByAi ? 'accent' : 'ok'}
            >
              {visit.handledByAi ? 'Atendió Jarvis' : 'Contestaste'}
            </Flag>
            {recognitionFlag(visit)}
            {notificationFlag(visit)}
            {visit.errors > 0 && (
              <Flag icon={<AlertTriangle size={11} />} tone="danger">
                {visit.errors} error{visit.errors > 1 ? 'es' : ''}
              </Flag>
            )}
          </div>

          {!open && lastLine && <p className="line-clamp-1 text-xs text-text-mid">{lastLine}</p>}
        </div>

        {lines.length > 0 && (
          <ChevronDown
            size={16}
            className={cn('mt-2 shrink-0 text-text-low transition-transform', open && 'rotate-180')}
          />
        )}
      </button>

      {open && lines.length > 0 && (
        <ul className="space-y-1.5 border-t border-border px-4 py-3 text-sm">
          {lines.map((line, index) => {
            const isVisitor = line.startsWith('Visitante:');
            const [who, ...rest] = line.split(':');
            return (
              <li key={index} className="text-text-mid">
                <span className={cn('font-medium', isVisitor ? 'text-text-hi' : 'text-accent-400')}>
                  {who}:
                </span>
                {rest.join(':')}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
