import { useCallback, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Menu, X, Home, Settings, Bot, FileAudio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { JarvisGraphOrb, type OrbState } from '@/components/JarvisGraphOrb';
import { useVoiceSession } from '@/providers/VoiceSessionProvider';
import type { VoiceChatStatus } from '@/types/realtime';

const NAV_ITEMS = [
  { to: '/', label: 'Inicio', icon: Home },
  { to: '/agents', label: 'Agentes', icon: Bot },
  { to: '/transcripciones', label: 'Transcripciones', icon: FileAudio },
  { to: '/config', label: 'Configuración', icon: Settings },
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

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { status, muted } = useVoiceSession();
  const orbState = toHeaderOrbState(status, muted);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    close();
  }, [location.pathname, close]);

  return (
    <div className="md:hidden">
      <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4">
        <div className="flex items-center gap-2.5">
          <JarvisGraphOrb state={orbState} size={28} />
          <span className="font-mono text-mono uppercase text-accent-400 tracking-widest">
            Proyecto Jarvis
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="rounded-lg p-2 text-text-mid hover:bg-raised hover:text-text-hi transition-colors"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-bg/60 backdrop-blur-sm"
            onClick={close}
            onKeyDown={(e) => e.key === 'Escape' && close()}
            role="button"
            tabIndex={-1}
            aria-label="Cerrar menú"
          />
          <nav className="fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-surface p-4 pt-16 space-y-1 animate-in slide-in-from-left">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={close}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-body transition-colors',
                    isActive
                      ? 'bg-accent-wash text-accent-400'
                      : 'text-text-mid hover:bg-raised hover:text-text-hi',
                  )
                }
              >
                <Icon size={18} />
                {label}
              </NavLink>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}
