-- =============================================================================
-- Consultas de los indicadores del proyecto (sección "Diseño Interactivo").
-- Las fechas se guardan en UTC; aquí se convierten a hora de Monterrey.
-- Usan las vistas de schema.sql para los datos deducidos (hogar, duración...).
-- =============================================================================

-- Par 1 · Micrófono/Bocina: respuestas efectivas de la IA por día del mes.
-- Gráfica de barras.
SELECT date_trunc('day', started_at AT TIME ZONE 'America/Monterrey')::date AS dia,
       COUNT(*) FILTER (WHERE outcome = 'completed') AS respuestas_efectivas,
       COUNT(*)                                      AS total
FROM v_conversations
WHERE mode = 'doorbell'
  AND started_at >= date_trunc('month', NOW())
GROUP BY 1 ORDER BY 1;

-- Par 2 · Cámara/LED: detecciones de persona por hora del día. Histograma.
SELECT EXTRACT(HOUR FROM detected_at AT TIME ZONE 'America/Monterrey')::int AS hora,
       COUNT(*) AS detecciones
FROM person_detections
GROUP BY 1 ORDER BY 1;

-- Par 3 · Luz ambiental/Foco: promedio de luxes por hora. Gráfica de líneas.
SELECT date_trunc('hour', r.recorded_at AT TIME ZONE 'America/Monterrey') AS hora,
       ROUND(AVG(r.value), 1) AS lux_promedio
FROM sensor_readings r
JOIN device_components c ON c.id = r.component_id AND c.kind = 'light_sensor'
GROUP BY 1 ORDER BY 1;

-- Par 3 · % de la noche (19:00–07:00) con el foco encendido.
WITH cambios AS (
    SELECT a.command, a.created_at,
           LEAD(a.created_at, 1, NOW()) OVER (ORDER BY a.created_at) AS hasta
    FROM actuator_commands a
    JOIN device_components c ON c.id = a.component_id AND c.kind = 'light'
    WHERE a.status = 'success'
)
SELECT ROUND(100.0 * SUM(EXTRACT(EPOCH FROM hasta - created_at)) FILTER (WHERE command = 'on')
             / NULLIF(SUM(EXTRACT(EPOCH FROM hasta - created_at)), 0), 1) AS pct_encendido
FROM cambios
WHERE EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Monterrey') >= 19
   OR EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Monterrey') < 7;

-- Par 4 · Sensor magnético: tiempo que la puerta queda abierta, por hora.
SELECT EXTRACT(HOUR FROM opened_at AT TIME ZONE 'America/Monterrey')::int AS hora,
       ROUND(AVG(open_seconds) / 60.0, 1) AS minutos_abierta_promedio,
       MAX(open_seconds) / 60             AS minutos_abierta_max
FROM v_door_open_periods
WHERE closed_at IS NOT NULL
GROUP BY 1 ORDER BY 1;

-- Par 4 · Servo: % de cierres de seguridad exitosos.
SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE a.status = 'success') / NULLIF(COUNT(*), 0), 1) AS pct_cierres_ok
FROM actuator_commands a
JOIN device_components c ON c.id = a.component_id AND c.kind = 'servo_lock'
WHERE a.command = 'lock';

-- Flags · Alertas abiertas del hogar 1, las críticas primero.
SELECT id, flag_type, severity, message, created_at
FROM v_flags
WHERE home_id = 1 AND status <> 'resolved'
ORDER BY (severity = 'critical') DESC, created_at DESC;

-- Reconocimiento · Intentos de verificación facial por resultado (último mes).
SELECT status, COUNT(*) AS intentos, ROUND(AVG(similarity), 1) AS similitud_promedio
FROM face_verifications
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY status ORDER BY intentos DESC;

-- Timbre · Consultas al dueño: cuántas contestó y en cuánto tiempo.
SELECT status, COUNT(*) AS consultas,
       ROUND(AVG(EXTRACT(EPOCH FROM answered_at - rang_at))::numeric, 1) AS segundos_en_contestar
FROM consults
GROUP BY status ORDER BY consultas DESC;

-- Placas · Estado actual (como lo muestra la app).
SELECT id, name, token_prefix, status, online, camera_online, firmware_version, last_seen_at
FROM v_devices ORDER BY id;

-- Flags · Conversaciones colgadas: activas y sin mensajes hace más de 2 min.
-- (El backend la correría cada minuto para crear el flag 'unanswered_chat'.)
SELECT c.id, c.reason, c.started_at, MAX(m.created_at) AS ultimo_mensaje
FROM conversations c
LEFT JOIN messages m ON m.conversation_id = c.id
WHERE c.ended_at IS NULL
GROUP BY c.id
HAVING COALESCE(MAX(m.created_at), c.started_at) < NOW() - INTERVAL '2 minutes';

-- Flags · Puertas abiertas más del límite de su hogar (flag 'door_left_open').
SELECT p.component_id, p.opened_at, p.open_seconds / 60 AS minutos
FROM v_door_open_periods p
JOIN device_components dc ON dc.id = p.component_id
JOIN devices d            ON d.id = dc.device_id
JOIN homes h              ON h.id = d.home_id
WHERE p.closed_at IS NULL
  AND p.open_seconds > h.door_open_alert_minutes * 60;
