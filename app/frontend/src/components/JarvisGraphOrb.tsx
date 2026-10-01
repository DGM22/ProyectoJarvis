import { useEffect, useMemo, useRef } from 'react';

export type OrbState = 'idle' | 'ready' | 'connecting' | 'listening' | 'speaking';

type Conf = {
  spin: number;
  amp: number;
  node: string;
  edge: string;
  edgeOpacity: number;
  ring: string;
  halo: number;
  nodeSize: number;
};

const CONF: Record<OrbState, Conf> = {
  idle: {
    spin: 0.1,
    amp: 0.0,
    node: '#3A4A66',
    edge: '#2A3547',
    edgeOpacity: 0.55,
    ring: 'rgba(58,74,102,.35)',
    halo: 0,
    nodeSize: 0.02,
  },
  ready: {
    spin: 0.16,
    amp: 0.02,
    node: '#2F8FA6',
    edge: '#1E4A5A',
    edgeOpacity: 0.7,
    ring: 'rgba(23,195,224,.18)',
    halo: 0.14,
    nodeSize: 0.021,
  },
  connecting: {
    spin: 0.55,
    amp: 0.03,
    node: '#17C3E0',
    edge: '#15505F',
    edgeOpacity: 0.75,
    ring: 'rgba(23,195,224,.22)',
    halo: 0.12,
    nodeSize: 0.021,
  },
  listening: {
    spin: 0.34,
    amp: 0.06,
    node: '#3EDCF2',
    edge: '#17C3E0',
    edgeOpacity: 0.5,
    ring: 'rgba(62,220,242,.30)',
    halo: 0.24,
    nodeSize: 0.024,
  },
  speaking: {
    spin: 0.5,
    amp: 0.17,
    node: '#7DEBFA',
    edge: '#3EDCF2',
    edgeOpacity: 0.62,
    ring: 'rgba(62,220,242,.35)',
    halo: 0.32,
    nodeSize: 0.026,
  },
};

const NODES = 30;
const NEIGHBOURS = 4;
const TILT = 0.38;

type Vec3 = [number, number, number];
type Projected = [number, number, number];

/** Nodos repartidos por la esfera (Fibonacci) + arista a los k vecinos más cercanos. */
function buildGraph(n = NODES, k = NEIGHBOURS) {
  const pts: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    pts.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }

  const seen = new Set<string>();
  const edges: [number, number][] = [];
  pts.forEach(([ax, ay, az], i) => {
    pts
      .map((p, j) => [j, Math.hypot(ax - p[0], ay - p[1], az - p[2])] as const)
      .filter(([j]) => j !== i)
      .sort((a, b) => a[1] - b[1])
      .slice(0, k)
      .forEach(([j]) => {
        const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
        if (seen.has(key)) return;
        seen.add(key);
        edges.push([Math.min(i, j), Math.max(i, j)]);
      });
  });
  return { pts, edges };
}

/** Proyecta la esfera en el instante t (rotación en Y + inclinación fija). */
function project(
  pts: Vec3[],
  t: number,
  spin: number,
  amp: number,
  C: number,
  R: number,
): Projected[] {
  const ct = Math.cos(TILT);
  const st = Math.sin(TILT);
  const a = t * spin;
  const ca = Math.cos(a);
  const sa = Math.sin(a);

  return pts.map(([px, py, pz], i) => {
    const k = 1 + amp * Math.sin(t * 3.2 + i * 1.7);
    const x = px * k;
    const y = py * k;
    const z = pz * k;
    const x1 = x * ca + z * sa;
    const z1 = z * ca - x * sa;
    const y1 = y * ct - z1 * st;
    const z2 = y * st + z1 * ct;
    return [C + x1 * R, C + y1 * R, (z2 + 1) / 2];
  });
}

export function JarvisGraphOrb({
  state,
  size = 128,
  activity = 0,
  onToggle,
  label,
}: {
  state: OrbState;
  size?: number;
  /** 0..1 — nivel real del audio; amplifica el movimiento de los nodos */
  activity?: number;
  onToggle?: () => void;
  label?: string;
}) {
  const { pts, edges } = useMemo(() => buildGraph(), []);
  const nodeEls = useRef<(SVGCircleElement | null)[]>([]);
  const edgeEls = useRef<(SVGLineElement | null)[]>([]);
  const activityRef = useRef(activity);
  activityRef.current = activity;

  const conf = CONF[state];
  const hot = state === 'listening' || state === 'speaking';
  const C = size / 2;
  const R = size * 0.4;

  const seed = useMemo(
    () => project(pts, 0, conf.spin, conf.amp, C, R),
    [pts, conf, C, R],
  );
  const nodeRadius = (depth: number) =>
    size * conf.nodeSize * (0.62 + 0.6 * depth);
  const edgeOpacity = (a: number, b: number) =>
    conf.edgeOpacity * (0.18 + 0.82 * ((a + b) / 2));

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;

    const frame = (now: number) => {
      const t = now / 1000;
      const amp = conf.amp * (1 + activityRef.current * 1.6);
      const proj = project(pts, t, conf.spin, amp, C, R);

      proj.forEach(([x, y, depth], i) => {
        const el = nodeEls.current[i];
        if (!el) return;
        el.setAttribute('cx', x.toFixed(2));
        el.setAttribute('cy', y.toFixed(2));
        el.setAttribute('r', nodeRadius(depth).toFixed(2));
        let op = 0.3 + 0.7 * depth;
        if (state === 'connecting') {
          op *= 0.3 + 0.7 * (Math.sin(t * 4 - i * 0.5) * 0.5 + 0.5);
        }
        el.setAttribute('opacity', op.toFixed(3));
      });

      edges.forEach(([i, j], e) => {
        const el = edgeEls.current[e];
        if (!el) return;
        el.setAttribute('x1', proj[i][0].toFixed(2));
        el.setAttribute('y1', proj[i][1].toFixed(2));
        el.setAttribute('x2', proj[j][0].toFixed(2));
        el.setAttribute('y2', proj[j][1].toFixed(2));
        el.setAttribute(
          'opacity',
          edgeOpacity(proj[i][2], proj[j][2]).toFixed(3),
        );
      });

      if (!reduce) raf = requestAnimationFrame(frame);
    };

    frame(performance.now());
    return () => cancelAnimationFrame(raf);
  }, [pts, edges, conf, size, state, C, R]);

  const interactive = Boolean(onToggle);

  const content = (
    <>
      {conf.halo > 0 && (
        <span
          className="pointer-events-none absolute rounded-full animate-breathe motion-reduce:animate-none"
          style={{
            width: size * 1.32,
            height: size * 1.32,
            background: `radial-gradient(circle,rgba(23,195,224,${conf.halo}),transparent 66%)`,
          }}
          aria-hidden="true"
        />
      )}

      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="relative overflow-visible"
        aria-hidden={!interactive}
      >
        <circle
          cx={C}
          cy={C}
          r={R * 1.06}
          fill="none"
          stroke={conf.ring}
          strokeWidth={1}
        />
        {hot && (
          <circle cx={C} cy={C} r={R * 0.55} fill="rgba(23,195,224,.10)" />
        )}

        {edges.map(([i, j], e) => (
          <line
            key={`${i}-${j}`}
            ref={(el) => {
              edgeEls.current[e] = el;
            }}
            x1={seed[i][0]}
            y1={seed[i][1]}
            x2={seed[j][0]}
            y2={seed[j][1]}
            opacity={edgeOpacity(seed[i][2], seed[j][2])}
            stroke={conf.edge}
            strokeWidth={hot ? 1 : 0.8}
            strokeLinecap="round"
          />
        ))}

        {pts.map((_, i) => (
          <circle
            key={i}
            ref={(el) => {
              nodeEls.current[i] = el;
            }}
            cx={seed[i][0]}
            cy={seed[i][1]}
            r={nodeRadius(seed[i][2])}
            opacity={0.3 + 0.7 * seed[i][2]}
            fill={conf.node}
            style={
              hot
                ? { filter: 'drop-shadow(0 0 4px rgba(62,220,242,.85))' }
                : undefined
            }
          />
        ))}
      </svg>
    </>
  );

  if (!interactive) {
    return (
      <div
        className="relative grid place-items-center"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label ?? state}
      aria-pressed={hot}
      className="relative grid place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-4 focus-visible:ring-offset-bg"
      style={{ width: size, height: size }}
    >
      {content}
    </button>
  );
}
