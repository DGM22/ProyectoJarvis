import { NavLink } from 'react-router-dom';
import { Home, Settings, Bot, FileAudio } from 'lucide-react';
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

function toSidebarOrbState(status: VoiceChatStatus, muted: boolean): OrbState {
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

export function Sidebar() {
  const { status, muted } = useVoiceSession();
  const orbState = toSidebarOrbState(status, muted);

  return (
    <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 border-r border-border bg-surface">
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-5">
        <JarvisGraphOrb state={orbState} size={28} />
        <span className="font-mono text-mono uppercase text-accent-400 tracking-widest">
          Proyecto Jarvis
        </span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
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
    </aside>
  );
}
