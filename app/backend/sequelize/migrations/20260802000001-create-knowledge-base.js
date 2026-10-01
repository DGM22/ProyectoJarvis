'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      'CREATE EXTENSION IF NOT EXISTS vector;',
    );

    await queryInterface.createTable('entities', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      name: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      kind: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      is_default: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE entities
      ADD CONSTRAINT entities_kind_check
      CHECK (kind IN ('empresa', 'persona'));
    `);

    await queryInterface.addIndex('entities', ['is_default']);

    await queryInterface.sequelize.query(`
      INSERT INTO entities (id, name, kind, is_default, created_at, updated_at)
      VALUES (
        gen_random_uuid(),
        'Default',
        'empresa',
        true,
        NOW(),
        NOW()
      );
    `);

    await queryInterface.createTable('kb_facts', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      entity_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'entities', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      fact_type: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      subject: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      subject_slug: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      value: {
        type: Sequelize.JSONB,
        allowNull: false,
      },
      canonical_text: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      source: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      source_ref: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      source_quote: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      confidence: {
        type: Sequelize.FLOAT,
        allowNull: false,
        defaultValue: 1.0,
      },
      status: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: 'active',
      },
      pinned: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      observation_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      superseded_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'kb_facts', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      embedding_model: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE kb_facts
      ADD COLUMN embedding vector(1536);
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE kb_facts
      ADD CONSTRAINT kb_facts_fact_type_check
      CHECK (fact_type IN ('hecho', 'decision', 'preferencia', 'procedimiento', 'regla'));
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE kb_facts
      ADD CONSTRAINT kb_facts_source_check
      CHECK (source IN ('explicit', 'passive'));
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE kb_facts
      ADD CONSTRAINT kb_facts_status_check
      CHECK (status IN ('active', 'pending_review', 'superseded', 'disputed'));
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX kb_facts_embedding_hnsw_idx
      ON kb_facts
      USING hnsw (embedding vector_cosine_ops);
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX kb_facts_canonical_text_fts_idx
      ON kb_facts
      USING gin (to_tsvector('spanish', canonical_text));
    `);

    await queryInterface.addIndex('kb_facts', ['entity_id', 'status'], {
      name: 'kb_facts_entity_status_idx',
    });
    await queryInterface.addIndex('kb_facts', ['entity_id', 'pinned'], {
      name: 'kb_facts_entity_pinned_idx',
    });
    await queryInterface.addIndex(
      'kb_facts',
      ['entity_id', 'subject_slug', 'fact_type'],
      { name: 'kb_facts_entity_subject_fact_type_idx' },
    );

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX kb_facts_one_active_per_subject
      ON kb_facts (entity_id, subject_slug, fact_type)
      WHERE status = 'active';
    `);

    await queryInterface.createTable('kb_facts_history', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
      },
      entity_id: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      fact_type: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      subject: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      subject_slug: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      value: {
        type: Sequelize.JSONB,
        allowNull: false,
      },
      canonical_text: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      source: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      source_ref: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      source_quote: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      confidence: {
        type: Sequelize.FLOAT,
        allowNull: false,
      },
      status: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      pinned: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      observation_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      superseded_by: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      embedding_model: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      archive_reason: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      archived_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.createTable('kb_duplicate_candidates', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      entity_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'entities', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      fact_a_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'kb_facts', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      fact_b_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'kb_facts', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      similarity: {
        type: Sequelize.FLOAT,
        allowNull: false,
      },
      status: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: 'open',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE kb_duplicate_candidates
      ADD CONSTRAINT kb_duplicate_candidates_status_check
      CHECK (status IN ('open', 'resolved', 'dismissed'));
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE kb_facts ENABLE ROW LEVEL SECURITY;
      ALTER TABLE kb_facts FORCE ROW LEVEL SECURITY;
      CREATE POLICY kb_facts_entity_isolation ON kb_facts
        USING (entity_id = NULLIF(current_setting('app.current_entity_id', true), '')::uuid)
        WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity_id', true), '')::uuid);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP POLICY IF EXISTS kb_facts_entity_isolation ON kb_facts;
      ALTER TABLE kb_facts NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE kb_facts DISABLE ROW LEVEL SECURITY;
    `);
    await queryInterface.dropTable('kb_duplicate_candidates');
    await queryInterface.dropTable('kb_facts_history');
    await queryInterface.dropTable('kb_facts');
    await queryInterface.dropTable('entities');
  },
};
