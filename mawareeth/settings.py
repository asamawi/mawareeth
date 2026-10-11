import os
from pathlib import Path
from urllib.parse import urlparse

import dj_database_url
from decouple import Csv, config
from django.core.exceptions import ImproperlyConfigured
from django.utils.translation import gettext_lazy as _

# Build paths inside the project like this: os.path.join(BASE_DIR, ...)
BASE_DIR = Path(__file__).resolve().parent.parent

# Application version (major.minor.patch)
APP_VERSION_MAJOR = 2
APP_VERSION_MINOR = 0
APP_VERSION_PATCH = 1
APP_VERSION = f"{APP_VERSION_MAJOR}.{APP_VERSION_MINOR}.{APP_VERSION_PATCH}"
RELEASE_VERSION = config("RELEASE_VERSION", default=APP_VERSION)
RELEASE_COMMIT_SHA = config("RELEASE_COMMIT_SHA", default="local")
DJANGO_ENV = config("DJANGO_ENV", default="development").strip().lower()
VALID_DJANGO_ENVS = {"development", "test", "production"}
if DJANGO_ENV not in VALID_DJANGO_ENVS:
    allowed = ", ".join(sorted(VALID_DJANGO_ENVS))
    raise ImproperlyConfigured(f"DJANGO_ENV must be one of: {allowed}.")
IS_PRODUCTION = DJANGO_ENV == "production"
VALID_DATABASE_SSL_MODES = {"disable", "prefer", "require", "verify-ca", "verify-full"}


def _csv_setting(name, *, required=False):
    values = [item.strip() for item in config(name, default="", cast=Csv()) if item.strip()]
    if required and not values:
        raise ImproperlyConfigured(f"{name} must be set when DJANGO_ENV=production.")
    return values


def _production_hosts():
    hosts = _csv_setting("DJANGO_ALLOWED_HOSTS", required=IS_PRODUCTION)
    if IS_PRODUCTION:
        invalid = [host for host in hosts if host == "*" or "*" in host or "://" in host or "/" in host]
        if invalid:
            raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS must contain explicit hostnames only.")
    return hosts


def _production_csrf_origins():
    origins = _csv_setting("DJANGO_CSRF_TRUSTED_ORIGINS", required=IS_PRODUCTION)
    if IS_PRODUCTION:
        for origin in origins:
            parsed = urlparse(origin)
            if (
                parsed.scheme != "https"
                or not parsed.netloc
                or parsed.path not in ("", "/")
                or parsed.params
                or parsed.query
                or parsed.fragment
                or "*" in parsed.netloc
            ):
                raise ImproperlyConfigured(
                    "DJANGO_CSRF_TRUSTED_ORIGINS must contain explicit HTTPS origins only."
                )
    return origins


def _database_ssl_mode():
    default = "" if IS_PRODUCTION else "disable"
    mode = config("DATABASE_SSL_MODE", default=default).strip().lower()
    if not mode:
        raise ImproperlyConfigured("DATABASE_SSL_MODE must be set when DJANGO_ENV=production.")
    if mode not in VALID_DATABASE_SSL_MODES:
        allowed = ", ".join(sorted(VALID_DATABASE_SSL_MODES))
        raise ImproperlyConfigured(f"DATABASE_SSL_MODE must be one of: {allowed}.")
    return mode


def _require_secret_key():
    default = "" if IS_PRODUCTION else "local-secret-key-for-testing"
    secret_key = config("DJANGO_KEY", default=default)
    if IS_PRODUCTION and not secret_key:
        raise ImproperlyConfigured("DJANGO_KEY must be set when DJANGO_ENV=production.")
    return secret_key


def _build_database_config():
    database_url = config("DATABASE_URL", default="")
    connect_timeout = config("DATABASE_CONNECT_TIMEOUT", default=5, cast=int)
    ssl_mode = _database_ssl_mode()

    if connect_timeout <= 0:
        raise ImproperlyConfigured("DATABASE_CONNECT_TIMEOUT must be a positive integer.")

    if IS_PRODUCTION and not database_url:
        raise ImproperlyConfigured("DATABASE_URL must be set when DJANGO_ENV=production.")

    if database_url:
        database = dj_database_url.parse(database_url, conn_max_age=600)
    else:
        database = {
            "ENGINE": config("ENGINE", default="django.db.backends.postgresql"),
            "NAME": config("DATABASE_NAME", default="mydb_mawareeth"),
            "HOST": config("DATABASE_HOST", default="localhost"),
            "USER": config("DB_USER", default="postgres"),
            "PASSWORD": config("DB_PASS", default="postgres"),
            "PORT": config("POSTGRES_PORT", default="5432"),
            "CONN_MAX_AGE": 600,
        }

    if "postgresql" in database.get("ENGINE", ""):
        database.setdefault("OPTIONS", {})
        database["OPTIONS"]["sslmode"] = ssl_mode
        database["OPTIONS"].setdefault("connect_timeout", connect_timeout)

    return {"default": database}


SECRET_KEY = _require_secret_key()
DEBUG = config("DJANGO_DEBUG", default=not IS_PRODUCTION, cast=bool)
if IS_PRODUCTION and DEBUG:
    raise ImproperlyConfigured("DEBUG must be False when DJANGO_ENV=production.")

ALLOWED_HOSTS = _production_hosts()
CSRF_TRUSTED_ORIGINS = _production_csrf_origins()


# Application definition

INSTALLED_APPS = [
    'calc.apps.CalcConfig',
    'user_auth.apps.UserAuthConfig',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django.contrib.sites',
    'django.contrib.humanize',
    'mawareeth',
    'polymorphic',
    'anymail',
    'crispy_forms',
    'crispy_bootstrap4',
    'django_icons',
    'active_link',
    'social_django',
    'waffle',
]

# Default primary key field type for models
# See: https://docs.djangoproject.com/en/stable/ref/settings/#default-auto-field
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',

    'django.middleware.locale.LocaleMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'social_django.middleware.SocialAuthExceptionMiddleware',
    'waffle.middleware.WaffleMiddleware',
]

ROOT_URLCONF = 'mawareeth.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
                'django.template.context_processors.i18n',
                'social_django.context_processors.backends',
                'social_django.context_processors.login_redirect',
                'mawareeth.context_processors.app_version',
            ],
        },
    },
]

WSGI_APPLICATION = 'mawareeth.wsgi.application'

DATABASES = _build_database_config()
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True

# Password validation
# https://docs.djangoproject.com/en/3.0/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# Internationalization
# https://docs.djangoproject.com/en/3.0/topics/i18n/

LANGUAGE_CODE = config("LANGUAGE_CODE",default='ar')
USE_THOUSAND_SEPARATOR = True
TIME_ZONE = 'Asia/Riyadh'

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/3.0/howto/static-files/

# Static files settings
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

STORAGES = {
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage" if not DEBUG else "django.contrib.staticfiles.storage.StaticFilesStorage",
    },
}


SITE_ID = config("SITE_ID",default=1, cast=int)

LOCALE_PATHS = [
    (os.path.join(BASE_DIR, "locale")),
]

prefix_default_language = False

LANGUAGES = [
  ('ar', _('Arabic')),
  ('en', _('English')),
  ('fr', _('French')),

]
LOGIN_REDIRECT_URL = 'calc:index'
LOGOUT_REDIRECT_URL = 'calc:index'
ANYMAIL = {
    "MAILGUN_API_KEY" : config('MAILGUN_ACCESS_KEY', default='dummy'),
    "MAILGUN_API_URL": "https://api.eu.mailgun.net/v3",
    "MAILGUN_SENDER_DOMAIN" : config('MAILGUN_SERVER_NAME', default='dummy'),
}
EMAIL_BACKEND = "anymail.backends.mailgun.EmailBackend"
DEFAULT_FROM_EMAIL = "noreply@mawareeth.com"
SERVER_EMAIL = "notifications@mawareeth.com"

CRISPY_TEMPLATE_PACK = 'bootstrap4'
CRISPY_ALLOWED_TEMPLATE_PACKS = ("bootstrap4",)

SECURE_SSL_REDIRECT = IS_PRODUCTION or config("SSL_REDIRECT", default=False, cast=bool)
SESSION_COOKIE_SECURE = IS_PRODUCTION or config("SESSION_COOKIE", default=False, cast=bool)
CSRF_COOKIE_SECURE = IS_PRODUCTION or config("CSRF_COOKIE", default=False, cast=bool)
SECURE_REFERRER_POLICY = 'same-origin'
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'
SECURE_HSTS_SECONDS = 31536000 if IS_PRODUCTION else config("SECURE_HSTS_SECONDS", default=0, cast=int)
SECURE_HSTS_INCLUDE_SUBDOMAINS = IS_PRODUCTION or config("SECURE_HSTS_INCLUDE_SUBDOMAINS", default=False, cast=bool)
SECURE_HSTS_PRELOAD = IS_PRODUCTION or config("SECURE_HSTS_PRELOAD", default=False, cast=bool)

AUTHENTICATION_BACKENDS = [
    'social_core.backends.linkedin.LinkedinOAuth2',
    'social_core.backends.instagram.InstagramOAuth2',
    'social_core.backends.facebook.FacebookOAuth2',
    'django.contrib.auth.backends.ModelBackend',
]

LOGIN_URL = 'login'
LOGIN_REDIRECT_URL = 'calc:index'
LOGOUT_URL = 'logout'
LOGOUT_REDIRECT_URL = 'login'

SOCIAL_AUTH_FACEBOOK_KEY = config("FACEBOOK_KEY",default=0,cast=int)
SOCIAL_AUTH_FACEBOOK_SECRET = config("FACEBOOK_SECRET",default=" ")
SOCIAL_AUTH_FACEBOOK_SCOPE = ['email']
SOCIAL_AUTH_FACEBOOK_PROFILE_EXTRA_PARAMS = {
  'fields': 'id, name, email, picture.type(large)'
}

SOCIAL_AUTH_FACEBOOK_EXTRA_DATA = [
    ('name', 'name'),
    ('email', 'email'),
    ('picture', 'picture'),
]

SOCIAL_AUTH_LINKEDIN_OAUTH2_KEY = config("LINKEDIN_KEY",default=" ")
SOCIAL_AUTH_LINKEDIN_OAUTH2_SECRET = config("LINKEDIN_SECRET",default=" ")
SOCIAL_AUTH_LINKEDIN_OAUTH2_SCOPE = ['r_liteprofile', 'r_emailaddress']
SOCIAL_AUTH_LINKEDIN_OAUTH2_FIELD_SELECTORS = ['emailAddress', 'formatted-name', 'public-profile-url', 'picture-url']
SOCIAL_AUTH_LINKEDIN_OAUTH2_EXTRA_DATA = [
    ('id', 'id'),
    ('formattedName', 'name'),
    ('emailAddress', 'emailAddress'),
    ('pictureUrl', 'picture_url'),
    ('publicProfileUrl', 'profile_url'),
]

SOCIAL_AUTH_PIPELINE = (
    'social_core.pipeline.social_auth.social_details',
    'social_core.pipeline.social_auth.social_uid',
    'social_core.pipeline.social_auth.auth_allowed',
    'social_core.pipeline.social_auth.social_user',
    'social_core.pipeline.user.get_username',
    'social_core.pipeline.social_auth.associate_by_email',
    'social_core.pipeline.user.create_user',
    'social_core.pipeline.social_auth.associate_user',
    'social_core.pipeline.social_auth.load_extra_data',
    'social_core.pipeline.user.user_details',
)
WAFFLE_CREATE_MISSING_FLAGS = True
WAFFLE_CREATE_MISSING_SWITCHES = True
WAFFLE_CREATE_MISSING_SAMPLES = True
