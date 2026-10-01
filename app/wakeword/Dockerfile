FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends libsndfile1 curl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download pretrained models (hey_jarvis + feature extractors) at build time.
RUN python -c "import openwakeword; openwakeword.utils.download_models()"

COPY server.py .

EXPOSE 8765

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD curl -fsS http://localhost:8765/healthz || exit 1

CMD ["python", "server.py"]
