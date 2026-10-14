'use strict';

/** Quita las tablas de Google OAuth y del modo de transcripción de juntas. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'DROP TABLE IF EXISTS transcript_segments CASCADE;',
    );
    await queryInterface.sequelize.query(
      'DROP TABLE IF EXISTS transcripts CASCADE;',
    );
    await queryInterface.sequelize.query(
      'DROP TABLE IF EXISTS google_credentials CASCADE;',
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.createTable('google_credentials', {
      provider: {
        type: Sequelize.STRING,
        allowNull: false,
        primaryKey: true,
      },
      refresh_token_encrypted: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      scope: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      email: {
        type: Sequelize.STRING,
        allowNull: true,
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

    await queryInterface.createTable('transcripts', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      title: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      status: {
        type: Sequelize.STRING(16),
        allowNull: false,
        defaultValue: 'recording',
      },
      file_path: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      duration_seconds: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      started_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
      ended_at: {
        type: Sequelize.DATE,
        allowNull: true,
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

    await queryInterface.createTable('transcript_segments', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      transcript_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'transcripts', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      sequence_number: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      text: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      language: {
        type: Sequelize.STRING(16),
        allowNull: true,
      },
      status: {
        type: Sequelize.STRING(16),
        allowNull: false,
        defaultValue: 'pending',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
    });
  },
};
