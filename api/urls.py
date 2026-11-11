from django.urls import path, re_path

from api.views import CaseView, DeathsView, DeathView, DeceasedView, HeirsView, HeirView, NotFoundView, PreviewView, SessionView

from reports.views import DraftReportView

app_name = 'api'

urlpatterns = [
    path('session/', SessionView.as_view(), name='session'),
    path('case/', CaseView.as_view(), name='case'),
    path('case/preview/', PreviewView.as_view(), name='case-preview'),
    path('case/deceased/', DeceasedView.as_view(), name='case-deceased'),
    path('case/deaths/', DeathsView.as_view(), name='case-deaths'),
    path('case/deaths/<str:heir_id>/', DeathView.as_view(), name='case-death'),
    path('case/heirs/', HeirsView.as_view(), name='case-heirs'),
    path('case/heirs/<str:heir_id>/', HeirView.as_view(), name='case-heir'),
    path('reports/draft/', DraftReportView.as_view(), name='report-draft'),
    # Must stay last: it matches everything the routes above did not.
    re_path(r'^.*$', NotFoundView.as_view(), name='not-found'),
]
