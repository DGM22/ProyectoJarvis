-- =============================================================================
-- IOTEAM · Jarvis — Esquema básico (PostgreSQL 17), en 3FN
--
-- 11 tablas:
--   Hogar y personas ..... homes, household_members, face_photos, users
--   Placas y sensores .... devices, member_devices (N:M), sensors, sensor_events
--   Interacciones ........ interactions, messages
--   Alertas .............. flags
--
-- El esquema completo (conexiones, reconocimiento facial, consultas, tools...)
-- queda en schema-detallado.sql.
-- =============================================================================

-- Casa con su sistema Jarvis.
CREATE TABLE homes (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(120) NOT NULL,
    address     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Personas de la casa (dueños y residentes).
CREATE TABLE household_members (
    id          SERIAL PRIMARY KEY,
    home_id     INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    name        VARCHAR(120) NOT NULL,
    role        VARCHAR(16)  NOT NULL DEFAULT 'resident' CHECK (role IN ('owner', 'resident')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Foto de referencia para reconocer a la persona (máx. una por persona,
-- JPEG/PNG ≤ 5 MB por el límite de Rekognition).
CREATE TABLE face_photos (
    id           SERIAL PRIMARY KEY,
    member_id    INTEGER NOT NULL UNIQUE REFERENCES household_members(id) ON DELETE CASCADE,
    photo        BYTEA NOT NULL CHECK (octet_length(photo) <= 5 * 1024 * 1024),
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cuenta de la app de una persona (opcional: no todos tienen login).
CREATE TABLE users (
    id             SERIAL PRIMARY KEY,
    member_id      INTEGER NOT NULL UNIQUE REFERENCES household_members(id) ON DELETE CASCADE,
    email          VARCHAR(160) NOT NULL UNIQUE,
    password_hash  VARCHAR(255) NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Placa ESP32. Se identifica con el hash SHA-256 de su token "jdv_...".
CREATE TABLE devices (
    id          SERIAL PRIMARY KEY,
    home_id     INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    name        VARCHAR(120) NOT NULL,
    type        VARCHAR(16)  NOT NULL CHECK (type IN ('doorbell', 'door_lock', 'light', 'camera')),
    token_hash  CHAR(64)     NOT NULL UNIQUE,
    status      VARCHAR(16)  NOT NULL DEFAULT 'offline' CHECK (status IN ('offline', 'idle', 'in_call'))
);

-- Muchos a muchos: qué personas tienen acceso a qué placas
-- (una persona usa varias placas; una placa la usan varias personas).
CREATE TABLE member_devices (
    member_id      INTEGER NOT NULL REFERENCES household_members(id) ON DELETE CASCADE,
    device_id      INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    can_open_door  BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (member_id, device_id)
);

-- Sensores conectados a cada placa.
CREATE TABLE sensors (
    id         SERIAL PRIMARY KEY,
    device_id  INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    type       VARCHAR(16) NOT NULL CHECK (type IN ('door', 'light', 'camera', 'microphone')),
    location   VARCHAR(120)
);

-- Lo que reporta cada sensor: puerta abierta/cerrada (1/0), luxes,
-- persona detectada, nivel de audio.
CREATE TABLE sensor_events (
    id           BIGSERIAL PRIMARY KEY,
    sensor_id    INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
    value        NUMERIC(10, 2) NOT NULL,
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sensor_events_sensor_time ON sensor_events(sensor_id, recorded_at DESC);

-- Una interacción con Jarvis: alguien toca el timbre, habla con el
-- asistente o escribe en el chat. member_id = persona reconocida (si se sabe).
CREATE TABLE interactions (
    id          SERIAL PRIMARY KEY,
    device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    member_id   INTEGER REFERENCES household_members(id) ON DELETE SET NULL,
    type        VARCHAR(16) NOT NULL CHECK (type IN ('doorbell', 'assistant', 'chat')),
    status      VARCHAR(16) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'answered', 'unanswered', 'hung_up')),
    started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at    TIMESTAMPTZ
);

-- Lo que se dijo en la interacción: la persona y la respuesta de la IA.
CREATE TABLE messages (
    id              BIGSERIAL PRIMARY KEY,
    interaction_id  INTEGER NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
    sender          VARCHAR(8) NOT NULL CHECK (sender IN ('person', 'ai', 'owner')),
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Alerta para el dueño. Viene de una interacción (chat colgado, visita sin
-- contestar) o de un evento de sensor (puerta abierta mucho tiempo).
CREATE TABLE flags (
    id               SERIAL PRIMARY KEY,
    interaction_id   INTEGER REFERENCES interactions(id) ON DELETE CASCADE,
    sensor_event_id  BIGINT  REFERENCES sensor_events(id) ON DELETE CASCADE,
    type             VARCHAR(24) NOT NULL
                     CHECK (type IN ('unanswered_chat', 'missed_visit', 'door_left_open',
                                     'unknown_person')),
    status           VARCHAR(14) NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'acknowledged', 'resolved')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (num_nonnulls(interaction_id, sensor_event_id) = 1)
);
