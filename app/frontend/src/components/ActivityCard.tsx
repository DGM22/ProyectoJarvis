import {
  Calendar,
  CheckSquare,
  Mail,
  FolderOpen,
  AlertCircle,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ActivityEntry } from '@/hooks/useActivityLog';

const SKILL_ICON: Record<string, typeof Calendar> = {
  'google-calendar': Calendar,
  'google-tasks': CheckSquare,
  'google-gmail': Mail,
  'google-drive': FolderOpen,
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'hace un momento';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

interface ActivityCardProps {
  entry: ActivityEntry;
}

export function ActivityCard({ entry }: ActivityCardProps) {
  const Icon = SKILL_ICON[entry.skillName] ?? Zap;
  const isError = entry.status === 'error';

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-colors',
        isError && 'border-danger/30',
      )}
    >
      <div
        className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          isError ? 'bg-danger/10 text-danger' : 'bg-accent-wash text-accent-400',
        )}
      >
        {isError ? <AlertCircle size={16} /> : <Icon size={16} />}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-body leading-snug text-text-hi">{entry.summary}</p>
        {isError && entry.errorMessage && (
          <p className="mt-0.5 text-mono text-danger-soft line-clamp-2">
            {entry.errorMessage}
          </p>
        )}
      </div>

      <span className="shrink-0 pt-0.5 text-mono text-text-low">
        {relativeTime(entry.createdAt)}
      </span>
    </div>
  );
}
