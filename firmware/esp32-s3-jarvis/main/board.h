#pragma once

#include "driver/gpio.h"
#include "driver/i2c_master.h"

/*
 * Pinout Waveshare ESP32-S3-ePaper-1.54 (V1 y V2).
 * Fuente: user_config.h + board_cfg.txt del repo oficial
 * github.com/waveshareteam/ESP32-S3-ePaper-1.54
 */

/* E-paper SSD1681 200x200 (SPI) */
#define BOARD_EPD_DC GPIO_NUM_10
#define BOARD_EPD_CS GPIO_NUM_11
#define BOARD_EPD_SCK GPIO_NUM_12
#define BOARD_EPD_MOSI GPIO_NUM_13
#define BOARD_EPD_RST GPIO_NUM_9
#define BOARD_EPD_BUSY GPIO_NUM_8

/* Rieles de alimentación: EPD y audio son activos en BAJO. */
#define BOARD_EPD_PWR GPIO_NUM_6
#define BOARD_AUDIO_PWR GPIO_NUM_42
#define BOARD_VBAT_PWR GPIO_NUM_17 /* ALTO = mantener encendido con batería */

/* Botones (activos en bajo) */
#define BOARD_BOOT_BUTTON GPIO_NUM_0
#define BOARD_PWR_BUTTON GPIO_NUM_18

/* I2C compartido: ES8311 (0x18), RTC PCF85063 (0x51), SHTC3 (0x70) */
#define BOARD_I2C_PORT I2C_NUM_0
#define BOARD_I2C_SDA GPIO_NUM_47
#define BOARD_I2C_SCL GPIO_NUM_48

/* Codec ES8311 (mic + speaker) */
#define BOARD_I2S_MCLK GPIO_NUM_14
#define BOARD_I2S_BCLK GPIO_NUM_15
#define BOARD_I2S_WS GPIO_NUM_38
#define BOARD_I2S_DOUT GPIO_NUM_45 /* ESP → codec (speaker) */
#define BOARD_I2S_DIN GPIO_NUM_16  /* codec → ESP (mic) */
#define BOARD_PA_EN GPIO_NUM_46    /* amplificador, activo en alto */

/** Enciende rieles de EPD/audio y el latch de batería. */
void board_power_init(void);

/** Bus I2C maestro compartido (se crea en la primera llamada). */
i2c_master_bus_handle_t board_i2c_bus(void);
