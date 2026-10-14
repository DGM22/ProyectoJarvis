import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface DoorbellSlotContextValue {
  /** Elemento de la página inicial donde se dibuja la llamada en escritorio. */
  slot: HTMLElement | null;
  setSlot: (slot: HTMLElement | null) => void;
  /** Hay una llamada del timbre dibujándose dentro de la página. */
  inlineCall: boolean;
  setInlineCall: (active: boolean) => void;
}

const DoorbellSlotContext = createContext<DoorbellSlotContextValue | null>(null);

/**
 * Conecta la llamada del timbre (un solo componente global, con un solo socket
 * de cámara/interfón) con el lugar de la página inicial donde se muestra en
 * escritorio. En el celular la llamada va a pantalla completa y no usa el hueco.
 */
export function DoorbellSlotProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [inlineCall, setInlineCall] = useState(false);
  const value = useMemo(() => ({ slot, setSlot, inlineCall, setInlineCall }), [slot, inlineCall]);
  return <DoorbellSlotContext.Provider value={value}>{children}</DoorbellSlotContext.Provider>;
}

export function useDoorbellSlot(): DoorbellSlotContextValue {
  const context = useContext(DoorbellSlotContext);
  if (!context) {
    throw new Error('useDoorbellSlot must be used inside DoorbellSlotProvider');
  }
  return context;
}

/** El hueco: se pone en la página inicial, arriba de todo. */
export function DoorbellInlineSlot({ className }: { className?: string }) {
  const { setSlot } = useDoorbellSlot();
  const ref = useCallback((node: HTMLDivElement | null) => setSlot(node), [setSlot]);
  useEffect(() => () => setSlot(null), [setSlot]);
  return <div ref={ref} className={className} />;
}

/** Escritorio = mismo corte que el sidebar (`md`). */
export function useIsDesktop(): boolean {
  const query = '(min-width: 768px)';
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return matches;
}
