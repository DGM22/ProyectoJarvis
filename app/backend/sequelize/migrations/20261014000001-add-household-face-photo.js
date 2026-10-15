'use strict';

/**
 * Foto de referencia por persona de la casa para la verificación facial del
 * timbre (AWS Rekognition CompareFaces). Se guarda en Postgres: son pocas
 * fotos chicas y así no hace falta un bucket.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('household_members', 'face_photo', {
      type: Sequelize.BLOB,
      allowNull: true,
    });
    await queryInterface.addColumn('household_members', 'face_photo_mime', {
      type: Sequelize.STRING(32),
      allowNull: true,
    });
    await queryInterface.addColumn(
      'household_members',
      'face_photo_updated_at',
      {
        type: Sequelize.DATE,
        allowNull: true,
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn(
      'household_members',
      'face_photo_updated_at',
    );
    await queryInterface.removeColumn('household_members', 'face_photo_mime');
    await queryInterface.removeColumn('household_members', 'face_photo');
  },
};
