"""Settings for the local-only browser journeys in web/e2e-live; never a deployment setting.

Only what a live run on one machine needs: the throttles are lifted, since a journey makes far more
writes in an hour than a visitor, and the `next dev` origin is trusted. Production defaults stay
in `settings.py`.
"""
import os

from django.core.exceptions import ImproperlyConfigured

from .settings import *  # noqa: F401,F403
from .settings import IS_PRODUCTION, REST_FRAMEWORK

if IS_PRODUCTION:
    raise ImproperlyConfigured('The live end-to-end settings are for local runs only.')

REST_FRAMEWORK = {
    **REST_FRAMEWORK,
    'DEFAULT_THROTTLE_RATES': {scope: '1000000/hour' for scope in REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']},
}
CSRF_TRUSTED_ORIGINS = [os.environ.get('E2E_LIVE_WEB', 'http://localhost:3000')]
# Production writes schema 2, and positioned adds (drag, Add relative here) need it.
SNAPSHOT_WRITE_VERSION = 2
