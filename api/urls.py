from api import auth_views
from django.urls import path, re_path

from api.views import (CaseView, DeathsView, DeathView, DeceasedView, HeirsView, HeirView, NotFoundView,
                       OpenSavedCaseView, PreviewView, SavedCaseSharesView, SavedCasesView, SessionView,
                       SharedViewView, ShareView)

from reports.views import DraftReportView, SharedReportView

from api.views import SavedCaseInvitesView, InviteView, AcceptInviteView, ReceivedListView, ReceivedViewView
from reports.views import ReceivedReportView

app_name = 'api'

urlpatterns = [
    path('auth/login/', auth_views.LoginView.as_view(), name='auth-login'),
    path('auth/signup/', auth_views.SignupView.as_view(), name='auth-signup'),
    path('auth/logout/', auth_views.LogoutView.as_view(), name='auth-logout'),
    path('auth/password-reset/', auth_views.PasswordResetView.as_view(), name='auth-password-reset'),
    path('auth/password-reset/confirm/', auth_views.PasswordResetConfirmView.as_view(), name='auth-password-reset-confirm'),
    path('session/', SessionView.as_view(), name='session'),
    path('case/', CaseView.as_view(), name='case'),
    path('case/preview/', PreviewView.as_view(), name='case-preview'),
    path('case/deceased/', DeceasedView.as_view(), name='case-deceased'),
    path('case/deaths/', DeathsView.as_view(), name='case-deaths'),
    path('case/deaths/<str:heir_id>/', DeathView.as_view(), name='case-death'),
    path('case/heirs/', HeirsView.as_view(), name='case-heirs'),
    path('case/heirs/<str:heir_id>/', HeirView.as_view(), name='case-heir'),
    path('reports/draft/', DraftReportView.as_view(), name='report-draft'),
    path('saved-cases/', SavedCasesView.as_view(), name='saved-cases'),
    path('saved-cases/<int:id>/open/', OpenSavedCaseView.as_view(), name='saved-case-open'),
    path('saved-cases/<int:id>/shares/', SavedCaseSharesView.as_view(), name='saved-case-shares'),
    path('shares/view/', SharedViewView.as_view(), name='share-view'),
    path('shares/report/', SharedReportView.as_view(), name='share-report'),
    path('shares/<int:id>/', ShareView.as_view(), name='share'),
    path('saved-cases/<int:id>/invites/', SavedCaseInvitesView.as_view(), name='saved-case-invites'),
    path('invites/accept/', AcceptInviteView.as_view(), name='invite-accept'),
    path('invites/<int:id>/', InviteView.as_view(), name='invite'),
    path('received/', ReceivedListView.as_view(), name='received'),
    path('received/<int:id>/view/', ReceivedViewView.as_view(), name='received-view'),
    path('received/<int:id>/report/', ReceivedReportView.as_view(), name='received-report'),
    # Must stay last: it matches everything the routes above did not.
    re_path(r'^.*$', NotFoundView.as_view(), name='not-found'),
]
