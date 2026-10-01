import { cn } from '@/lib/utils';
import { VOICES, type VoiceId } from '@/constants/voices';

export function VoiceSelector({
  value,
  disabled = false,
  compact = false,
  onChange,
}: {
  value: VoiceId;
  disabled?: boolean;
  /** Lista compacta para la sidebar de sesión. */
  compact?: boolean;
  onChange: (voice: VoiceId) => void;
}) {
  if (compact) {
    return (
      <div
        role="listbox"
        aria-label="Voz del asistente"
        className="flex flex-col gap-0.5"
      >
        {VOICES.map((voice) => {
          const selected = voice.id === value;
          return (
            <button
              key={voice.id}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={disabled}
              onClick={() => onChange(voice.id)}
              className={cn(
                'flex items-center justify-between rounded-[9px] px-2.5 py-2 text-left transition-colors disabled:opacity-55',
                selected
                  ? 'bg-accent-wash text-accent-400'
                  : 'text-text-mid hover:bg-raised hover:text-text-hi',
              )}
            >
              <span className="text-[13px]">{voice.name}</span>
              {selected ? (
                <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Voz del asistente"
      className="grid w-[min(520px,100%)] grid-cols-2 gap-3"
    >
      {VOICES.map((voice) => {
        const selected = voice.id === value;
        return (
          <button
            key={voice.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(voice.id)}
            className={cn(
              'rounded-2xl bg-raised p-4 text-left transition-colors disabled:opacity-65',
              selected
                ? 'border-[1.5px] border-accent-500 shadow-glow'
                : 'border border-border hover:border-accent-400/40',
            )}
          >
            <span className="flex items-center justify-between">
              <span
                className={cn(
                  'text-sm font-semibold',
                  selected ? 'text-text-hi' : 'text-text-mid',
                )}
              >
                {voice.name}
              </span>
              <span
                className={cn(
                  'grid h-4 w-4 place-items-center rounded-full',
                  selected ? 'bg-accent-500' : 'border border-border',
                )}
                aria-hidden="true"
              >
                {selected ? (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path
                      d="M2 5.2 4.1 7.2 8 2.8"
                      stroke="#07090F"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
              </span>
            </span>
            <span className="mt-1 block text-xs text-text-low">{voice.hint}</span>
            {selected ? (
              <span
                className="mt-3 flex h-4 items-end gap-0.5"
                aria-hidden="true"
              >
                {[0.45, 0.8, 0.55, 1, 0.65].map((scale, index) => (
                  <span
                    key={index}
                    className="w-[3px] rounded-sm bg-accent-500"
                    style={{ height: `${scale * 100}%` }}
                  />
                ))}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
