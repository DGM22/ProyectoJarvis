'use strict';

/**
 * Estructura nueva de la casa (diseño de `jarvis.sql`, traducido a Postgres y
 * a la convención en inglés del proyecto):
 *
 *   persona            → people              (antes household_members, mismos ids)
 *   usuario            → users               (login: username + scrypt con salt)
 *   dispositivo        → devices             (se le agregan ip y active)
 *   sensor             → sensors
 *   actuador           → actuators
 *   interaccion        → interactions        (cada visita / evento en la puerta)
 *   lectura_sensor     → sensor_readings
 *   reconocimiento     → recognitions        (resultado de Rekognition)
 *   respuesta_ia       → ai_responses
 *   acceso             → accesses
 *   activacion_actuador→ actuator_activations
 *   notificacion       → notifications       (anillo al dueño: open/ignore/expired)
 *   error_pipeline     → pipeline_errors
 *
 * Los roles y tipos se traducen: dueno/residente/invitado → owner/resident/guest;
 * bocina/led_entrada/foco/servo/buzzer → speaker/entry_led/light/servo/buzzer;
 * abrir/ignorar/expirado → open/ignore/expired.
 */

/** Sensores que cada dispositivo de puerta trae (o traerá) de fábrica. */
const DEFAULT_SENSORS = [
  ['doorbell_button', 'Botón del timbre'],
  ['camera', 'Cámara de la puerta'],
  ['microphone', 'Micrófono INMP441'],
  ['door_contact', 'Sensor magnético de la puerta (pendiente de instalar)'],
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { sequelize } = queryInterface;
    const ts = {
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
    };

    await sequelize.transaction(async (transaction) => {
      const q = (sql) => sequelize.query(sql, { transaction });
      const opts = { transaction };

      // --- people (antes household_members) -------------------------------
      await queryInterface.renameTable('household_members', 'people', opts);
      await q('ALTER INDEX IF EXISTS household_members_role RENAME TO people_role');
      await q('ALTER SEQUENCE IF EXISTS household_members_id_seq RENAME TO people_id_seq');
      await q('ALTER TABLE people RENAME CONSTRAINT household_members_pkey TO people_pkey');
      await queryInterface.addColumn(
        'people',
        'active',
        { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        opts,
      );
      await q(
        "ALTER TABLE people ADD CONSTRAINT ck_people_role CHECK (role IN ('owner', 'resident', 'guest'))",
      );

      // --- users -----------------------------------------------------------
      await queryInterface.createTable(
        'users',
        {
          id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
          person_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: 'people', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          username: { type: Sequelize.STRING(50), allowNull: false, unique: true },
          password_hash: { type: Sequelize.STRING(255), allowNull: false },
          salt: { type: Sequelize.STRING(64), allowNull: false },
          last_login_at: { type: Sequelize.DATE, allowNull: true },
          ...ts,
          updated_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('NOW()'),
          },
        },
        opts,
      );
      await queryInterface.addIndex('users', ['person_id'], opts);

      // --- devices ---------------------------------------------------------
      await queryInterface.addColumn(
        'devices',
        'ip',
        { type: Sequelize.STRING(45), allowNull: true },
        opts,
      );
      await queryInterface.addColumn(
        'devices',
        'active',
        { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        opts,
      );

      // --- sensors / actuators ---------------------------------------------
      await queryInterface.createTable(
        'sensors',
        {
          id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
          device_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: 'devices', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          name: { type: Sequelize.STRING(50), allowNull: false },
          description: { type: Sequelize.STRING(100), allowNull: true },
        },
        opts,
      );
      await queryInterface.addConstraint('sensors', {
        fields: ['device_id', 'name'],
        type: 'unique',
        name: 'uq_sensors_device_name',
        transaction,
      });

      await queryInterface.createTable(
        'actuators',
        {
          id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
          device_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: 'devices', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          paired_sensor_id: {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: { model: 'sensors', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
          type: { type: Sequelize.STRING(20), allowNull: false },
        },
        opts,
      );
      await q(
        "ALTER TABLE actuators ADD CONSTRAINT ck_actuators_type CHECK (type IN ('speaker', 'entry_led', 'light', 'servo', 'buzzer'))",
      );
      await queryInterface.addIndex('actuators', ['device_id'], opts);
      await queryInterface.addIndex('actuators', ['paired_sensor_id'], opts);

      // --- interactions (núcleo del historial) -----------------------------
      await queryInterface.createTable(
        'interactions',
        {
          id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
          sensor_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: 'sensors', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          occurred_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('NOW()'),
          },
          reason: { type: Sequelize.STRING(100), allowNull: true },
          handled_by_ai: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
          transcript: { type: Sequelize.TEXT, allowNull: true },
          // Enlace a la consulta en memoria (UUID) para unir el evento en vivo.
          consult_id: { type: Sequelize.STRING(64), allowNull: true },
        },
        opts,
      );
      await queryInterface.addIndex('interactions', ['occurred_at'], opts);
      await queryInterface.addIndex('interactions', ['sensor_id'], opts);
      await queryInterface.addIndex('interactions', ['consult_id'], opts);

      await queryInterface.createTable(
        'sensor_readings',
        {
          id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
          sensor_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: 'sensors', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          recorded_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('NOW()'),
          },
          value: { type: Sequelize.DOUBLE, allowNull: false },
          unit: { type: Sequelize.STRING(10), allowNull: true },
        },
        opts,
      );
      await queryInterface.addIndex('sensor_readings', ['sensor_id', 'recorded_at'], opts);

      await queryInterface.createTable(
        'recognitions',
        {
          id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
          interaction_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: 'interactions', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          person_id: {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: { model: 'people', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
          recognized: { type: Sequelize.BOOLEAN, allowNull: false },
          confidence: { type: Sequelize.DECIMAL(4, 3), allowNull: true },
        },
        opts,
      );
      await q(
        'ALTER TABLE recognitions ADD CONSTRAINT ck_recognitions_confidence CHECK (confidence BETWEEN 0 AND 1)',
      );
      await q(
        'ALTER TABLE recognitions ADD CONSTRAINT ck_recognitions_person CHECK (recognized OR person_id IS NULL)',
      );
      await queryInterface.addIndex('recognitions', ['interaction_id'], opts);
      await queryInterface.addIndex('recognitions', ['person_id'], opts);

      await queryInterface.createTable(
        'ai_responses',
        {
          id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
          interaction_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: 'interactions', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          actuator_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: 'actuators', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          response_text: { type: Sequelize.TEXT, allowNull: false },
          ...ts,
        },
        opts,
      );
      await queryInterface.addIndex('ai_responses', ['interaction_id'], opts);
      await queryInterface.addIndex('ai_responses', ['actuator_id'], opts);

      await queryInterface.createTable(
        'accesses',
        {
          id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
          interaction_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: 'interactions', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          person_id: {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: { model: 'people', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
          seconds_open: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
          access_granted: { type: Sequelize.BOOLEAN, allowNull: false },
          completed: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
          closed_ok: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
          had_error: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        },
        opts,
      );
      await q('ALTER TABLE accesses ADD CONSTRAINT ck_accesses_seconds CHECK (seconds_open >= 0)');
      await queryInterface.addIndex('accesses', ['interaction_id'], opts);
      await queryInterface.addIndex('accesses', ['person_id'], opts);

      // duración calculada por Postgres (equivalente al GENERATED de MySQL).
      await q(`
        CREATE TABLE actuator_activations (
          id SERIAL PRIMARY KEY,
          actuator_id INTEGER NOT NULL REFERENCES actuators (id) ON UPDATE CASCADE ON DELETE RESTRICT,
          interaction_id INTEGER NULL REFERENCES interactions (id) ON UPDATE CASCADE ON DELETE SET NULL,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ended_at TIMESTAMPTZ NULL,
          duration_s INTEGER GENERATED ALWAYS AS (
            CAST(EXTRACT(EPOCH FROM (ended_at - started_at)) AS INTEGER)
          ) STORED,
          CONSTRAINT ck_actuator_activations_dates CHECK (ended_at IS NULL OR ended_at >= started_at)
        )
      `);
      await queryInterface.addIndex('actuator_activations', ['actuator_id', 'started_at'], opts);
      await queryInterface.addIndex('actuator_activations', ['interaction_id'], opts);

      await queryInterface.createTable(
        'notifications',
        {
          id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
          interaction_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: 'interactions', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          person_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: 'people', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          sent_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('NOW()'),
          },
          response: { type: Sequelize.STRING(10), allowNull: true },
          responded_at: { type: Sequelize.DATE, allowNull: true },
        },
        opts,
      );
      await q(
        "ALTER TABLE notifications ADD CONSTRAINT ck_notifications_response CHECK (response IN ('open', 'ignore', 'expired'))",
      );
      await q(
        'ALTER TABLE notifications ADD CONSTRAINT ck_notifications_dates CHECK (responded_at IS NULL OR responded_at >= sent_at)',
      );
      await queryInterface.addIndex('notifications', ['interaction_id'], opts);
      await queryInterface.addIndex('notifications', ['person_id'], opts);

      await queryInterface.createTable(
        'pipeline_errors',
        {
          id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
          device_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: 'devices', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          interaction_id: {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: { model: 'interactions', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
          occurred_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('NOW()'),
          },
          code: { type: Sequelize.STRING(20), allowNull: false },
          description: { type: Sequelize.TEXT, allowNull: true },
        },
        opts,
      );
      await queryInterface.addIndex('pipeline_errors', ['device_id'], opts);
      await queryInterface.addIndex('pipeline_errors', ['interaction_id'], opts);
      await queryInterface.addIndex('pipeline_errors', ['occurred_at'], opts);

      // --- sensores y bocina para los dispositivos que ya existen ----------
      const [devices] = await q('SELECT id FROM devices');
      for (const { id } of devices) {
        for (const [name, description] of DEFAULT_SENSORS) {
          await sequelize.query(
            'INSERT INTO sensors (device_id, name, description) VALUES (:id, :name, :description) ON CONFLICT DO NOTHING',
            { replacements: { id, name, description }, transaction },
          );
        }
        await sequelize.query(
          `INSERT INTO actuators (device_id, paired_sensor_id, type)
           SELECT :id, s.id, 'speaker' FROM sensors s WHERE s.device_id = :id AND s.name = 'microphone'`,
          { replacements: { id }, transaction },
        );
      }
    });
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;
    await sequelize.transaction(async (transaction) => {
      const opts = { transaction };
      for (const table of [
        'pipeline_errors',
        'notifications',
        'actuator_activations',
        'accesses',
        'ai_responses',
        'recognitions',
        'sensor_readings',
        'interactions',
        'actuators',
        'sensors',
        'users',
      ]) {
        await queryInterface.dropTable(table, opts);
      }
      await queryInterface.removeColumn('devices', 'active', opts);
      await queryInterface.removeColumn('devices', 'ip', opts);
      await sequelize.query('ALTER TABLE people DROP CONSTRAINT IF EXISTS ck_people_role', opts);
      await queryInterface.removeColumn('people', 'active', opts);
      await sequelize.query('ALTER TABLE people RENAME CONSTRAINT people_pkey TO household_members_pkey', opts);
      await sequelize.query('ALTER SEQUENCE IF EXISTS people_id_seq RENAME TO household_members_id_seq', opts);
      await sequelize.query('ALTER INDEX IF EXISTS people_role RENAME TO household_members_role', opts);
      await queryInterface.renameTable('people', 'household_members', opts);
    });
  },
};
