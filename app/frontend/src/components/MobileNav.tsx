import { NavLink } from 'react-router-dom';
import { Home, Settings, Bot, LogOut, DoorOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { JarvisGraphOrb, type OrbState } from '@/components/JarvisGraphOrb';
import { useAuth, useCurrentUser } from '@/providers/AuthProvider';
import { useVoiceSession } from '@/providers/VoiceSessionProvider';
import type { VoiceChatStatus } from '@/types/realtime';

const NAV_ITEMS = [
  { to: '/', label: 'Inicio', icon: Home },
  { to: '/visits', label: 'Visitas', icon: DoorOpen },
  { to: '/agents', label: 'Agentes', icon: Bot },
  { to: '/config', label: 'Ajustes', icon: Settings },
] as const;

function toHeaderOrbState(status: VoiceChatStatus, muted: boolean): OrbState {
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

/**
 * Navegación del celular: cabecera delgada arriba (marca + cerrar sesión) y
 * barra de pestañas fija abajo, al alcance del pulgar. En escritorio la
 * navegación vive en `Sidebar`.
 */
export function MobileNav() {
  const { status, muted, stop } = useVoiceSession();
  const orbState = toHeaderOrbState(status, muted);
  const user = useCurrentUser();
  const { logout } = useAuth();

  return (
    <div className="md:hidden">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="flex items-center gap-2.5">
          <JarvisGraphOrb state={orbState} size={28} />
          <span className="font-mono text-mono uppercase text-accent-400 tracking-widest">
            Proyecto Jarvis
          </span>
        </div>
        {user && (
          <button
            type="button"
            onClick={() => {
              stop();
              void logout();
            }}
            aria-label={`Cerrar sesión de @${user.username}`}
            title={`Cerrar sesión (@${user.username})`}
            className="rounded-lg p-2 text-text-low transition-colors hover:bg-raised hover:text-danger-soft"
          >
            <LogOut size={18} />
          </button>
        )}
      </header>

      <nav
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
                isActive ? 'text-accent-400' : 'text-text-low active:text-text-hi',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                    isActive && 'bg-accent-wash',
                  )}
                >
                  <Icon size={20} strokeWidth={isActive ? 2.25 : 1.75} />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
