#include <Arduino.h>
#include <Wire.h>

#define SDA_PIN 41
#define SCL_PIN 42

// Repite el escaneo: el monitor serie suele conectarse después del reset
// y se perdería un escaneo único hecho en setup().
static const uint32_t SCAN_EVERY_MS = 5000;

static void scanI2C() {
  Serial.println("Escaneando I2C...");

  int encontrados = 0;

  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    uint8_t error = Wire.endTransmission();

    if (error == 0) {
      Serial.print("Dispositivo encontrado en 0x");
      if (addr < 16) Serial.print("0");
      Serial.println(addr, HEX);
      encontrados++;
    }
  }

  if (encontrados == 0) {
    Serial.println("No se encontro ningun dispositivo I2C");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Wire.begin(SDA_PIN, SCL_PIN);
}

void loop() {
  scanI2C();
  delay(SCAN_EVERY_MS);
}
