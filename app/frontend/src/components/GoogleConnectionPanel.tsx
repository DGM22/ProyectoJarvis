import { cn } from '@/lib/utils';

export type Scope = {
  id: 'calendar' | 'gmail' | 'tasks' | 'drive';
  name: string;
  description: string;
  granted: boolean;
};

export function GoogleConnectionPanel({
  email,
  connected,
  scopes,
  disabled = false,
  onConnect,
  onGrant,
  onDisconnect,
}: {
  email: string | null;
  connected: boolean;
  scopes: Scope[];
  disabled?: boolean;
  onConnect: () => void;
  onGrant: (id: Scope['id']) => void;
  onDisconnect: () => void;
}) {
  return (
    <section className="w-[min(520px,100%)] rounded-card border border-border bg-raised shadow-glow-inset">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-[9px] border border-border bg-overlay text-sm font-semibold text-text-mid">
            G
          </span>
          <div>
            <p className="text-sm font-semibold text-text-hi">Cuenta de Google</p>
            <p className="mt-0.5 text-xs text-text-low">
              {connected && email ? email : 'Sin cuenta conectada'}
            </p>
          </div>
        </div>
        {connected ? (
          <span className="flex items-center gap-2 rounded-full border border-ok/30 bg-ok/10 px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_8px_rgba(95,211,166,.8)]" />
            <span className="font-mono text-[11px] tracking-wider text-ok">
              CONECTADO
            </span>
          </span>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={onConnect}
            className="rounded-full border border-accent-400 bg-accent-wash px-3 py-1.5 font-mono text-[11px] tracking-wider text-accent-400 disabled:opacity-55"
          >
            CONECTAR
          </button>
        )}
      </header>

      <ul>
        {scopes.map((scope, index) => (
          <li
            key={scope.id}
            className={cn(
              'flex items-center justify-between px-6 py-4',
              index < scopes.length - 1 && 'border-b border-border',
            )}
          >
            <div>
              <p className="text-[13.5px] text-text-hi">{scope.name}</p>
              <p className="mt-0.5 text-xs text-text-low">{scope.description}</p>
            </div>
            {scope.granted ? (
              <span className="font-mono text-[11px] text-ok">Activo</span>
            ) : (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onGrant(scope.id)}
                className="rounded-md border border-accent-500/35 px-3 py-1.5 font-mono text-[11px] text-accent-500 hover:bg-accent-wash disabled:opacity-55"
              >
                Dar permiso
              </button>
            )}
          </li>
        ))}
      </ul>

      <footer className="flex items-center justify-between gap-3 px-6 py-4">
        <p className="text-xs text-text-low">
          Jarvis nunca borra nada sin confirmación por voz.
        </p>
        {connected ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onDisconnect}
            className="shrink-0 text-xs text-text-mid underline underline-offset-2 hover:text-text-hi disabled:opacity-55"
          >
            Desconectar
          </button>
        ) : null}
      </footer>
    </section>
  );
}
