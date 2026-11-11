from django.conf import settings
from django.utils.module_loading import import_string


def report_status(case):
    provider = getattr(settings, 'REPORT_STATUS_PROVIDER', None)
    return import_string(provider)(case) if provider else 'draft'
