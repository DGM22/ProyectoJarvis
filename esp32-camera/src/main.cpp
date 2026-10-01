#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebSocketsClient.h>
#include <time.h>
#include "esp_camera.h"
#include "img_converters.h"
#include "robot_eyes.h"
#include "secrets.h"

static constexpr int JPEG_QUALITY = 40;
static constexpr int XCLK_HZ = 20000000;
/** Tope de subida al backend; el encode software del GC0308 ronda esto. */
static constexpr uint32_t MIN_FRAME_GAP_MS = 80;

#define PWDN_GPIO_NUM -1
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 15
#define SIOD_GPIO_NUM 4
#define SIOC_GPIO_NUM 5
#define Y2_GPIO_NUM 11
#define Y3_GPIO_NUM 9
#define Y4_GPIO_NUM 8
#define Y5_GPIO_NUM 10
#define Y6_GPIO_NUM 12
#define Y7_GPIO_NUM 18
#define Y8_GPIO_NUM 17
#define Y9_GPIO_NUM 16
#define VSYNC_GPIO_NUM 6
#define HREF_GPIO_NUM 7
#define PCLK_GPIO_NUM 13

#define OLED_SDA_PIN 41
#define OLED_SCL_PIN 42

/** Botón a GND (pull-up interno). */
#define BUTTON_PIN 14

static constexpr int kReservedPins[] = {
    XCLK_GPIO_NUM, SIOD_GPIO_NUM, SIOC_GPIO_NUM, Y2_GPIO_NUM,   Y3_GPIO_NUM,
    Y4_GPIO_NUM,   Y5_GPIO_NUM,   Y6_GPIO_NUM,   Y7_GPIO_NUM,   Y8_GPIO_NUM,
    Y9_GPIO_NUM,   VSYNC_GPIO_NUM, HREF_GPIO_NUM, PCLK_GPIO_NUM, OLED_SDA_PIN,
    OLED_SCL_PIN,
};

// C++11 (toolchain Arduino 2.x): constexpr de un solo return.
static constexpr bool isReservedPin(int pin, size_t i = 0)
{
    return i < sizeof(kReservedPins) / sizeof(kReservedPins[0]) &&
           (kReservedPins[i] == pin || isReservedPin(pin, i + 1));
}

static_assert(!isReservedPin(BUTTON_PIN), "BUTTON_PIN choca con la cámara o la OLED");
static constexpr uint32_t BUTTON_DEBOUNCE_MS = 30;

static WebSocketsClient webSocket;
static volatile bool wsConnected = false;
static volatile bool streamEnabled = false;
static bool cameraReady = false;
static bool ntpDone = false;
static bool backendStarted = false;

static void sendHello()
{
    webSocket.sendTXT(
        "{\"type\":\"hello\",\"firmwareVersion\":\"0.4.0\",\"capabilities\":[\"camera\"]}");
}

static void handleServerText(const char *json)
{
    if (strstr(json, "stream.on") != nullptr) {
        streamEnabled = true;
        Serial.println("stream.on");
        return;
    }
    if (strstr(json, "stream.off") != nullptr) {
        streamEnabled = false;
        Serial.println("stream.off");
        return;
    }
    if (strstr(json, "hello.ack") != nullptr) {
        Serial.println("hello.ack");
    }
}

static void onWsEvent(WStype_t type, uint8_t *payload, size_t length)
{
    switch (type) {
    case WStype_DISCONNECTED:
        wsConnected = false;
        streamEnabled = false;
        Serial.println("WS desconectado");
        break;
    case WStype_CONNECTED:
        wsConnected = true;
        Serial.printf("WS conectado a %s\n", JARVIS_BACKEND_HOST);
        sendHello();
        break;
    case WStype_TEXT: {
        char buf[256];
        const size_t n = length < sizeof(buf) - 1 ? length : sizeof(buf) - 1;
        memcpy(buf, payload, n);
        buf[n] = '\0';
        handleServerText(buf);
        break;
    }
    default:
        break;
    }
}

static void waitForNtp()
{
    configTime(0, 0, "time.google.com", "pool.ntp.org");
    Serial.print("NTP");
    for (int i = 0; i < 40; i++) {
        time_t now = time(nullptr);
        if (now > 1700000000) {
            Serial.println(" ok");
            return;
        }
        Serial.print(".");
        delay(250);
    }
    Serial.println(" timeout (TLS puede fallar)");
}

static bool initCamera()
{
    camera_config_t config = {};
    config.ledc_channel = LEDC_CHANNEL_0;
    config.ledc_timer = LEDC_TIMER_0;
    config.pin_d0 = Y2_GPIO_NUM;
    config.pin_d1 = Y3_GPIO_NUM;
    config.pin_d2 = Y4_GPIO_NUM;
    config.pin_d3 = Y5_GPIO_NUM;
    config.pin_d4 = Y6_GPIO_NUM;
    config.pin_d5 = Y7_GPIO_NUM;
    config.pin_d6 = Y8_GPIO_NUM;
    config.pin_d7 = Y9_GPIO_NUM;
    config.pin_xclk = XCLK_GPIO_NUM;
    config.pin_pclk = PCLK_GPIO_NUM;
    config.pin_vsync = VSYNC_GPIO_NUM;
    config.pin_href = HREF_GPIO_NUM;
    config.pin_sccb_sda = SIOD_GPIO_NUM;
    config.pin_sccb_scl = SIOC_GPIO_NUM;
    config.pin_pwdn = PWDN_GPIO_NUM;
    config.pin_reset = RESET_GPIO_NUM;
    config.xclk_freq_hz = XCLK_HZ;
    config.pixel_format = PIXFORMAT_RGB565;
    config.frame_size = FRAMESIZE_QVGA;
    config.jpeg_quality = 12;
    config.fb_count = 2;
    config.fb_location = CAMERA_FB_IN_PSRAM;
    config.grab_mode = CAMERA_GRAB_LATEST;

    const esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        Serial.printf("ERROR iniciando cámara: 0x%x\n", err);
        return false;
    }

    sensor_t *s = esp_camera_sensor_get();
    if (s != nullptr) {
        Serial.printf("Sensor PID: 0x%04X\n", s->id.PID);
    }
    Serial.println("Camara OK");
    return true;
}

static void startWifi()
{
    WiFi.persistent(false);
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    Serial.println("WiFi conectando…");
}

static void maintainWifi()
{
    static uint32_t lastAttemptMs = 0;
    if (WiFi.status() == WL_CONNECTED) {
        return;
    }

    const uint32_t now = millis();
    if (now - lastAttemptMs < 8000) {
        return;
    }
    lastAttemptMs = now;
    Serial.println("WiFi reintento");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
}

static void connectBackend()
{
    char path[192];
    snprintf(path, sizeof(path), "/camera?token=%s", JARVIS_DEVICE_TOKEN);

    Serial.printf("Backend wss://%s:%d%s\n", JARVIS_BACKEND_HOST,
                  JARVIS_BACKEND_PORT, path);

    webSocket.onEvent(onWsEvent);
    webSocket.setReconnectInterval(5000);

#if JARVIS_USE_TLS
    // Sin fingerprint, WebSockets 2.4.1 llama setInsecure() en WiFiClientSecure.
    webSocket.beginSSL(JARVIS_BACKEND_HOST, JARVIS_BACKEND_PORT, path);
#else
    webSocket.begin(JARVIS_BACKEND_HOST, JARVIS_BACKEND_PORT, path);
#endif
}

/** Dispara la animación al presionar (flanco HIGH→LOW estable). */
static void pollButton()
{
    static bool stableLevel = HIGH;
    static bool lastReading = HIGH;
    static uint32_t lastChangeMs = 0;

    const bool reading = digitalRead(BUTTON_PIN);
    const uint32_t now = millis();
    if (reading != lastReading) {
        lastReading = reading;
        lastChangeMs = now;
        return;
    }
    if (reading == stableLevel || now - lastChangeMs < BUTTON_DEBOUNCE_MS) {
        return;
    }

    stableLevel = reading;
    if (stableLevel == LOW) {
        Serial.println("boton: ojos felices");
        robotEyesPlayHappy();
    }
}

static void uploadFrame()
{
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
        return;
    }

    uint8_t *jpg_buf = nullptr;
    size_t jpg_len = 0;
    const bool ok = frame2jpg(fb, JPEG_QUALITY, &jpg_buf, &jpg_len);
    esp_camera_fb_return(fb);

    if (!ok || jpg_buf == nullptr || jpg_len == 0) {
        return;
    }

    webSocket.sendBIN(jpg_buf, jpg_len);
    free(jpg_buf);
}

void setup()
{
    Serial.begin(115200);
    // En este core Serial es UART0. setTxTimeoutMs solo existe en HWCDC/USBCDC
    // (ARDUINO_USB_CDC_ON_BOOT=1): sin monitor, el CDC no debe frenar el arranque.
#if ARDUINO_USB_CDC_ON_BOOT
    Serial.setTxTimeoutMs(0);
#endif
    delay(200);
    Serial.println();
    Serial.println("ESP32-S3 CAMERA → jarvis.gms-app.com");

    if (strcmp(JARVIS_DEVICE_TOKEN, "jdv_replace_me") == 0) {
        Serial.println("FALTA TOKEN: crea un dispositivo en Config y pégalo en secrets.h");
    }

    if (psramFound()) {
        Serial.printf("PSRAM: %.2f MB\n", ESP.getPsramSize() / 1024.0 / 1024.0);
    } else {
        Serial.println("PSRAM NO encontrada");
    }

    // cam_task tiene ~2 KB de stack: un warning de log de cam_hal (p. ej. frames
    // perdidos al arrancar) lo desborda y reinicia la placa.
    esp_log_level_set("cam_hal", ESP_LOG_NONE);

    pinMode(BUTTON_PIN, INPUT_PULLUP);
    robotEyesBegin(OLED_SDA_PIN, OLED_SCL_PIN);
    cameraReady = initCamera();
    startWifi();
}

void loop()
{
    if (!cameraReady) {
        static uint32_t lastCamMs = 0;
        const uint32_t now = millis();
        if (now - lastCamMs > 5000) {
            lastCamMs = now;
            esp_camera_deinit();
            cameraReady = initCamera();
        }
    }

    maintainWifi();

    if (WiFi.status() == WL_CONNECTED) {
        static bool wifiLogged = false;
        if (!wifiLogged) {
            wifiLogged = true;
            Serial.print("WiFi IP ");
            Serial.println(WiFi.localIP());
        }
        if (!ntpDone) {
            waitForNtp();
            ntpDone = true;
        }
        if (!backendStarted) {
            connectBackend();
            backendStarted = true;
        }
    }

    if (backendStarted) {
        webSocket.loop();
    }

    pollButton();

    if (!wsConnected) {
        robotEyesSetMood(EyesMood::Connecting);
    } else {
        robotEyesSetMood(streamEnabled ? EyesMood::Watching : EyesMood::Idle);
    }

    static uint32_t lastFrameMs = 0;
    static uint32_t frames = 0;
    static uint32_t windowStart = 0;

    if (!wsConnected || !streamEnabled || !cameraReady) {
        delay(20);
        return;
    }

    const uint32_t now = millis();
    if (now - lastFrameMs < MIN_FRAME_GAP_MS) {
        return;
    }
    lastFrameMs = now;

    if (windowStart == 0) {
        windowStart = now;
    }

    uploadFrame();
    frames++;
    if (frames >= 50) {
        const uint32_t elapsed = now - windowStart;
        if (elapsed > 0) {
            Serial.printf("uplink FPS: %.1f\n", frames * 1000.0f / elapsed);
        }
        frames = 0;
        windowStart = now;
    }
}
