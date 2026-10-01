import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { JarvisGraphOrb, type OrbState } from '@/components/JarvisGraphOrb';
import { VoiceSelector } from '@/components/VoiceSelector';
import { useVoiceSession } from '@/providers/VoiceSessionProvider';
import type { SessionTurn, VoiceChatStatus } from '@/types/realtime';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

const SERVICE_SCOPES = [
  { id: 'calendar', name: 'Calendar' },
  { id: 'gmail', name: 'Gmail' },
  { id: 'tasks', name: 'Tasks' },
  { id: 'drive', name: 'Drive' },
] as const;

function toOrbState(status: VoiceChatStatus, muted: boolean): OrbState {
  if (muted) return 'ready';
  switch (status) {
    case 'requesting_token':
    case 'connecting':
      return 'connecting';
    case 'listening':
      return 'listening';
    case 'speaking':
      return 'speaking';
    case 'connected':
      return 'ready';
    default:
      return 'idle';
  }
}

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function statusCopy(status: VoiceChatStatus, muted: boolean): string {
  if (muted) return 'MIC SILENCIADO';
  switch (status) {
    case 'connecting':
    case 'requesting_token':
      return 'CONECTANDO';
    case 'listening':
      return 'ESCUCHANDO';
    case 'speaking':
      return 'JARVIS RESPONDE';
    case 'connected':
      return 'EN LLAMADA';
    default:
      return 'EN REPOSO';
  }
}

/** Pantalla completa de sesión activa: transcripción en vivo + texto + voz. */
export function SessionPage() {
  const {
    status,
    error,
    isActive,
    muted,
    toggleMute,
    turns,
    sendText,
    latencyMs,
    elapsedSeconds,
    stop,
    voice,
    setVoice,
  } = useVoiceSession();

  const [email, setEmail] = useState<string | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [draft, setDraft] = useState('');
  const active = isActive;
  const orbState = toOrbState(status, muted);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/google/auth/status`);
        if (!response.ok) return;
        const payload = (await response.json()) as {
          connected: boolean;
          email: string | null;
        };
        if (cancelled) return;
        setGoogleConnected(payload.connected);
        setEmail(payload.email);
      } catch {
        // Sidebar degrada a "sin cuenta" si falla el status.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSend = (event?: FormEvent) => {
    event?.preventDefault();
    if (!draft.trim()) return;
    if (sendText(draft)) {
      setDraft('');
    }
  };

  return (
    <div className="h-dvh overflow-hidden bg-bg lg:pl-[270px]">
      <SessionSidebar
        email={email}
        googleConnected={googleConnected}
        voice={voice}
        onVoiceChange={setVoice}
        voiceDisabled={active}
        latencyMs={latencyMs}
        elapsed={formatElapsed(elapsedSeconds)}
        orbState={orbState}
      />

      <main className="flex h-dvh flex-col overflow-hidden bg-[radial-gradient(70%_55%_at_50%_100%,rgba(23,195,224,.12),transparent_70%)]">
        <Transcript
          turns={turns}
          statusLabel={statusCopy(status, muted)}
          error={error}
        />

        <SessionFooter
          state={orbState}
          muted={muted}
          onMute={toggleMute}
          onHangUp={stop}
          draft={draft}
          onDraftChange={setDraft}
          onSend={() => handleSend()}
          canSend={active}
        />
      </main>
    </div>
  );
}

function SessionSidebar({
  email,
  googleConnected,
  voice,
  onVoiceChange,
  voiceDisabled,
  latencyMs,
  elapsed,
  orbState,
}: {
  email: string | null;
  googleConnected: boolean;
  voice: Parameters<typeof VoiceSelector>[0]['value'];
  onVoiceChange: Parameters<typeof VoiceSelector>[0]['onChange'];
  voiceDisabled: boolean;
  latencyMs: number | null;
  elapsed: string;
  orbState: OrbState;
}) {
  const displayEmail = email ?? 'Sin cuenta Google';
  const initials = email
    ? email.split('@')[0].slice(0, 2).toUpperCase()
    : '—';

  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[270px] flex-col gap-6 overflow-y-auto border-r border-border bg-surface px-5 py-6 lg:flex">
      <div className="flex items-center gap-2.5">
        <JarvisGraphOrb state={orbState} size={20} />
        <span className="text-xs font-semibold uppercase tracking-[.22em] text-text-hi">
          Jarvis
        </span>
      </div>

      <section>
        <h2 className="mb-3 font-mono text-[10.5px] tracking-[.14em] text-text-low">
          SERVICIOS
        </h2>
        <ul className="flex flex-col gap-0.5">
          {SERVICE_SCOPES.map((scope) => (
            <li
              key={scope.id}
              className="flex items-center justify-between rounded-[9px] px-2.5 py-2 hover:bg-raised"
            >
              <span className="text-[13px] text-text-mid">{scope.name}</span>
              <span
                className={
                  googleConnected
                    ? 'h-1.5 w-1.5 rounded-full bg-ok'
                    : 'h-1.5 w-1.5 rounded-full bg-overlay'
                }
              />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 font-mono text-[10.5px] tracking-[.14em] text-text-low">
          VOZ
        </h2>
        <VoiceSelector
          value={voice}
          onChange={onVoiceChange}
          compact
          disabled={voiceDisabled}
        />
        {voiceDisabled ? (
          <p className="mt-2 text-[11px] text-text-low">
            La voz se aplica al iniciar la siguiente llamada.
          </p>
        ) : null}
      </section>

      <footer className="mt-auto flex flex-col gap-2.5 text-xs text-text-low">
        <p className="flex justify-between">
          <span>Latencia</span>
          <span
            className={
              latencyMs == null
                ? 'font-mono text-text-mid'
                : latencyMs < 300
                  ? 'font-mono text-ok'
                  : 'font-mono text-danger-soft'
            }
          >
            {latencyMs == null ? '—' : `${latencyMs} ms`}
          </span>
        </p>
        <p className="flex justify-between">
          <span>Sesión</span>
          <span className="font-mono text-text-mid">{elapsed}</span>
        </p>
        <p className="mt-1 flex items-center gap-2.5 rounded-[10px] border border-border bg-raised px-3 py-2.5">
          <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-overlay text-[11px] font-semibold text-text-mid">
            {initials}
          </span>
          <span className="truncate text-xs text-text-mid">{displayEmail}</span>
        </p>
      </footer>
    </aside>
  );
}

function Transcript({
  turns,
  statusLabel,
  error,
}: {
  turns: SessionTurn[];
  statusLabel: string;
  error: string | null;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [turns]);

  return (
    <div
      ref={scrollerRef}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      aria-live="polite"
      aria-relevant="additions text"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-8 sm:px-10 lg:px-14 lg:pt-11">
        <span className="sticky top-0 z-10 flex items-center gap-2.5 self-center rounded-full border border-accent-500/25 bg-bg/90 px-3.5 py-1.5 backdrop-blur-sm">
          <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-accent-500 motion-reduce:animate-none" />
          <span className="font-mono text-[11px] tracking-[.12em] text-accent-400">
            {statusLabel}
          </span>
        </span>

        {turns.length === 0 ? (
          <p className="self-center text-center text-sm text-text-low">
            Habla con Jarvis o escribe un mensaje con contexto extra.
          </p>
        ) : null}

        {turns.map((turn) =>
          turn.role === 'user' ? (
            <p
              key={turn.id}
              className="max-w-[74%] self-end rounded-2xl rounded-br-sm border border-border bg-overlay px-[18px] py-3.5 text-[14.5px] leading-relaxed text-text-hi"
            >
              {turn.text}
              {turn.partial ? (
                <span className="ml-1 text-accent-400">▌</span>
              ) : null}
            </p>
          ) : (
            <div
              key={turn.id}
              className="flex max-w-[78%] flex-col gap-2.5 self-start"
            >
              <p className="rounded-2xl rounded-bl-sm border border-accent-500/20 bg-[#0D1622] px-[18px] py-3.5 text-[14.5px] leading-relaxed text-text-hi">
                {turn.text}
              </p>
              {turn.suggestions ? (
                <div className="flex flex-wrap gap-2">
                  {turn.suggestions.map((suggestion) => (
                    <span
                      key={suggestion}
                      className="rounded-full border border-border bg-raised px-3.5 py-1.5 text-xs text-text-mid"
                    >
                      {suggestion}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ),
        )}

        {error ? (
          <Alert tone="danger" label="CONEXIÓN PERDIDA">
            {error}
          </Alert>
        ) : null}

        <div ref={endRef} className="h-2 shrink-0" />
      </div>
    </div>
  );
}

function SessionFooter({
  state,
  muted,
  onMute,
  onHangUp,
  draft,
  onDraftChange,
  onSend,
  canSend,
}: {
  state: OrbState;
  muted: boolean;
  onMute: () => void;
  onHangUp: () => void;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  canSend: boolean;
}) {
  return (
    <div className="shrink-0 border-t border-border/50 bg-bg/85 px-5 pb-5 pt-4 backdrop-blur-md sm:px-10 sm:pb-7 lg:px-14">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3.5">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSend();
          }}
          className="w-full"
        >
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-raised px-3 py-2.5 focus-within:border-accent-500/40">
            <textarea
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
              rows={1}
              disabled={!canSend}
              placeholder="Escribe contexto o un mensaje para Jarvis…"
              className="max-h-28 min-h-[40px] flex-1 resize-none bg-transparent px-1 py-2 text-[14px] text-text-hi outline-none placeholder:text-text-low disabled:opacity-55"
            />
            <button
              type="submit"
              disabled={!canSend || !draft.trim()}
              className="shrink-0 rounded-xl border border-accent-500/35 bg-accent-wash px-3.5 py-2 text-[12.5px] font-medium text-accent-400 disabled:opacity-45"
            >
              Enviar
            </button>
          </div>
        </form>

        <JarvisGraphOrb
          state={state}
          size={96}
          onToggle={onHangUp}
          label="Finalizar llamada"
        />

        <div className="flex items-center gap-3 sm:gap-4">
          <button
            type="button"
            onClick={onMute}
            aria-pressed={muted}
            className="rounded-[9px] border border-border bg-raised px-3.5 py-2 text-[12.5px] text-text-mid hover:border-accent-500/35 hover:text-text-hi"
          >
            {muted ? 'Reactivar micrófono' : 'Silenciar'}
          </button>
          <button
            type="button"
            onClick={onHangUp}
            className="rounded-[9px] border border-danger/30 bg-danger/[.08] px-3.5 py-2 text-[12.5px] text-danger-soft hover:bg-danger/[.14]"
          >
            Finalizar llamada
          </button>
        </div>
      </div>
    </div>
  );
}
