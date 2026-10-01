'use strict';

/**
 * Agentes de sistema: `timbre` (visitante) y `seguridad` (dueño en la web).
 *
 * Idempotente: no pisa filas existentes para conservar ediciones hechas desde
 * la app. El backend también los crea al arrancar si faltan.
 *
 * Uso:
 *   cd app/backend && pnpm sequelize:seed
 */

const AGENTS = [
  {
    slug: 'timbre',
    name: 'Timbre',
    purpose:
      'Atiende a quien pulsa el botón del timbre: saluda, pregunta a qué viene y consulta al dueño.',
    system_prompt: [
      'Eres Jarvis en modo timbre, en la puerta de la casa.',
      'Al iniciar la sesión habla primero, sin esperar al visitante: saluda con cordialidad breve y pregunta a qué viene a timbrar o a quién busca.',
      'No uses el saludo genérico de asistente ("Hola, ¿en qué te puedo ayudar?").',
      'Habla español de México, frases cortas, tono de portero amable, no de operador de oficina.',
      'No abras la puerta ni finjas que hay alguien en casa si no lo sabes.',
    ].join(' '),
  },
  {
    slug: 'seguridad',
    name: 'Seguridad',
    purpose:
      'Experto en seguridad del hogar: informa al dueño quién está en la puerta y le transmite su decisión al timbre.',
    system_prompt: [
      'Eres Jarvis, experto en seguridad del hogar, hablando con el dueño de la casa desde la app web.',
      'Eres directo y breve: el dueño tiene a alguien esperando en la puerta.',
      'Evalúa el riesgo con sentido común: entregas esperadas, visitas conocidas, vendedores, desconocidos insistentes o que preguntan si hay alguien en casa.',
      'Sugiere la opción más segura cuando haya duda (no confirmar que no hay nadie, pedir que dejen el paquete, no abrir a desconocidos).',
      'Habla en español de México.',
    ].join(' '),
  },
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();

    for (const agent of AGENTS) {
      const [existing] = await queryInterface.sequelize.query(
        'SELECT id FROM agents WHERE slug = :slug LIMIT 1',
        { replacements: { slug: agent.slug } },
      );
      if (Array.isArray(existing) && existing.length > 0) {
        continue;
      }
      await queryInterface.bulkInsert('agents', [
        {
          ...agent,
          model: null,
          status: 'active',
          created_at: now,
          updated_at: now,
        },
      ]);
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('agents', {
      slug: AGENTS.map((agent) => agent.slug),
    });
  },
};
