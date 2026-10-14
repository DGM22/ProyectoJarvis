#include <Arduino.h>
#include <Wire.h>
#include "driver/i2s.h"
#include <math.h>

// ============================================================
// OLED
// ============================================================

#define OLED_SDA 41
#define OLED_SCL 42

// ============================================================
// BOTON
// ============================================================

#define BUTTON_PIN 38

// ============================================================
// MICROFONO I2S
// ============================================================

#define MIC_I2S_PORT I2S_NUM_0

#define MIC_SCK 40
#define MIC_WS  39
#define MIC_SD  21

// ============================================================
// AMPLIFICADOR MAX98357A
// ============================================================

#define AMP_I2S_PORT I2S_NUM_1

#define AMP_BCLK 47
#define AMP_LRC  48
#define AMP_DIN  1   // No usar GPIO45: es pin de arranque (voltaje de flash) y bloquea la subida

// ============================================================
// OLED TEST
// ============================================================

bool testOLED()
{
    Serial.println();
    Serial.println("========== OLED ==========");

    Wire.begin(OLED_SDA, OLED_SCL);

    bool found = false;

    for (uint8_t address = 1; address < 127; address++)
    {
        Wire.beginTransmission(address);

        uint8_t error = Wire.endTransmission();

        if (error == 0)
        {
            Serial.print("Dispositivo I2C encontrado: 0x");

            if (address < 16)
                Serial.print("0");

            Serial.println(address, HEX);

            found = true;
        }
    }

    if (!found)
    {
        Serial.println("ERROR: no se detecto ningun dispositivo I2C");
        return false;
    }

    Serial.println("OLED/I2C detectado");

    return true;
}

// ============================================================
// MICROFONO
// ============================================================

bool setupMicrophone()
{
    Serial.println();
    Serial.println("========== MICROFONO ==========");

    i2s_config_t micConfig = {
        .mode = (i2s_mode_t)(
            I2S_MODE_MASTER |
            I2S_MODE_RX
        ),

        .sample_rate = 16000,

        .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,

        .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,

        .communication_format = I2S_COMM_FORMAT_STAND_I2S,

        .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,

        .dma_buf_count = 8,

        .dma_buf_len = 128,

        .use_apll = false,

        .tx_desc_auto_clear = false,

        .fixed_mclk = 0
    };

    i2s_pin_config_t micPins = {
        .bck_io_num = MIC_SCK,

        .ws_io_num = MIC_WS,

        .data_out_num = I2S_PIN_NO_CHANGE,

        .data_in_num = MIC_SD
    };

    esp_err_t result;

    result = i2s_driver_install(
        MIC_I2S_PORT,
        &micConfig,
        0,
        nullptr
    );

    if (result != ESP_OK)
    {
        Serial.printf(
            "ERROR instalando I2S microfono: %d\n",
            result
        );

        return false;
    }

    result = i2s_set_pin(
        MIC_I2S_PORT,
        &micPins
    );

    if (result != ESP_OK)
    {
        Serial.printf(
            "ERROR configurando pines microfono: %d\n",
            result
        );

        return false;
    }

    Serial.println("I2S del microfono iniciado");

    return true;
}

// ============================================================
// MAX98357A
// ============================================================

bool setupSpeaker()
{
    Serial.println();
    Serial.println("========== ALTAVOZ ==========");

    i2s_config_t speakerConfig = {
        .mode = (i2s_mode_t)(
            I2S_MODE_MASTER |
            I2S_MODE_TX
        ),

        .sample_rate = 16000,

        .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,

        .channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT,

        .communication_format = I2S_COMM_FORMAT_STAND_I2S,

        .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,

        .dma_buf_count = 8,

        .dma_buf_len = 128,

        .use_apll = false,

        .tx_desc_auto_clear = true,

        .fixed_mclk = 0
    };

    i2s_pin_config_t speakerPins = {
        .bck_io_num = AMP_BCLK,

        .ws_io_num = AMP_LRC,

        .data_out_num = AMP_DIN,

        .data_in_num = I2S_PIN_NO_CHANGE
    };

    esp_err_t result;

    result = i2s_driver_install(
        AMP_I2S_PORT,
        &speakerConfig,
        0,
        nullptr
    );

    if (result != ESP_OK)
    {
        Serial.printf(
            "ERROR instalando I2S altavoz: %d\n",
            result
        );

        return false;
    }

    result = i2s_set_pin(
        AMP_I2S_PORT,
        &speakerPins
    );

    if (result != ESP_OK)
    {
        Serial.printf(
            "ERROR configurando MAX98357A: %d\n",
            result
        );

        return false;
    }

    Serial.println("I2S del altavoz iniciado");

    return true;
}

// ============================================================
// GENERAR TONO
// ============================================================

void playTone(float frequency, int durationMs)
{
    const int sampleRate = 16000;

    const int samples =
        sampleRate * durationMs / 1000;

    const float amplitude = 5000.0;

    for (int i = 0; i < samples; i++)
    {
        float t =
            (float)i / sampleRate;

        int16_t sample =
            (int16_t)(
                amplitude *
                sinf(
                    2.0f *
                    PI *
                    frequency *
                    t
                )
            );

        int16_t stereo[2];

        stereo[0] = sample;
        stereo[1] = sample;

        size_t bytesWritten = 0;

        // Sin este tope, un I2S que no drena deja el diagnóstico congelado
        // y el USB deja de aceptar un nuevo flasheo.
        esp_err_t result = i2s_write(
            AMP_I2S_PORT,
            stereo,
            sizeof(stereo),
            &bytesWritten,
            20 / portTICK_PERIOD_MS
        );

        if (result != ESP_OK || bytesWritten != sizeof(stereo))
        {
            Serial.println("ALTAVOZ: el I2S no acepto la muestra");
            break;
        }
    }

    i2s_zero_dma_buffer(
        AMP_I2S_PORT
    );
}

// ============================================================
// LEER MICROFONO
// ============================================================

void readMicrophone()
{
    int32_t samples[256];

    size_t bytesRead = 0;

    i2s_read(
        MIC_I2S_PORT,
        samples,
        sizeof(samples),
        &bytesRead,
        100 / portTICK_PERIOD_MS
    );

    int count =
        bytesRead / sizeof(int32_t);

    if (count <= 0)
    {
        Serial.println(
            "MIC: no se recibieron muestras"
        );

        return;
    }

    int64_t total = 0;

    int32_t maxSample = 0;

    for (int i = 0; i < count; i++)
    {
        int32_t sample =
            samples[i] >> 14;

        int32_t absoluteSample =
            abs(sample);

        total += absoluteSample;

        if (absoluteSample > maxSample)
        {
            maxSample =
                absoluteSample;
        }
    }

    int32_t average =
        total / count;

    Serial.printf(
        "MIC nivel: %ld | pico: %ld\n",
        (long)average,
        (long)maxSample
    );
}

// ============================================================
// SETUP
// ============================================================

void setup()
{
    Serial.begin(115200);

    delay(2000);

    Serial.println();
    Serial.println();
    Serial.println("======================================");
    Serial.println(" DIAGNOSTICO ESP32-S3 JARVIS");
    Serial.println("======================================");

    // --------------------------------------------------------
    // BOTON
    // --------------------------------------------------------

    pinMode(
        BUTTON_PIN,
        INPUT_PULLUP
    );

    Serial.println();
    Serial.println("========== BOTON ==========");
    Serial.println("Boton configurado en GPIO 38");

    // --------------------------------------------------------
    // OLED
    // --------------------------------------------------------

    bool oledOK =
        testOLED();

    // --------------------------------------------------------
    // MICROFONO
    // --------------------------------------------------------

    bool micOK =
        setupMicrophone();

    // --------------------------------------------------------
    // ALTAVOZ
    // --------------------------------------------------------

    bool speakerOK =
        setupSpeaker();

    // --------------------------------------------------------
    // RESULTADOS
    // --------------------------------------------------------

    Serial.println();
    Serial.println("======================================");
    Serial.println(" RESULTADOS");
    Serial.println("======================================");

    Serial.print("OLED: ");

    if (oledOK)
        Serial.println("OK");
    else
        Serial.println("ERROR");

    Serial.print("MIC I2S: ");

    if (micOK)
        Serial.println("INICIADO");
    else
        Serial.println("ERROR");

    Serial.print("MAX98357A I2S: ");

    if (speakerOK)
        Serial.println("INICIADO");
    else
        Serial.println("ERROR");

    // --------------------------------------------------------
    // TONO
    // --------------------------------------------------------

    if (speakerOK)
    {
        Serial.println();
        Serial.println(
            "Reproduciendo tono de prueba..."
        );

        playTone(
            440,
            1000
        );

        delay(300);

        playTone(
            880,
            500
        );

        Serial.println(
            "Prueba de altavoz terminada"
        );
    }

    Serial.println();
    Serial.println(
        "Habla al microfono y presiona el boton."
    );

    Serial.println();
}

// ============================================================
// LOOP
// ============================================================

void loop()
{
    // --------------------------------------------------------
    // BOTON
    // --------------------------------------------------------

    static bool lastButton =
        HIGH;

    bool currentButton =
        digitalRead(BUTTON_PIN);

    if (
        currentButton == LOW &&
        lastButton == HIGH
    )
    {
        Serial.println();
        Serial.println(
            ">>> BOTON PRESIONADO <<<"
        );

        // tono cada vez que presionas
        playTone(
            1000,
            150
        );
    }

    lastButton =
        currentButton;

    // --------------------------------------------------------
    // MICROFONO
    // --------------------------------------------------------

    readMicrophone();

    delay(100);
}
