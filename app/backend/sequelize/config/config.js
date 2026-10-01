const fs = require('fs');
const path = require('path');

/**
 * El `.env` vive en la raíz del monorepo. Sequelize CLI se ejecuta desde
 * `app/backend`, así que hay que probar varias rutas (igual que ConfigModule).
 */
const envCandidates = [
  path.resolve(__dirname, '../../../../.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(process.cwd(), '.env'),
];
const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));
if (envPath) {
  require('dotenv').config({ path: envPath });
}

module.exports = {
  development: {
    username: process.env.POSTGRES_USER || 'jarvis',
    password: process.env.POSTGRES_PASSWORD || 'jarvis_secret',
    database: process.env.POSTGRES_DB || 'jarvis',
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    dialect: 'postgres',
    logging: false,
  },
  test: {
    username: process.env.POSTGRES_USER || 'jarvis',
    password: process.env.POSTGRES_PASSWORD || 'jarvis_secret',
    database: process.env.POSTGRES_DB || 'jarvis_test',
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    dialect: 'postgres',
    logging: false,
  },
  production: {
    username: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || 5432),
    dialect: 'postgres',
    logging: false,
  },
};
