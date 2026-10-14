/** Stopwords en español usadas para overlap de tokens de contenido. */
export const SPANISH_STOPWORDS = new Set([
  'a',
  'al',
  'algo',
  'algunas',
  'algunos',
  'ante',
  'antes',
  'como',
  'con',
  'contra',
  'cual',
  'cuando',
  'de',
  'del',
  'desde',
  'donde',
  'durante',
  'e',
  'el',
  'ella',
  'ellas',
  'ellos',
  'en',
  'entre',
  'era',
  'erais',
  'eran',
  'eras',
  'eres',
  'es',
  'esa',
  'esas',
  'ese',
  'eso',
  'esos',
  'esta',
  'estaba',
  'estado',
  'estais',
  'estamos',
  'estan',
  'estar',
  'estas',
  'este',
  'esto',
  'estos',
  'estoy',
  'etc',
  'fue',
  'fueron',
  'fui',
  'ha',
  'habeis',
  'haber',
  'habia',
  'han',
  'has',
  'hasta',
  'hay',
  'he',
  'la',
  'las',
  'le',
  'les',
  'lo',
  'los',
  'mas',
  'me',
  'mi',
  'mia',
  'mias',
  'mio',
  'mios',
  'mis',
  'mucho',
  'muchos',
  'muy',
  'nada',
  'ni',
  'no',
  'nos',
  'nosotras',
  'nosotros',
  'nuestra',
  'nuestras',
  'nuestro',
  'nuestros',
  'o',
  'os',
  'otra',
  'otras',
  'otro',
  'otros',
  'para',
  'pero',
  'poco',
  'por',
  'porque',
  'que',
  'quien',
  'quienes',
  'se',
  'sea',
  'sean',
  'segun',
  'ser',
  'si',
  'sido',
  'sin',
  'sobre',
  'sois',
  'somos',
  'son',
  'soy',
  'su',
  'sus',
  'tambien',
  'tanto',
  'te',
  'tiene',
  'tienen',
  'todo',
  'todos',
  'tu',
  'tus',
  'un',
  'una',
  'uno',
  'unos',
  'vosotras',
  'vosotros',
  'vuestra',
  'vuestras',
  'vuestro',
  'vuestros',
  'y',
  'ya',
  'yo',
]);

/** Quita acentos para normalización de slugs y tokens. */
export function stripAccents(input: string): string {
  return input.normalize('NFD').replace(/\p{M}/gu, '');
}

/**
 * Normaliza un subject libre a slug estable (`snake_case` sin acentos).
 *
 * @param subject Texto libre proveniente de Jarvis o del extractor.
 */
export function toSubjectSlug(subject: string): string {
  return stripAccents(subject)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

/** Normaliza texto canónico para igualdad exacta (sin depender del coseno). */
export function normalizeCanonicalText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Tokeniza en palabras de contenido (sin stopwords ni puntuación). */
export function contentTokens(text: string): Set<string> {
  const tokens = stripAccents(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !SPANISH_STOPWORDS.has(t));
  return new Set(tokens);
}

/**
 * Jaccard sobre palabras de contenido (stopwords ya filtradas).
 *
 * @returns Valor en [0, 1]. Si ambos conjuntos están vacíos, retorna 1.
 */
export function contentTokenOverlap(a: string, b: string): number {
  const setA = contentTokens(a);
  const setB = contentTokens(b);
  if (setA.size === 0 && setB.size === 0) {
    return 1;
  }
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Compara dos valores JSONB de forma estable.
 *
 * @returns `equal` | `different` | `incomparable`
 */
export function compareJsonValues(
  a: unknown,
  b: unknown,
): 'equal' | 'different' | 'incomparable' {
  if (a === null || a === undefined || b === null || b === undefined) {
    return 'incomparable';
  }
  if (typeof a === 'object' && typeof b === 'object') {
    try {
      const sa = JSON.stringify(sortKeys(a));
      const sb = JSON.stringify(sortKeys(b));
      return sa === sb ? 'equal' : 'different';
    } catch {
      return 'incomparable';
    }
  }
  if (typeof a !== typeof b) {
    return 'incomparable';
  }
  return a === b ? 'equal' : 'different';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([ka], [kb]) => ka.localeCompare(kb),
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

/** Formatea un vector numérico para el literal de pgvector. */
export function toPgVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
