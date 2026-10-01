'use strict';

/**
 * Seed de identidad IQ-EST Academy (hechos pinned para el core context).
 *
 * Idempotente: reutiliza/crea la entidad, limpia hechos previos de estos
 * subject_slug y los reinserta. Genera embeddings reales vía OpenAI
 * (OPENAI_API_KEY + OPENAI_EMBEDDING_MODEL del .env).
 *
 * Uso:
 *   cd app/backend && pnpm sequelize:seed
 */

const path = require('path');
require('dotenv').config({
  path: path.resolve(__dirname, '../../../../.env'),
});

const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

const FACTS = [
  {
    fact_type: 'hecho',
    subject: 'identidad_empresa',
    subject_slug: 'identidad_empresa',
    canonical_text:
      'IQ-EST Academy es una academia en Monterrey enfocada en preparación para exámenes de admisión universitaria (PAA, PIENSE-II) a Tec de Monterrey, UDEM y escuelas afines, además de la línea IQ English.',
    value: {
      nombre: 'IQ-EST Academy',
      ubicacion: 'Monterrey, Nuevo León',
      lineas: ['preparación PAA/PIENSE-II', 'IQ English'],
    },
  },
  {
    fact_type: 'hecho',
    subject: 'audiencia_contenido',
    subject_slug: 'audiencia_contenido',
    canonical_text:
      'El contenido/guiones se dirigen principalmente a padres de familia y estudiantes de preparatoria en proceso de admisión universitaria.',
    value: {
      audiencia_primaria: 'padres de familia',
      audiencia_secundaria: 'estudiantes de prepa',
    },
  },
  {
    fact_type: 'hecho',
    subject: 'propuesta_valor_contenido',
    subject_slug: 'propuesta_valor_contenido',
    canonical_text:
      'Los mensajes deben transmitir preparación seria y resultados medibles: banco de +1500 ejercicios, clases en vivo, simulacros de examen, reportes de avance para padres.',
    value: {
      pilares: [
        'preparación seria',
        'resultados medibles',
        'seguimiento a padres',
      ],
    },
  },
  {
    fact_type: 'preferencia',
    subject: 'tono_marca',
    subject_slug: 'tono_marca',
    canonical_text:
      'El tono de todo el contenido debe ser profesional, académico y motivacional.',
    value: {
      tono: ['profesional', 'académico', 'motivacional'],
    },
  },
  {
    fact_type: 'regla',
    subject: 'reglas_contenido',
    subject_slug: 'reglas_contenido',
    canonical_text:
      'Nunca prometer resultados de admisión como garantía. Los guiones deben enfocarse en los beneficios de estudiar con IQ-EST, promociones vigentes y llamados a la acción, usando la tensión de consecuencia sin caer en garantía absoluta.',
    value: {
      prohibido: 'prometer resultado de admisión garantizado',
      enfoque: ['beneficios', 'promociones', 'CTA'],
      tecnica: 'matriz de consecuencia',
    },
  },
  {
    fact_type: 'hecho',
    subject: 'agentes_disponibles',
    subject_slug: 'agentes_disponibles',
    canonical_text:
      'Jarvis puede crear/invocar agentes especializados auditables: guionista (script_writer), editor de video (video_editor), editor de imágenes (image_editor). Tipos predefinidos, nunca improvisados.',
    value: {
      agentes: ['script_writer', 'video_editor', 'image_editor'],
      principio: 'tipos predefinidos, no generados libremente',
    },
  },
];

/**
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embed(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is required to seed kb_facts embeddings. Set it in .env.',
    );
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI embeddings failed (${response.status}): ${body}`);
  }

  const payload = await response.json();
  const vector = payload?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error('OpenAI embeddings returned an empty vector');
  }
  return vector;
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;

    await sequelize.transaction(async (transaction) => {
      // 1) Entidad IQ-EST Academy como default (reemplaza el seed "Default" de la migración).
      await sequelize.query(
        `UPDATE entities SET is_default = false WHERE is_default = true AND name <> 'IQ-EST Academy'`,
        { transaction },
      );

      const [existing] = await sequelize.query(
        `SELECT id FROM entities WHERE name = 'IQ-EST Academy' LIMIT 1`,
        { transaction },
      );

      let entityId;
      if (existing.length > 0) {
        entityId = existing[0].id;
        await sequelize.query(
          `
          UPDATE entities
          SET kind = 'empresa',
              is_default = true,
              updated_at = NOW()
          WHERE id = :entityId
          `,
          { replacements: { entityId }, transaction },
        );
      } else {
        // Preferir renombrar el Default de la migración si sigue vacío de hechos.
        const [defaults] = await sequelize.query(
          `
          SELECT e.id
          FROM entities e
          LEFT JOIN kb_facts f ON f.entity_id = e.id
          WHERE e.name = 'Default' AND e.is_default = true
          GROUP BY e.id
          HAVING COUNT(f.id) = 0
          LIMIT 1
          `,
          { transaction },
        );

        if (defaults.length > 0) {
          entityId = defaults[0].id;
          await sequelize.query(
            `
            UPDATE entities
            SET name = 'IQ-EST Academy',
                kind = 'empresa',
                is_default = true,
                updated_at = NOW()
            WHERE id = :entityId
            `,
            { replacements: { entityId }, transaction },
          );
        } else {
          const [created] = await sequelize.query(
            `
            INSERT INTO entities (id, name, kind, is_default, created_at, updated_at)
            VALUES (gen_random_uuid(), 'IQ-EST Academy', 'empresa', true, NOW(), NOW())
            RETURNING id
            `,
            { transaction },
          );
          entityId = created[0].id;
        }
      }

      // RLS: FORCE ROW LEVEL SECURITY exige el GUC en la misma transacción.
      await sequelize.query(
        `SELECT set_config('app.current_entity_id', :entityId, true)`,
        { replacements: { entityId }, transaction },
      );

      const slugs = FACTS.map((f) => f.subject_slug);
      await sequelize.query(
        `
        DELETE FROM kb_facts
        WHERE entity_id = :entityId
          AND subject_slug IN (:slugs)
        `,
        { replacements: { entityId, slugs }, transaction },
      );

      for (const fact of FACTS) {
        const vector = await embed(fact.canonical_text);
        const vectorLiteral = `[${vector.join(',')}]`;

        await sequelize.query(
          `
          INSERT INTO kb_facts (
            id, entity_id, fact_type, subject, subject_slug, value,
            canonical_text, source, source_ref, source_quote, confidence,
            status, pinned, observation_count, superseded_by, embedding_model,
            embedding, created_at, updated_at
          ) VALUES (
            gen_random_uuid(),
            :entityId,
            :factType,
            :subject,
            :subjectSlug,
            :value::jsonb,
            :canonicalText,
            'explicit',
            'seed:iq-est-academy',
            NULL,
            1.0,
            'active',
            true,
            1,
            NULL,
            :embeddingModel,
            :embedding::vector,
            NOW(),
            NOW()
          )
          `,
          {
            replacements: {
              entityId,
              factType: fact.fact_type,
              subject: fact.subject,
              subjectSlug: fact.subject_slug,
              value: JSON.stringify(fact.value),
              canonicalText: fact.canonical_text,
              embeddingModel: EMBEDDING_MODEL,
              embedding: vectorLiteral,
            },
            transaction,
          },
        );
      }

      // eslint-disable-next-line no-console
      console.log(
        `Seeded IQ-EST Academy entity=${entityId} with ${FACTS.length} pinned facts`,
      );
    });
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;

    await sequelize.transaction(async (transaction) => {
      const [rows] = await sequelize.query(
        `SELECT id FROM entities WHERE name = 'IQ-EST Academy' LIMIT 1`,
        { transaction },
      );
      if (rows.length === 0) {
        return;
      }

      const entityId = rows[0].id;
      await sequelize.query(
        `SELECT set_config('app.current_entity_id', :entityId, true)`,
        { replacements: { entityId }, transaction },
      );

      const slugs = FACTS.map((f) => f.subject_slug);
      await sequelize.query(
        `
        DELETE FROM kb_facts
        WHERE entity_id = :entityId
          AND subject_slug IN (:slugs)
          AND source_ref = 'seed:iq-est-academy'
        `,
        { replacements: { entityId, slugs }, transaction },
      );
    });
  },
};
