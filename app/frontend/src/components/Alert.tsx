import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'danger' | 'info';

export function Alert({
  tone = 'danger',
  label,
  children,
  action,
}: {
  tone?: Tone;
  label: string;
  children: ReactNode;
  action?: { text: string; onClick: () => void };
}) {
  const danger = tone === 'danger';

  return (
    <div
      role={danger ? 'alert' : 'status'}
      className={cn(
        'w-[min(520px,100%)] rounded-xl border p-4',
        danger
          ? 'border-danger/30 bg-danger/[.08]'
          : 'border-accent-500/28 bg-accent-500/[.07]',
      )}
    >
      <p className="mb-2 flex items-center gap-2">
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            danger ? 'bg-danger' : 'bg-accent-500',
          )}
        />
        <span
          className={cn(
            'font-mono text-[11px] tracking-[.12em]',
            danger ? 'text-danger-soft' : 'text-accent-400',
          )}
        >
          {label}
        </span>
      </p>
      <p className="text-[13px] leading-relaxed text-text-mid">{children}</p>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className={cn(
            'mt-3 rounded-lg border px-3 py-1.5 text-xs',
            danger
              ? 'border-danger/35 text-danger-soft hover:bg-danger/10'
              : 'border-accent-500/35 text-accent-400 hover:bg-accent-wash',
          )}
        >
          {action.text}
        </button>
      ) : null}
    </div>
  );
}
