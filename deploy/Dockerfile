FROM python:3.12-slim

WORKDIR /app/backend

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/app/data \
    FRONTEND_DIST_DIR=/app/frontend/dist

COPY backend/pyproject.toml /app/backend/
COPY backend/app /app/backend/app

RUN pip install --no-cache-dir . && mkdir -p /app/data

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
