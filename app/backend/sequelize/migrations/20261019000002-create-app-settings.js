'use strict';

/**
 * Ajustes de la casa en pares clave → JSON (p. ej. cómo atiende la puerta).
 * Una fila por ajuste; los valores por defecto viven en el código.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('app_settings', {
      key: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false },
      value: { type: Sequelize.JSONB, allowNull: false },
      updated_by_person_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'people', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('app_settings');
  },
};
