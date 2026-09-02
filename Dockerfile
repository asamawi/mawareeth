FROM python:3.12.14-slim@sha256:2fe5997d249a808b8eeea52c58a1dbffbba28754dc11699ef5c029f2d818ce79 AS builder

ARG RELEASE_VERSION=build
ARG RELEASE_COMMIT_SHA=build

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app

RUN python -m venv "$VIRTUAL_ENV"

COPY requirements.txt requirements.lock ./

RUN pip install --upgrade pip && \
    pip install -r requirements.txt

COPY . .

# These values exist only for build-time Django validation; runtime secrets are
# injected by the deployment environment and never baked into the image.
RUN DJANGO_ENV=production \
    DJANGO_KEY=build-only-validation-key-with-sufficient-length-0123456789 \
    DJANGO_ALLOWED_HOSTS=build.example.invalid \
    DJANGO_CSRF_TRUSTED_ORIGINS=https://build.example.invalid \
    DATABASE_URL=sqlite:////tmp/mawareeth-build.sqlite3 \
    DATABASE_SSL_MODE=disable \
    RELEASE_VERSION="$RELEASE_VERSION" \
    RELEASE_COMMIT_SHA="$RELEASE_COMMIT_SHA" \
    python manage.py collectstatic --noinput && \
    DJANGO_ENV=production \
    DJANGO_KEY=build-only-validation-key-with-sufficient-length-0123456789 \
    DJANGO_ALLOWED_HOSTS=build.example.invalid \
    DJANGO_CSRF_TRUSTED_ORIGINS=https://build.example.invalid \
    DATABASE_URL=sqlite:////tmp/mawareeth-build.sqlite3 \
    DATABASE_SSL_MODE=disable \
    RELEASE_VERSION="$RELEASE_VERSION" \
    RELEASE_COMMIT_SHA="$RELEASE_COMMIT_SHA" \
    python manage.py check --deploy

FROM python:3.12.14-slim@sha256:2fe5997d249a808b8eeea52c58a1dbffbba28754dc11699ef5c029f2d818ce79 AS runtime

ARG RELEASE_VERSION=build
ARG RELEASE_COMMIT_SHA=build

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    DJANGO_SETTINGS_MODULE=mawareeth.settings \
    RELEASE_VERSION="$RELEASE_VERSION" \
    RELEASE_COMMIT_SHA="$RELEASE_COMMIT_SHA" \
    PORT=8000

WORKDIR /app

RUN addgroup --system app && \
    adduser --system --ingroup app --home /home/app app

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder --chown=app:app /app /app

RUN mkdir -p /app/staticfiles /tmp/mawareeth && \
    chown -R app:app /app /tmp/mawareeth

USER app

EXPOSE 8000

CMD ["gunicorn", "mawareeth.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "60", "--graceful-timeout", "30", "--access-logfile", "-", "--log-file", "-"]
