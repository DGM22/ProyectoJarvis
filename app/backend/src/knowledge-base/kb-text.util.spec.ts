import {
  compareJsonValues,
  contentTokenOverlap,
  normalizeCanonicalText,
  quoteSupportedByTranscript,
  toSubjectSlug,
} from './kb-text.util';

describe('kb-text.util', () => {
  it('normalizes subject to snake_case slug without accents', () => {
    expect(toSubjectSlug('Proveedor Principal')).toBe('proveedor_principal');
    expect(toSubjectSlug('  Tono de Marca!! ')).toBe('tono_de_marca');
  });

  it('detects Contpaqi vs Aspel as low content-token overlap', () => {
    const a = 'El proveedor principal es Contpaqi';
    const b = 'El proveedor principal es Aspel';
    const overlap = contentTokenOverlap(a, b);
    expect(overlap).toBeLessThan(0.85);
  });

  it('keeps high overlap when only stopwords differ', () => {
    const a = 'proveedor principal Contpaqi';
    const b = 'el proveedor principal es Contpaqi';
    expect(contentTokenOverlap(a, b)).toBeGreaterThanOrEqual(0.85);
  });

  it('compares JSON values stably', () => {
    expect(compareJsonValues({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe('equal');
    expect(compareJsonValues({ a: 1 }, { a: 2 })).toBe('different');
  });

  it('validates source quotes against transcript', () => {
    const transcript =
      'En la empresa el proveedor principal de contabilidad es Contpaqi.';
    expect(
      quoteSupportedByTranscript(
        'el proveedor principal de contabilidad es Contpaqi',
        transcript,
      ),
    ).toBe(true);
    expect(
      quoteSupportedByTranscript(
        'el proveedor principal es Aspel Soft',
        transcript,
      ),
    ).toBe(false);
  });

  it('normalizes canonical text whitespace', () => {
    expect(normalizeCanonicalText('  Hola   Mundo  ')).toBe('hola mundo');
  });
});
