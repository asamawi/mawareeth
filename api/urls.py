from django.urls import path, re_path

from api.views import NotFoundView, SessionView

app_name = 'api'

urlpatterns = [
    path('session/', SessionView.as_view(), name='session'),
    # Must stay last: it matches everything the routes above did not.
    re_path(r'^.*$', NotFoundView.as_view(), name='not-found'),
]
