FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TORCH_CUDA_VARIANT=cu124 \
    TORCH_ENV_SOURCE=pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt /app/requirements.txt
COPY requirements-separate-stems.txt /app/requirements-separate-stems.txt
RUN pip install --no-cache-dir -r /app/requirements.txt \
    && pip install --no-cache-dir -r /app/requirements-separate-stems.txt

COPY app /app/app
COPY migrations /app/migrations

CMD ["python", "-m", "app.workers.separate_stems"]
