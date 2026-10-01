/**
 * Se muestra SIEMPRE antes de borrar eventos, correos o archivos.
 * Acepta confirmación por voz ("sí, elimínalo") o por clic.
 */
export function DestructiveConfirm({
  title,
  target,
  meta,
  onConfirm,
  onCancel,
}: {
  title: string;
  target: string;
  meta: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      className="w-full max-w-[480px] rounded-2xl border border-danger/30 bg-surface p-5"
    >
      <p className="mb-3 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-danger" />
        <span className="font-mono text-[11px] tracking-[.12em] text-danger-soft">
          CONFIRMACIÓN REQUERIDA
        </span>
      </p>

      <p className="mb-3.5 text-[14.5px] leading-snug text-text-hi">
        {title} <strong className="font-semibold">{target}</strong>.
      </p>

      <div className="mb-4 rounded-xl border border-border bg-raised px-4 py-3">
        <p className="text-[13.5px] font-semibold text-text-hi">{target}</p>
        <p className="mt-1 text-xs text-text-low">{meta}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-lg bg-danger-soft px-4 py-2 text-[13px] font-semibold text-bg hover:brightness-110"
        >
          Sí, eliminar
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-4 py-2 text-[13px] text-text-mid hover:text-text-hi"
        >
          Cancelar
        </button>
        <span className="ml-1 text-xs text-text-low">o dilo en voz alta</span>
      </div>
    </div>
  );
}
