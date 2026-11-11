# Builds the Next.js static export, which the release image serves under /app/.
FROM node:26.13.0-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS web

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /web

COPY web/package.json web/package-lock.json web/.npmrc ./

RUN npm ci

COPY web/ ./

RUN npm run build && node scripts/check-export.mjs

FROM python:3.12.15-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1 AS builder

ARG APP_VERSION=
ARG RELEASE_VERSION=build
ARG RELEASE_COMMIT_SHA=build

COPY --from=ghcr.io/astral-sh/uv:0.9.28@sha256:59240a65d6b57e6c507429b45f01b8f2c7c0bbeee0fb697c41a39c6a8e3a4cfb /uv /bin/uv

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_NO_CACHE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app

COPY pyproject.toml uv.lock .python-version ./

RUN uv sync --locked --no-default-groups

COPY . .

# The image carries the export, never the frontend sources or their dependencies.
RUN rm -rf /app/web
COPY --from=web /web/out /app/web-dist/app

# These values exist only for build-time Django validation; runtime secrets are
# injected by the deployment environment and never baked into the image.
RUN DJANGO_ENV=production \
    DJANGO_KEY=build-only-validation-key-with-sufficient-length-0123456789 \
    DJANGO_ALLOWED_HOSTS=build.example.invalid \
    DJANGO_CSRF_TRUSTED_ORIGINS=https://build.example.invalid \
    DATABASE_URL=sqlite:////tmp/mawareeth-build.sqlite3 \
    DATABASE_SSL_MODE=disable \
    BREVO_SMTP_KEY=build-only \
    BREVO_SMTP_LOGIN=build@example.invalid \
    APP_VERSION="$APP_VERSION" \
    RELEASE_VERSION="$RELEASE_VERSION" \
    RELEASE_COMMIT_SHA="$RELEASE_COMMIT_SHA" \
    python manage.py collectstatic --noinput && \
    DJANGO_ENV=production \
    DJANGO_KEY=build-only-validation-key-with-sufficient-length-0123456789 \
    DJANGO_ALLOWED_HOSTS=build.example.invalid \
    DJANGO_CSRF_TRUSTED_ORIGINS=https://build.example.invalid \
    DATABASE_URL=sqlite:////tmp/mawareeth-build.sqlite3 \
    DATABASE_SSL_MODE=disable \
    BREVO_SMTP_KEY=build-only \
    BREVO_SMTP_LOGIN=build@example.invalid \
    APP_VERSION="$APP_VERSION" \
    RELEASE_VERSION="$RELEASE_VERSION" \
    RELEASE_COMMIT_SHA="$RELEASE_COMMIT_SHA" \
    python manage.py check --deploy --fail-level WARNING

FROM python:3.12.15-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1 AS runtime

ARG APP_VERSION=
ARG RELEASE_VERSION=build
ARG RELEASE_COMMIT_SHA=build

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    DJANGO_SETTINGS_MODULE=mawareeth.settings \
    APP_VERSION="$APP_VERSION" \
    RELEASE_VERSION="$RELEASE_VERSION" \
    RELEASE_COMMIT_SHA="$RELEASE_COMMIT_SHA" \
    PORT=8000

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 fonts-noto-core && \
    rm -rf /var/lib/apt/lists/*

RUN addgroup --system app && \
    adduser --system --ingroup app --home /home/app app

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder --chown=app:app /app /app

RUN mkdir -p /app/staticfiles /tmp/mawareeth && \
    chown -R app:app /app /tmp/mawareeth

USER app

EXPOSE 8000

CMD ["gunicorn", "mawareeth.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "60", "--graceful-timeout", "30", "--access-logfile", "-", "--log-file", "-"]
