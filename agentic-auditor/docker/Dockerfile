# ------------------------------------------------------
# BASE: Python slim (pequeña, segura, producción real)
# ------------------------------------------------------
FROM python:3.12-slim AS base

# Evita problemas con buffering en logs
ENV PYTHONUNBUFFERED=1

# ------------------------------------------------------
# Install system deps (solo lo mínimo)
# ------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------
# WORKDIR
# ------------------------------------------------------
WORKDIR /app

# ------------------------------------------------------
# Copy requirements first (para aprovechar cache)
# ------------------------------------------------------
COPY requirements.txt .

# ------------------------------------------------------
# Install Python deps
# ------------------------------------------------------
RUN pip install --no-cache-dir -r requirements.txt

# ------------------------------------------------------
# Copy app source
# ------------------------------------------------------
COPY app ./app

# ------------------------------------------------------
# ENV (FastAPI config)
# ------------------------------------------------------
ENV ENV=prod
ENV PYTHONPATH=/app

# ------------------------------------------------------
# Expose port
# ------------------------------------------------------
EXPOSE 8000

# ------------------------------------------------------
# Start FastAPI + Uvicorn
# ------------------------------------------------------
CMD ["uvicorn", "app.fastapi_app:app", "--host", "0.0.0.0", "--port", "8000"]
