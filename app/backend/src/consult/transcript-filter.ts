/**
 * Frases que Whisper "alucina" con ruido o silencio (aprendidas de subtítulos
 * de video). Medido en la puerta: con el mic en espera salían "Un saludo y
 * hasta la próxima", "Muchas gracias", "Muchísimas gracias"… sin que nadie
 * hablara.
 */
const HALLUCINATION_PATTERNS: readonly RegExp[] = [
  /^(muchas|muchísimas|mil)?\s*gracias( a todos)?( por ver(nos)?| por su atención)?$/,
  /^(un )?saludo(s)?( y hasta (la próxima|luego))?$/,
  /^hasta (la próxima|luego|pronto)$/,
  /^nos vemos( en el próximo video)?(,? gracias)?$/,
  /suscr[íi]be(te)?|subt[íi]tulos|amara\.org|dale like/,
  /^(y )?satisfactoria\b/,
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[¡!¿?.,;:"'…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * true si la transcripción del visitante probablemente es ruido y no voz real:
 * vacía, de una sola palabra corta o una alucinación conocida de Whisper.
 */
export function isLikelyHallucination(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return true;
  }
  const words = normalized.split(' ');
  if (words.length === 1 && normalized.length <= 4) {
    return true;
  }
  return HALLUCINATION_PATTERNS.some((pattern) => pattern.test(normalized));
}
