'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
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

    await queryInterface.addIndex('transcripts', ['started_at']);
    await queryInterface.addIndex('transcripts', ['status']);

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
        references: {
          model: 'transcripts',
          key: 'id',
        },
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

    await queryInterface.addIndex(
      'transcript_segments',
      ['transcript_id', 'sequence_number'],
      { unique: true },
    );
    await queryInterface.addIndex('transcript_segments', ['transcript_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('transcript_segments');
    await queryInterface.dropTable('transcripts');
  },
};
