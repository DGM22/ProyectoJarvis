"""
openWakeWord detection service.

Receives PCM 16-bit 16 kHz audio over WebSocket, runs the 'hey_jarvis' model,
and sends back detection events as JSON.  Also exposes an HTTP /healthz
endpoint for Docker / NestJS health checks.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time

import numpy as np
import openwakeword
from aiohttp import web
from openwakeword.model import Model

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
)
logger = logging.getLogger("wakeword")

THRESHOLD = float(os.getenv("WAKEWORD_THRESHOLD", "0.5"))
COOLDOWN_S = int(os.getenv("WAKEWORD_COOLDOWN_MS", "2000")) / 1000.0
HOST = os.getenv("WAKEWORD_HOST", "0.0.0.0")
PORT = int(os.getenv("WAKEWORD_PORT", "8765"))
FRAME_SAMPLES = 1280  # 80 ms at 16 kHz

model: Model | None = None
model_lock = asyncio.Lock()


def load_model() -> Model:
    logger.info("Ensuring openWakeWord models are downloaded …")
    openwakeword.utils.download_models()

    logger.info("Loading openWakeWord model (hey_jarvis / onnx) …")
    m = Model(
        wakeword_models=["hey_jarvis"],
        inference_framework="onnx",
        vad_threshold=0.5,
    )
    logger.info("Model loaded successfully.")
    return m


async def predict_in_executor(frame: np.ndarray) -> dict[str, float]:
    """Run the (CPU-bound) prediction off the event loop."""
    loop = asyncio.get_running_loop()

    def _predict() -> dict[str, float]:
        assert model is not None
        return model.predict(frame)

    async with model_lock:
        return await loop.run_in_executor(None, _predict)


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(max_msg_size=0)
    await ws.prepare(request)

    peer = request.remote or "unknown"
    logger.info("Client connected: %s", peer)

    buf = bytearray()
    last_detection_t: float = 0.0

    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.BINARY:
                buf.extend(msg.data)

                while len(buf) >= FRAME_SAMPLES * 2:
                    raw = buf[: FRAME_SAMPLES * 2]
                    del buf[: FRAME_SAMPLES * 2]

                    frame = np.frombuffer(raw, dtype=np.int16)
                    scores = await predict_in_executor(frame)

                    for keyword, score in scores.items():
                        if (
                            score >= THRESHOLD
                            and (time.monotonic() - last_detection_t) > COOLDOWN_S
                        ):
                            last_detection_t = time.monotonic()
                            event = json.dumps(
                                {
                                    "event": "wake_word.detected",
                                    "keyword": keyword,
                                    "confidence": round(float(score), 3),
                                }
                            )
                            logger.info("Detection: %s (%.3f)", keyword, score)
                            await ws.send_str(event)
                            assert model is not None
                            model.reset()

            elif msg.type in (web.WSMsgType.CLOSE, web.WSMsgType.ERROR):
                break
    finally:
        logger.info("Client disconnected: %s", peer)

    return ws


async def healthz(_request: web.Request) -> web.Response:
    return web.Response(text="ok")


def create_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/healthz", healthz)
    return app


if __name__ == "__main__":
    model = load_model()
    app = create_app()
    logger.info("Starting wakeword service on %s:%s", HOST, PORT)
    web.run_app(app, host=HOST, port=PORT, print=None)
