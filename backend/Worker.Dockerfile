FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt /app/requirements.txt
COPY requirements-worker.txt /app/requirements-worker.txt
RUN pip install --no-cache-dir -r /app/requirements.txt \
    && pip install --no-cache-dir -r /app/requirements-worker.txt \
    && python -c "import essentia.standard"

COPY app /app/app
COPY migrations /app/migrations

CMD ["python", "-m", "app.workers.orchestrator"]
