FROM python:3.9-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential libpq-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --upgrade pip && \
    pip install -r requirements.txt

COPY . .

ENV DJANGO_SETTINGS_MODULE=mawareeth.settings \
    PORT=8000

# Collect static files at build time if possible.
RUN python manage.py collectstatic --noinput || echo "collectstatic failed, continuing"

CMD ["gunicorn", "mawareeth.wsgi:application", "--bind", "0.0.0.0:8000"]

