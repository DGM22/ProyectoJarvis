import { isLikelyHallucination } from './transcript-filter';

describe('isLikelyHallucination', () => {
  it.each([
    '',
    'Un saludo.',
    'un saludo y hasta la próxima.',
    '¡Muchas gracias!',
    'Muchísimas gracias.',
    'Gracias.',
    'y satisfactoria. Nos vemos, gracias.',
    'Suscríbete al canal',
    'El',
  ])('drops noise transcript %p', (text) => {
    expect(isLikelyHallucination(text)).toBe(true);
  });

  it.each([
    'Vengo con Daniel Garza.',
    'Traigo un paquete de Amazon',
    'Gracias, ¿dónde lo dejo?',
    '¿Está Daniel?',
  ])('keeps real visitor speech %p', (text) => {
    expect(isLikelyHallucination(text)).toBe(false);
  });
});
