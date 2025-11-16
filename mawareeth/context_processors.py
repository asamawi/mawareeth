from django.conf import settings


def app_version(request):
    """
    Expose the application version to templates as APP_VERSION.
    """
    return {"APP_VERSION": getattr(settings, "APP_VERSION", None)}

