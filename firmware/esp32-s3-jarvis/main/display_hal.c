#include "display_hal.h"

#include <string.h>

#include "board.h"
#include "driver/spi_master.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "display_hal";

#define FB_W 200
#define FB_H 200
#define FB_BYTES ((FB_W * FB_H) / 8)
/* Refresh completo cada N parciales para limpiar el ghosting del e-ink. */
#define FULL_REFRESH_EVERY 20

static uint8_t s_fb[FB_BYTES];
static spi_device_handle_t s_spi;
static TaskHandle_t s_task = NULL;
static volatile display_state_t s_state = DISPLAY_STATE_IDLE;
static volatile display_state_t s_requested = DISPLAY_STATE_IDLE;

/* ---------- SSD1681 (port del driver oficial de Waveshare) ---------- */

static const uint8_t LUT_FULL[159] = {
    0x80, 0x48, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x40, 0x48, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x80, 0x48, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x40, 0x48, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x01, 0x00, 0x08, 0x01,
    0x00, 0x02, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x00, 0x00, 0x00, 0x22, 0x17, 0x41,
    0x00, 0x32, 0x20,
};

static const uint8_t LUT_PARTIAL[159] = {
    0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x80, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x40, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x0F, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x00, 0x00, 0x00, 0x02, 0x17, 0x41,
    0xB0, 0x32, 0x28,
};

static void epd_wait_busy(void)
{
    /* BUSY en alto = ocupado. Timeout para no colgar la task si falta el panel. */
    for (int i = 0; i < 1000 && gpio_get_level(BOARD_EPD_BUSY) == 1; i++) {
        vTaskDelay(pdMS_TO_TICKS(5));
    }
}

static void epd_write(bool is_data, const uint8_t *buf, size_t len)
{
    gpio_set_level(BOARD_EPD_DC, is_data ? 1 : 0);
    gpio_set_level(BOARD_EPD_CS, 0);
    spi_transaction_t t = {
        .length = 8 * len,
        .tx_buffer = buf,
    };
    ESP_ERROR_CHECK(spi_device_polling_transmit(s_spi, &t));
    gpio_set_level(BOARD_EPD_CS, 1);
}

static void epd_cmd(uint8_t cmd)
{
    epd_write(false, &cmd, 1);
}

static void epd_data(uint8_t d)
{
    epd_write(true, &d, 1);
}

static void epd_reset(void)
{
    gpio_set_level(BOARD_EPD_RST, 1);
    vTaskDelay(pdMS_TO_TICKS(50));
    gpio_set_level(BOARD_EPD_RST, 0);
    vTaskDelay(pdMS_TO_TICKS(20));
    gpio_set_level(BOARD_EPD_RST, 1);
    vTaskDelay(pdMS_TO_TICKS(50));
    epd_wait_busy();
}

static void epd_set_lut(const uint8_t *lut)
{
    epd_cmd(0x32);
    epd_write(true, lut, 153);
    epd_wait_busy();
    epd_cmd(0x3F);
    epd_data(lut[153]);
    epd_cmd(0x03);
    epd_data(lut[154]);
    epd_cmd(0x04);
    epd_data(lut[155]);
    epd_data(lut[156]);
    epd_data(lut[157]);
    epd_cmd(0x2C);
    epd_data(lut[158]);
}

static void epd_init_full(void)
{
    epd_reset();
    epd_cmd(0x12); /* SWRESET */
    epd_wait_busy();

    epd_cmd(0x01); /* driver output control */
    epd_data(0xC7);
    epd_data(0x00);
    epd_data(0x01);

    epd_cmd(0x11); /* data entry mode: X+, Y- */
    epd_data(0x01);

    epd_cmd(0x44); /* RAM X start/end */
    epd_data(0x00);
    epd_data((FB_W - 1) >> 3);
    epd_cmd(0x45); /* RAM Y start/end */
    epd_data((FB_H - 1) & 0xFF);
    epd_data((FB_H - 1) >> 8);
    epd_data(0x00);
    epd_data(0x00);

    epd_cmd(0x3C); /* border waveform */
    epd_data(0x01);
    epd_cmd(0x18); /* sensor interno de temperatura */
    epd_data(0x80);
    epd_cmd(0x22);
    epd_data(0xB1);
    epd_cmd(0x20);

    epd_cmd(0x4E);
    epd_data(0x00);
    epd_cmd(0x4F);
    epd_data((FB_H - 1) & 0xFF);
    epd_data((FB_H - 1) >> 8);
    epd_wait_busy();

    epd_set_lut(LUT_FULL);
}

static void epd_init_partial(void)
{
    epd_reset();
    epd_set_lut(LUT_PARTIAL);
    epd_cmd(0x37);
    const uint8_t opt[10] = {0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00};
    epd_write(true, opt, sizeof(opt));
    epd_cmd(0x3C);
    epd_data(0x80);
    epd_cmd(0x22);
    epd_data(0xC0);
    epd_cmd(0x20);
    epd_wait_busy();
}

/** Refresh completo: escribe ambas RAMs (base para parciales) y deja modo parcial. */
static void epd_show_full(void)
{
    epd_init_full();
    epd_cmd(0x24);
    epd_write(true, s_fb, FB_BYTES);
    epd_cmd(0x26);
    epd_write(true, s_fb, FB_BYTES);
    epd_cmd(0x22);
    epd_data(0xC7);
    epd_cmd(0x20);
    epd_wait_busy();
    epd_init_partial();
}

static void epd_show_partial(void)
{
    epd_cmd(0x24);
    epd_write(true, s_fb, FB_BYTES);
    epd_cmd(0x22);
    epd_data(0xCF);
    epd_cmd(0x20);
    epd_wait_busy();
}

static void epd_hw_init(void)
{
    spi_bus_config_t bus = {
        .mosi_io_num = BOARD_EPD_MOSI,
        .miso_io_num = -1,
        .sclk_io_num = BOARD_EPD_SCK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = FB_BYTES,
    };
    ESP_ERROR_CHECK(spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO));
    spi_device_interface_config_t dev = {
        .clock_speed_hz = 20 * 1000 * 1000,
        .mode = 0,
        .spics_io_num = -1, /* CS manual: comando y datos van en transacciones separadas */
        .queue_size = 4,
    };
    ESP_ERROR_CHECK(spi_bus_add_device(SPI2_HOST, &dev, &s_spi));

    gpio_config_t out = {
        .pin_bit_mask = (1ULL << BOARD_EPD_RST) | (1ULL << BOARD_EPD_DC) | (1ULL << BOARD_EPD_CS),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&out));
    gpio_config_t in = {
        .pin_bit_mask = 1ULL << BOARD_EPD_BUSY,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&in));
    gpio_set_level(BOARD_EPD_CS, 1);
}

/* ---------- Framebuffer 1-bit (1 = blanco) ---------- */

static void fb_clear(void)
{
    memset(s_fb, 0xFF, sizeof(s_fb));
}

static void fb_set_pixel(int x, int y, bool black)
{
    if (x < 0 || y < 0 || x >= FB_W || y >= FB_H) {
        return;
    }
    size_t idx = (size_t)y * FB_W + (size_t)x;
    uint8_t bit = 7 - (idx % 8);
    if (black) {
        s_fb[idx / 8] &= (uint8_t)~(1u << bit);
    } else {
        s_fb[idx / 8] |= (uint8_t)(1u << bit);
    }
}

static void fb_draw_ring(int cx, int cy, int r_outer, int r_inner)
{
    for (int y = -r_outer; y <= r_outer; y++) {
        for (int x = -r_outer; x <= r_outer; x++) {
            int d2 = x * x + y * y;
            if (d2 <= r_outer * r_outer && d2 >= r_inner * r_inner) {
                fb_set_pixel(cx + x, cy + y, true);
            }
        }
    }
}

/* Fuente 5x7 (columnas, bit0 = fila superior) solo para A–Z, espacio y punto. */
static const uint8_t FONT_5X7[26][5] = {
    {0x7E, 0x11, 0x11, 0x11, 0x7E}, {0x7F, 0x49, 0x49, 0x49, 0x36}, {0x3E, 0x41, 0x41, 0x41, 0x22},
    {0x7F, 0x41, 0x41, 0x22, 0x1C}, {0x7F, 0x49, 0x49, 0x49, 0x41}, {0x7F, 0x09, 0x09, 0x09, 0x01},
    {0x3E, 0x41, 0x49, 0x49, 0x7A}, {0x7F, 0x08, 0x08, 0x08, 0x7F}, {0x00, 0x41, 0x7F, 0x41, 0x00},
    {0x20, 0x40, 0x41, 0x3F, 0x01}, {0x7F, 0x08, 0x14, 0x22, 0x41}, {0x7F, 0x40, 0x40, 0x40, 0x40},
    {0x7F, 0x02, 0x0C, 0x02, 0x7F}, {0x7F, 0x04, 0x08, 0x10, 0x7F}, {0x3E, 0x41, 0x41, 0x41, 0x3E},
    {0x7F, 0x09, 0x09, 0x09, 0x06}, {0x3E, 0x41, 0x51, 0x21, 0x5E}, {0x7F, 0x09, 0x19, 0x29, 0x46},
    {0x46, 0x49, 0x49, 0x49, 0x31}, {0x01, 0x01, 0x7F, 0x01, 0x01}, {0x3F, 0x40, 0x40, 0x40, 0x3F},
    {0x1F, 0x20, 0x40, 0x20, 0x1F}, {0x3F, 0x40, 0x38, 0x40, 0x3F}, {0x63, 0x14, 0x08, 0x14, 0x63},
    {0x07, 0x08, 0x70, 0x08, 0x07}, {0x61, 0x51, 0x49, 0x45, 0x43},
};
static const uint8_t GLYPH_DOT[5] = {0x00, 0x60, 0x60, 0x00, 0x00};

static void fb_draw_text_centered(const char *text, int y, int scale)
{
    int advance = 6 * scale;
    int x = (FB_W - (int)strlen(text) * advance + scale) / 2;
    for (const char *p = text; *p; p++, x += advance) {
        const uint8_t *glyph = NULL;
        if (*p >= 'A' && *p <= 'Z') {
            glyph = FONT_5X7[*p - 'A'];
        } else if (*p == '.') {
            glyph = GLYPH_DOT;
        }
        if (!glyph) {
            continue;
        }
        for (int col = 0; col < 5; col++) {
            for (int row = 0; row < 7; row++) {
                if (glyph[col] & (1 << row)) {
                    for (int dy = 0; dy < scale; dy++) {
                        for (int dx = 0; dx < scale; dx++) {
                            fb_set_pixel(x + col * scale + dx, y + row * scale + dy, true);
                        }
                    }
                }
            }
        }
    }
}

static void render_state(display_state_t state)
{
    fb_clear();
    const int cx = FB_W / 2;
    const int cy = 80;
    const char *label = "";
    const char *hint = "";
    switch (state) {
    case DISPLAY_STATE_IDLE:
        fb_draw_ring(cx, cy, 36, 30);
        label = "JARVIS";
        hint = "PICA BOOT";
        break;
    case DISPLAY_STATE_CONNECTING:
        fb_draw_ring(cx, cy, 42, 34);
        fb_draw_ring(cx, cy, 20, 16);
        label = "LLAMANDO...";
        break;
    case DISPLAY_STATE_LISTENING:
        fb_draw_ring(cx, cy, 48, 38);
        label = "ESCUCHANDO";
        hint = "BOOT PARA COLGAR";
        break;
    case DISPLAY_STATE_SPEAKING:
        fb_draw_ring(cx, cy, 55, 30);
        fb_draw_ring(cx, cy, 18, 0);
        label = "HABLANDO";
        hint = "BOOT PARA COLGAR";
        break;
    case DISPLAY_STATE_ERROR:
        fb_draw_ring(cx, cy, 40, 10);
        label = "SIN CONEXION";
        break;
    }
    fb_draw_text_centered(label, 146, 2);
    fb_draw_text_centered(hint, 176, 1);
}

static void display_task(void *arg)
{
    (void)arg;
    int partial_count = 0;

    render_state(s_requested);
    epd_show_full();
    s_state = s_requested;

    while (1) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        /* Solo pintamos el último estado pedido; los intermedios se descartan. */
        display_state_t next = s_requested;
        if (next == s_state) {
            continue;
        }
        render_state(next);
        if (++partial_count >= FULL_REFRESH_EVERY) {
            partial_count = 0;
            epd_show_full();
        } else {
            epd_show_partial();
        }
        s_state = next;
        ESP_LOGI(TAG, "e-paper state=%d", (int)next);
    }
}

void display_hal_init(void)
{
    epd_hw_init();
    s_requested = DISPLAY_STATE_IDLE;
    xTaskCreate(display_task, "epaper", 4096, NULL, 3, &s_task);
    ESP_LOGI(TAG, "e-paper SSD1681 %dx%d ready", FB_W, FB_H);
}

void display_hal_set_state(display_state_t state)
{
    s_requested = state;
    if (s_task) {
        xTaskNotifyGive(s_task);
    }
}

display_state_t display_hal_get_state(void)
{
    return s_requested;
}

void display_hal_set_state_str(const char *state)
{
    if (!state) {
        return;
    }
    if (strcmp(state, "idle") == 0) {
        display_hal_set_state(DISPLAY_STATE_IDLE);
    } else if (strcmp(state, "connecting") == 0) {
        display_hal_set_state(DISPLAY_STATE_CONNECTING);
    } else if (strcmp(state, "listening") == 0) {
        display_hal_set_state(DISPLAY_STATE_LISTENING);
    } else if (strcmp(state, "speaking") == 0) {
        display_hal_set_state(DISPLAY_STATE_SPEAKING);
    } else if (strcmp(state, "error") == 0) {
        display_hal_set_state(DISPLAY_STATE_ERROR);
    }
}
