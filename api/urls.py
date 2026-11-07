from django.urls import path, re_path

from api.views import CaseView, DeceasedView, HeirsView, HeirView, NotFoundView, SessionView

app_name = 'api'

urlpatterns = [
    path('session/', SessionView.as_view(), name='session'),
    path('case/', CaseView.as_view(), name='case'),
    path('case/deceased/', DeceasedView.as_view(), name='case-deceased'),
    path('case/heirs/', HeirsView.as_view(), name='case-heirs'),
    path('case/heirs/<str:heir_id>/', HeirView.as_view(), name='case-heir'),
    # Must stay last: it matches everything the routes above did not.
    re_path(r'^.*$', NotFoundView.as_view(), name='not-found'),
]
