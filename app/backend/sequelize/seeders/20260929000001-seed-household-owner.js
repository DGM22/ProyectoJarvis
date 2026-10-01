'use strict';

/**
 * Dueño de la casa por defecto. Idempotente: solo inserta si la tabla está vacía.
 *
 * Uso:
 *   cd app/backend && pnpm sequelize:seed
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      'SELECT id FROM household_members LIMIT 1',
    );

    if (Array.isArray(rows) && rows.length > 0) {
      return;
    }

    const now = new Date();
    await queryInterface.bulkInsert('household_members', [
      {
        name: 'Daniel Garza',
        role: 'owner',
        notes: 'Dueño de la casa. Decide quién entra y recibe los paquetes.',
        created_at: now,
        updated_at: now,
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('household_members', {
      name: 'Daniel Garza',
      role: 'owner',
    });
  },
};
