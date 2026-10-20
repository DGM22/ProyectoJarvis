-- =============================================================================
-- IOTEAM · Jarvis — Esquema de base de datos (PostgreSQL 17)
--
-- Refleja la lógica que ya existe en el backend (app/backend/src):
--   · devices.service.ts          token jdv_ + hash SHA-256 + prefijo de 8
--   · devices.gateway.ts          /devices (voz) y camera.gateway.ts /camera
--   · household.service.ts        foto JPEG/PNG ≤ 5 MB por persona
--   · face-verification.service   Rekognition, umbral 90 %, 3 intentos/sesión
--   · realtime-ws-bridge.service  motivo → modo (button = timbre)
--   · consult.service.ts          consulta timbre → dueño (UUID, estados)
--   · skills/*                    herramientas que llama la IA
--
-- Normalizado a 3FN: cada dato vive en un solo lugar. Lo que se deduce
-- (estado en línea, modo de la sesión, mime de la foto, hogar de un flag...)
-- se calcula en las vistas del final.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. HOGAR Y PERSONAS
-- -----------------------------------------------------------------------------

CREATE TABLE homes (
    id                      SERIAL PRIMARY KEY,
    name                    VARCHAR(120) NOT NULL,
    address                 TEXT,
    timezone                VARCHAR(64)  NOT NULL DEFAULT 'America/Monterrey',
    -- Minutos que la puerta puede quedarse abierta antes de levantar un flag.
    door_open_alert_minutes INTEGER NOT NULL DEFAULT 5 CHECK (door_open_alert_minutes > 0),
    -- Similitud mínima (%) para que Rekognition confirme al dueño (FACE_MATCH_THRESHOLD).
    face_match_threshold    NUMERIC(5, 1) NOT NULL DEFAULT 90 CHECK (face_match_threshold BETWEEN 0 AND 100),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Personas de la casa (roster del timbre). Mismos roles que el código:
-- solo los 'owner' se comparan con la cámara.
CREATE TABLE household_members (
    id          SERIAL PRIMARY KEY,
    home_id     INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    name        VARCHAR(120) NOT NULL,
    role        VARCHAR(16)  NOT NULL DEFAULT 'resident' CHECK (role IN ('owner', 'resident')),
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (home_id, name)               -- el código hace upsert por nombre
);

-- Foto de referencia para reconocer a la persona. Separada de
-- household_members porque es opcional y pesada. El tipo (JPEG/PNG) se
-- deduce de los bytes (vista v_face_photos), no se guarda aparte.
CREATE TABLE face_photos (
    member_id    INTEGER PRIMARY KEY REFERENCES household_members(id) ON DELETE CASCADE,
    photo        BYTEA NOT NULL
                 CHECK (octet_length(photo) <= 5 * 1024 * 1024)            -- límite de Rekognition
                 CHECK (substring(photo FROM 1 FOR 3) = '\xffd8ff'::bytea  -- JPEG
                     OR substring(photo FROM 1 FOR 8) = '\x89504e470d0a1a0a'::bytea), -- PNG
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cuenta de la app de una persona de la casa (nuevo: hoy no hay login).
-- El nombre y el hogar se obtienen de household_members.
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    member_id     INTEGER NOT NULL UNIQUE REFERENCES household_members(id) ON DELETE CASCADE,
    email         VARCHAR(160) NOT NULL UNIQUE,
    phone         VARCHAR(32),
    password_hash VARCHAR(255) NOT NULL,
    app_role      VARCHAR(16)  NOT NULL DEFAULT 'resident'
                  CHECK (app_role IN ('owner', 'resident', 'admin')),   -- permisos en la app
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 2. MICROCONTROLADORES (identificación y conexiones)
-- -----------------------------------------------------------------------------

-- Cada placa ESP32. Se identifica con un token "jdv_" + 24 bytes aleatorios
-- que se muestra UNA vez: aquí solo queda su hash SHA-256 (para autenticar el
-- WebSocket) y los primeros 8 caracteres (para reconocerla en la app).
CREATE TABLE devices (
    id                SERIAL PRIMARY KEY,
    home_id           INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    name              VARCHAR(120) NOT NULL,
    device_type       VARCHAR(24)  NOT NULL
                      CHECK (device_type IN ('doorbell', 'door_lock', 'light_controller', 'camera')),
    location          VARCHAR(120),
    token_hash        CHAR(64)     NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    token_prefix      VARCHAR(8)   NOT NULL CHECK (token_prefix ~ '^jdv_.{4}$'),
    token_rotated_at  TIMESTAMPTZ,       -- última vez que se rotó (el token viejo deja de servir)
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_devices_home ON devices(home_id);

-- Cada vez que una placa se conecta al backend y por qué canal. De aquí sale
-- si está en línea, cuándo se vio por última vez y su versión de firmware
-- (vista v_devices). Reemplaza el parche firmware_version = 'camera'.
CREATE TABLE device_connections (
    id                 BIGSERIAL PRIMARY KEY,
    device_id          INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    channel            VARCHAR(8) NOT NULL CHECK (channel IN ('voice', 'camera')),  -- /devices o /camera
    firmware_version   VARCHAR(32),       -- lo manda la placa en el mensaje "hello"
    remote_ip          INET,
    connected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    disconnected_at    TIMESTAMPTZ,       -- NULL = sigue conectada
    CHECK (disconnected_at IS NULL OR disconnected_at >= connected_at)
);
CREATE INDEX idx_device_connections_device_time ON device_connections(device_id, connected_at DESC);
CREATE INDEX idx_device_connections_open ON device_connections(device_id) WHERE disconnected_at IS NULL;

-- Catálogo de tipos de componente: si es sensor o actuador y su unidad
-- dependen del tipo, no de cada componente.
CREATE TABLE component_kinds (
    code        VARCHAR(24) PRIMARY KEY,
    category    VARCHAR(10) NOT NULL CHECK (category IN ('sensor', 'actuator')),
    unit        VARCHAR(16),
    description TEXT NOT NULL
);
INSERT INTO component_kinds (code, category, unit, description) VALUES
    ('microphone',   'sensor',   'dBFS', 'Micrófono I2S (INMP441) del timbre'),
    ('camera',       'sensor',   NULL,   'Cámara OV2640 de la puerta'),
    ('light_sensor', 'sensor',   'lux',  'Sensor de luz ambiental (BH1750 / LDR)'),
    ('door_sensor',  'sensor',   NULL,   'Sensor magnético de puerta (reed switch)'),
    ('speaker',      'actuator', NULL,   'Bocina con amplificador (MAX98357A / ES8311)'),
    ('led',          'actuator', NULL,   'LED de la entrada'),
    ('light',        'actuator', NULL,   'Foco de fachada'),
    ('servo_lock',   'actuator', NULL,   'Servomotor del cerrojo');

-- Sensores y actuadores físicos de cada placa.
CREATE TABLE device_components (
    id          SERIAL PRIMARY KEY,
    device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    kind        VARCHAR(24) NOT NULL REFERENCES component_kinds(code),
    name        VARCHAR(120) NOT NULL,
    model       VARCHAR(60),
    gpio_pin    SMALLINT,
    is_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (device_id, name)
);

-- -----------------------------------------------------------------------------
-- 3. IA: SESIONES, MENSAJES Y HERRAMIENTAS
-- -----------------------------------------------------------------------------

-- Por qué empezó una sesión. El modo depende del motivo (en el código:
-- reason === 'button' ? 'doorbell' : 'assistant'), por eso vive aquí.
CREATE TABLE session_reasons (
    code        VARCHAR(16) PRIMARY KEY,
    mode        VARCHAR(12) NOT NULL CHECK (mode IN ('assistant', 'doorbell', 'security')),
    description TEXT NOT NULL
);
INSERT INTO session_reasons (code, mode, description) VALUES
    ('wake',          'assistant', 'Dijeron "Hey Jarvis" a la placa'),
    ('inbound',       'assistant', 'La app llamó a la placa'),
    ('button',        'doorbell',  'Un visitante tocó el timbre'),
    ('web',           'assistant', 'Chat de voz desde la app web'),
    ('owner_consult', 'security',  'El dueño contestó una consulta del timbre');

-- Cómo terminó una sesión. Mismos motivos que manda el backend.
CREATE TABLE end_reasons (
    code        VARCHAR(24) PRIMARY KEY,
    outcome     VARCHAR(12) NOT NULL CHECK (outcome IN ('completed', 'abandoned', 'error')),
    description TEXT NOT NULL
);
INSERT INTO end_reasons (code, outcome, description) VALUES
    ('client_end',        'completed', 'La placa o la app cerró la sesión'),
    ('button',            'completed', 'Colgaron con el botón'),
    ('visitor_left',      'completed', 'El visitante se fue después de ser atendido'),
    ('no_answer',         'abandoned', 'Nadie contestó y la sesión quedó colgada'),
    ('timeout',           'abandoned', 'Se cerró por inactividad'),
    ('device_disconnect', 'error',     'La placa se desconectó a media sesión'),
    ('openai_closed',     'error',     'OpenAI cerró la conexión'),
    ('openai_error',      'error',     'Falló el servicio de IA'),
    ('server_shutdown',   'error',     'Se reinició el backend');

-- Una sesión con Jarvis (en el código, un "bridge" de OpenAI Realtime).
-- Sigue activa mientras ended_at sea NULL.
CREATE TABLE conversations (
    id          SERIAL PRIMARY KEY,
    device_id   INTEGER REFERENCES devices(id) ON DELETE SET NULL,  -- NULL = desde la web
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reason      VARCHAR(16) NOT NULL REFERENCES session_reasons(code),
    end_reason  VARCHAR(24) REFERENCES end_reasons(code),
    summary     TEXT,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at    TIMESTAMPTZ,
    CHECK (device_id IS NOT NULL OR user_id IS NOT NULL),
    CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);
CREATE INDEX idx_conversations_device_time ON conversations(device_id, started_at DESC);
CREATE INDEX idx_conversations_open ON conversations(started_at) WHERE ended_at IS NULL;

-- Lo que se dijo: visitante/usuario, respuesta de la IA, e instrucciones del
-- dueño (instruct_doorbell) que la IA le repite al visitante.
CREATE TABLE messages (
    id               BIGSERIAL PRIMARY KEY,
    conversation_id  INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender           VARCHAR(12) NOT NULL
                     CHECK (sender IN ('visitor', 'user', 'assistant', 'owner', 'system')),
    content          TEXT NOT NULL,
    latency_ms       INTEGER CHECK (latency_ms >= 0),   -- solo respuestas de la IA
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_messages_conversation_time ON messages(conversation_id, created_at);

-- Catálogo de herramientas que la IA puede llamar (skills/*). La skill
-- depende de la herramienta, por eso vive aquí.
CREATE TABLE tools (
    name        VARCHAR(48) PRIMARY KEY,
    skill_name  VARCHAR(32) NOT NULL,
    description TEXT NOT NULL
);
INSERT INTO tools (name, skill_name, description) VALUES
    ('verify_owner_face',     'identity',       'Foto con la cámara y comparación con el dueño'),
    ('call_owner',            'consult',        'Avisar al dueño que hay alguien en la puerta'),
    ('instruct_doorbell',     'consult',        'Pasar la decisión del dueño al timbre'),
    ('connect_visitor',       'consult',        'Interfón directo dueño ↔ visitante'),
    ('end_consult',           'consult',        'Terminar la consulta'),
    ('household_list',        'household',      'Listar a las personas de la casa'),
    ('household_save_member', 'household',      'Agregar o actualizar a una persona'),
    ('kb_search',             'knowledge-base', 'Buscar en la base de conocimiento'),
    ('kb_save_fact',          'knowledge-base', 'Guardar un dato aprendido');

-- Cada vez que la IA llamó una herramienta. arguments/result son el JSON
-- tal cual lo maneja OpenAI: se guardan como un solo valor (documento).
CREATE TABLE tool_calls (
    id               BIGSERIAL PRIMARY KEY,
    conversation_id  INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    tool_name        VARCHAR(48) NOT NULL REFERENCES tools(name),
    arguments        JSONB,
    result           JSONB,
    status           VARCHAR(8) NOT NULL CHECK (status IN ('success', 'error')),
    error_message    TEXT,
    latency_ms       INTEGER CHECK (latency_ms >= 0),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((status = 'error') = (error_message IS NOT NULL))
);
CREATE INDEX idx_tool_calls_conversation ON tool_calls(conversation_id, created_at);

-- -----------------------------------------------------------------------------
-- 4. RECONOCIMIENTO DEL DUEÑO Y CONSULTAS DEL TIMBRE
-- -----------------------------------------------------------------------------

-- Cada intento de verify_owner_face: se toma una foto con la cámara y se
-- compara (Rekognition CompareFaces) contra las fotos de los 'owner'.
-- El código permite máximo 3 intentos por sesión del timbre.
CREATE TABLE face_verifications (
    id                 BIGSERIAL PRIMARY KEY,
    conversation_id    INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    camera_device_id   INTEGER REFERENCES devices(id) ON DELETE SET NULL,   -- placa que tomó la foto
    claimed_name       VARCHAR(120),     -- nombre que dijo el visitante
    status             VARCHAR(20) NOT NULL
                       CHECK (status IN ('match', 'no_match', 'no_face', 'no_camera',
                                         'no_reference', 'too_many_attempts', 'unavailable')),
    matched_member_id  INTEGER REFERENCES household_members(id) ON DELETE SET NULL,
    similarity         NUMERIC(5, 1) CHECK (similarity BETWEEN 0 AND 100),  -- mejor % obtenido
    threshold          NUMERIC(5, 1) NOT NULL,   -- umbral vigente en ese momento (historial)
    captured_at        TIMESTAMPTZ,      -- cuándo se tomó la foto (si hubo cámara)
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((status = 'match') = (matched_member_id IS NOT NULL)),
    CHECK ((status IN ('match', 'no_match')) = (similarity IS NOT NULL)),
    -- Hubo foto en match/no_match/no_face; no la hubo si faltó cámara, referencia o intentos.
    -- ('unavailable' puede llegar con o sin foto: Rekognition falla después de capturar.)
    CHECK (status NOT IN ('match', 'no_match', 'no_face') OR camera_device_id IS NOT NULL),
    CHECK (status NOT IN ('no_camera', 'no_reference', 'too_many_attempts') OR camera_device_id IS NULL)
);
CREATE INDEX idx_face_verifications_conversation ON face_verifications(conversation_id);

-- Consulta timbre → dueño (consult.service.ts). El id es el UUID del código.
-- Une la sesión del timbre (visitante) con la sesión 'security' del dueño.
-- Lo que el dueño decidió queda como mensaje 'owner' en la conversación.
CREATE TABLE consults (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doorbell_conversation_id INTEGER NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
    owner_conversation_id    INTEGER UNIQUE REFERENCES conversations(id) ON DELETE SET NULL,
    visitor_summary          TEXT NOT NULL,      -- "Repartidor de Amazon con un paquete"
    status                   VARCHAR(16) NOT NULL DEFAULT 'ringing'
                             CHECK (status IN ('ringing', 'answered', 'missed',
                                               'declined', 'closed', 'visitor_left')),
    answered_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
    rang_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    answered_at              TIMESTAMPTZ,
    intercom_started_at      TIMESTAMPTZ,       -- interfón directo (connect_visitor)
    intercom_ended_at        TIMESTAMPTZ,
    ended_at                 TIMESTAMPTZ,
    CHECK (doorbell_conversation_id <> owner_conversation_id),
    CHECK (status <> 'answered' OR answered_at IS NOT NULL),
    CHECK (status NOT IN ('ringing', 'missed', 'declined') OR answered_at IS NULL),
    CHECK (intercom_started_at IS NULL OR answered_at IS NOT NULL),
    CHECK (intercom_ended_at IS NULL OR intercom_started_at IS NOT NULL)
);
CREATE INDEX idx_consults_time ON consults(rang_at DESC);

-- -----------------------------------------------------------------------------
-- 5. DATOS DE SENSORES Y ACTUADORES
-- -----------------------------------------------------------------------------

-- Lecturas numéricas periódicas (luxes, nivel de audio). Serie de tiempo.
CREATE TABLE sensor_readings (
    id            BIGSERIAL PRIMARY KEY,
    component_id  INTEGER NOT NULL REFERENCES device_components(id) ON DELETE CASCADE,
    value         NUMERIC(12, 3) NOT NULL,
    recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sensor_readings_component_time ON sensor_readings(component_id, recorded_at DESC);

-- Sensor magnético (imán): un renglón por cada cambio abierta/cerrada.
-- Cuánto estuvo abierta se calcula en v_door_open_periods.
CREATE TABLE door_events (
    id            BIGSERIAL PRIMARY KEY,
    component_id  INTEGER NOT NULL REFERENCES device_components(id) ON DELETE CASCADE,
    state         VARCHAR(8) NOT NULL CHECK (state IN ('open', 'closed')),
    member_id     INTEGER REFERENCES household_members(id) ON DELETE SET NULL, -- quién abrió, si se sabe
    consult_id    UUID REFERENCES consults(id) ON DELETE SET NULL,             -- visita que la abrió
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_door_events_component_time ON door_events(component_id, occurred_at DESC);

-- Cámara: cada vez que detecta a una persona en la entrada (métrica del Par 2).
CREATE TABLE person_detections (
    id                 BIGSERIAL PRIMARY KEY,
    component_id       INTEGER NOT NULL REFERENCES device_components(id) ON DELETE CASCADE,
    confidence         NUMERIC(5, 2) CHECK (confidence BETWEEN 0 AND 100),
    consult_id         UUID REFERENCES consults(id) ON DELETE SET NULL,
    detected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_person_detections_time ON person_detections(detected_at DESC);

-- Órdenes a un actuador y si se cumplieron (servo, foco, LED).
CREATE TABLE actuator_commands (
    id               BIGSERIAL PRIMARY KEY,
    component_id     INTEGER NOT NULL REFERENCES device_components(id) ON DELETE CASCADE,
    command          VARCHAR(16) NOT NULL CHECK (command IN ('lock', 'unlock', 'on', 'off', 'play')),
    source           VARCHAR(12) NOT NULL CHECK (source IN ('user', 'ai', 'automation')),
    requested_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    conversation_id  INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    status           VARCHAR(12) NOT NULL DEFAULT 'sent'
                     CHECK (status IN ('sent', 'success', 'failed', 'timeout')),
    error_message    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at     TIMESTAMPTZ,
    CHECK (requested_by IS NULL OR source = 'user')
);
CREATE INDEX idx_actuator_commands_component_time ON actuator_commands(component_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 6. ALERTAS (SISTEMA DE FLAGS)
-- -----------------------------------------------------------------------------

-- Algo que requiere atención del dueño. Cada flag apunta a EXACTAMENTE UNA
-- causa; el hogar se deduce de ella (vista v_flags).
CREATE TABLE flags (
    id                    SERIAL PRIMARY KEY,
    flag_type             VARCHAR(24) NOT NULL
                          CHECK (flag_type IN ('unanswered_chat',    -- sesión colgada sin respuesta
                                               'missed_consult',     -- tocaron y el dueño no contestó
                                               'identity_mismatch',  -- dijo ser el dueño y la cara no coincidió
                                               'door_left_open',     -- abierta más del límite del hogar
                                               'unknown_person',     -- cámara vio a alguien
                                               'lock_failed',        -- el servo no cerró
                                               'device_offline')),   -- una placa se desconectó
    severity              VARCHAR(10) NOT NULL DEFAULT 'warning'
                          CHECK (severity IN ('info', 'warning', 'critical')),
    status                VARCHAR(14) NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'acknowledged', 'resolved')),
    message               TEXT NOT NULL,
    conversation_id       INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
    consult_id            UUID    REFERENCES consults(id) ON DELETE CASCADE,
    face_verification_id  BIGINT  REFERENCES face_verifications(id) ON DELETE CASCADE,
    door_event_id         BIGINT  REFERENCES door_events(id) ON DELETE CASCADE,
    person_detection_id   BIGINT  REFERENCES person_detections(id) ON DELETE CASCADE,
    actuator_command_id   BIGINT  REFERENCES actuator_commands(id) ON DELETE CASCADE,
    device_connection_id  BIGINT  REFERENCES device_connections(id) ON DELETE CASCADE,
    acknowledged_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at       TIMESTAMPTZ,
    resolved_at           TIMESTAMPTZ,
    CHECK (num_nonnulls(conversation_id, consult_id, face_verification_id, door_event_id,
                        person_detection_id, actuator_command_id, device_connection_id) = 1)
);
CREATE INDEX idx_flags_status ON flags(status, created_at DESC);

-- =============================================================================
-- VISTAS: datos deducidos, calculados al vuelo en vez de guardados dos veces.
-- =============================================================================

-- Placas con su estado como lo muestra la app (online / in_call / offline).
CREATE VIEW v_devices AS
SELECT d.*,
       EXISTS (SELECT 1 FROM device_connections c
               WHERE c.device_id = d.id AND c.disconnected_at IS NULL) AS online,
       EXISTS (SELECT 1 FROM device_connections c
               WHERE c.device_id = d.id AND c.channel = 'camera' AND c.disconnected_at IS NULL) AS camera_online,
       CASE
           WHEN EXISTS (SELECT 1 FROM conversations s
                        WHERE s.device_id = d.id AND s.ended_at IS NULL) THEN 'in_call'
           WHEN EXISTS (SELECT 1 FROM device_connections c
                        WHERE c.device_id = d.id AND c.disconnected_at IS NULL) THEN 'idle'
           ELSE 'offline'
       END AS status,
       (SELECT MAX(COALESCE(c.disconnected_at, NOW())) FROM device_connections c
        WHERE c.device_id = d.id) AS last_seen_at,
       (SELECT c.firmware_version FROM device_connections c
        WHERE c.device_id = d.id AND c.channel = 'voice' AND c.firmware_version IS NOT NULL
        ORDER BY c.connected_at DESC LIMIT 1) AS firmware_version
FROM devices d;

-- Tipo de imagen deducido de los primeros bytes (igual que detectImageMime).
CREATE VIEW v_face_photos AS
SELECT member_id, photo, uploaded_at, octet_length(photo) AS size_bytes,
       CASE WHEN substring(photo FROM 1 FOR 3) = '\xffd8ff'::bytea THEN 'image/jpeg'
            ELSE 'image/png' END AS mime
FROM face_photos;

-- Sesiones con su hogar, modo, canal y resultado.
CREATE VIEW v_conversations AS
SELECT c.*,
       sr.mode,
       CASE WHEN c.device_id IS NOT NULL THEN 'device' ELSE 'web' END AS channel,
       COALESCE(d.home_id, hm.home_id) AS home_id,
       CASE WHEN c.ended_at IS NULL THEN 'active' ELSE er.outcome END AS outcome
FROM conversations c
JOIN session_reasons sr        ON sr.code = c.reason
LEFT JOIN end_reasons er       ON er.code = c.end_reason
LEFT JOIN devices d            ON d.id = c.device_id
LEFT JOIN users u              ON u.id = c.user_id
LEFT JOIN household_members hm ON hm.id = u.member_id;

-- Cada periodo en que la puerta estuvo abierta y cuánto duró.
CREATE VIEW v_door_open_periods AS
SELECT component_id, opened_at, closed_at,
       EXTRACT(EPOCH FROM COALESCE(closed_at, NOW()) - opened_at)::int AS open_seconds
FROM (
    SELECT component_id, state, occurred_at AS opened_at,
           LEAD(occurred_at) OVER (PARTITION BY component_id ORDER BY occurred_at) AS closed_at
    FROM door_events
) e
WHERE state = 'open';

-- Flags con el hogar al que pertenecen (deducido de su causa).
CREATE VIEW v_flags AS
SELECT f.*, COALESCE(c.home_id, cc.home_id, fc.home_id, d.home_id) AS home_id
FROM flags f
LEFT JOIN v_conversations c      ON c.id = f.conversation_id
LEFT JOIN consults co            ON co.id = f.consult_id
LEFT JOIN v_conversations cc     ON cc.id = co.doorbell_conversation_id
LEFT JOIN face_verifications fv  ON fv.id = f.face_verification_id
LEFT JOIN v_conversations fc     ON fc.id = fv.conversation_id
LEFT JOIN door_events de         ON de.id = f.door_event_id
LEFT JOIN person_detections pd   ON pd.id = f.person_detection_id
LEFT JOIN actuator_commands ac   ON ac.id = f.actuator_command_id
LEFT JOIN device_connections dcn ON dcn.id = f.device_connection_id
LEFT JOIN device_components dc   ON dc.id = COALESCE(de.component_id, pd.component_id, ac.component_id)
LEFT JOIN devices d              ON d.id = COALESCE(dcn.device_id, dc.device_id);
