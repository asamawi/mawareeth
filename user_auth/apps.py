from django.apps import AppConfig


class UserAuthConfig(AppConfig):
    name = 'user_auth'

    def ready(self):
        import user_auth.signals
