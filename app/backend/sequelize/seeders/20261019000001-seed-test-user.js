'use strict';

/**
 * Usuario de prueba para entrar a la app (corre en cada `docker compose up`
 * desde el servicio `backend-migrate`).
 *
 * Las credenciales viven en el `.env` (nunca en el repo):
 *   SEED_TEST_USERNAME=prueba
 *   SEED_TEST_PASSWORD=...        (sin esto el seed no hace nada)
 *
 * Idempotente: crea la persona "Usuario de prueba" (rol owner) y su cuenta una
 * sola vez; si cambias la contraseña en el `.env`, la actualiza.
 * El hash es el mismo que usa el backend: scrypt(password, salt) de 64 bytes.
 *
 * Uso manual:
 *   cd app/backend && pnpm exec sequelize-cli db:seed --seed 20261019000001-seed-test-user.js
 */

const crypto = require('crypto');

const PERSON_NAME = 'Usuario de prueba';

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const username = (process.env.SEED_TEST_USERNAME || 'prueba').trim().toLowerCase();
    const password = process.env.SEED_TEST_PASSWORD || '';
    if (password.length < 8) {
      console.log(
        '[seed-test-user] SEED_TEST_PASSWORD vacío o < 8 caracteres: no se crea el usuario de prueba.',
      );
      return;
    }

    const { sequelize } = queryInterface;
    await sequelize.transaction(async (transaction) => {
      const [[existing]] = await sequelize.query(
        'SELECT id, salt, password_hash FROM users WHERE username = :username',
        { replacements: { username }, transaction },
      );

      if (existing) {
        if (hashPassword(password, existing.salt) !== existing.password_hash) {
          const salt = crypto.randomBytes(16).toString('hex');
          await sequelize.query(
            'UPDATE users SET password_hash = :hash, salt = :salt, updated_at = NOW() WHERE id = :id',
            { replacements: { hash: hashPassword(password, salt), salt, id: existing.id }, transaction },
          );
          console.log(`[seed-test-user] contraseña de "${username}" actualizada desde el .env`);
        }
        return;
      }

      const [[person]] = await sequelize.query(
        `INSERT INTO people (name, role, notes, active, created_at, updated_at)
         VALUES (:name, 'owner', 'Cuenta de prueba creada por el seed.', true, NOW(), NOW())
         RETURNING id`,
        { replacements: { name: PERSON_NAME }, transaction },
      );
      const salt = crypto.randomBytes(16).toString('hex');
      await sequelize.query(
        `INSERT INTO users (person_id, username, password_hash, salt, created_at, updated_at)
         VALUES (:personId, :username, :hash, :salt, NOW(), NOW())`,
        {
          replacements: { personId: person.id, username, hash: hashPassword(password, salt), salt },
          transaction,
        },
      );
      console.log(`[seed-test-user] usuario de prueba "${username}" creado`);
    });
  },

  async down(queryInterface) {
    const username = (process.env.SEED_TEST_USERNAME || 'prueba').trim().toLowerCase();
    await queryInterface.sequelize.query(
      `DELETE FROM people WHERE name = :name AND id IN (SELECT person_id FROM users WHERE username = :username)`,
      { replacements: { name: PERSON_NAME, username } },
    );
  },
};
