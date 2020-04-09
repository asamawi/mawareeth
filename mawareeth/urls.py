"""mawareeth URL Configuration

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/3.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.conf.urls.i18n import i18n_patterns
from django.contrib import admin
from django.urls import include, path
from calc import views as calc_views
from user_auth import views as user_auth_views

urlpatterns = [
    #path('admin/', admin.site.urls),
    #path('calc/', include('calc.urls')),
    path('i18n/', include('django.conf.urls.i18n')),
    path('accounts/', include('django.contrib.auth.urls')),
    path('social-auth/', include('social_django.urls', namespace="social")),

]

calc_patterns = ([
    path('calc/', calc_views.IndexView.as_view(), name='index'),
    path('', calc_views.HomePage.as_view(), name='home'),
	path('terms/', calc_views.Terms.as_view(), name='terms'),
	path('privacy/', calc_views.Privacy.as_view(), name='privacy'),
    path('about/', calc_views.About.as_view(), name='about'),
    path('new/', calc_views.new, name='new'),
    path('<int:pk>/', calc_views.DetailView.as_view(), name='detail'),
    path('<int:pk>/delete/', calc_views.delete, name='delete'),
    path('<int:calc_id>/deceased', calc_views.DeceasedCreate.as_view(), name='deceased'),
	path('<int:pk>/deceased_delete', calc_views.DeceasedDelete.as_view(), name='deceased_delete'),
	path('<int:pk>/deceased_update', calc_views.DeceasedUpdate.as_view(), name='deceased_update'),
	path('<int:pk>/calc_update', calc_views.CalculationUpdate.as_view(), name='calc_update'),
    path('<int:calc_id>/mother', calc_views.MotherCreate.as_view(), name='mother'),
	path('<int:pk>/heir_delete', calc_views.HeirDelete.as_view(), name='heir_delete'),
	path('<int:pk>/heir_update', calc_views.HeirUpdate.as_view(), name='heir_update'),
    path('<int:calc_id>/father', calc_views.FatherCreate.as_view(), name='father'),
	path('<int:calc_id>/husband', calc_views.HusbandCreate.as_view(), name='husband'),
	path('<int:calc_id>/wife', calc_views.WifeCreate.as_view(), name='wife'),
	path('<int:calc_id>/daughter', calc_views.DaughterCreate.as_view(), name='daughter'),
	path('<int:calc_id>/son', calc_views.SonCreate.as_view(), name='son'),
	path('<int:calc_id>/bother', calc_views.BrotherCreate.as_view(), name='brother'),
	path('<int:calc_id>/sister', calc_views.SisterCreate.as_view(), name='sister'),
    path('<int:pk>/results/', calc_views.ResultsView.as_view(), name='results'),
    path('error/', calc_views.error, name='error'),
    path('signup/', calc_views.SignUp.as_view(), name='signup'),


], 'calc')

user_auth_patterns = ([
    path('profile/', user_auth_views.profile, name='profile')
], 'user_auth')
urlpatterns += i18n_patterns(
    path('admin/', admin.site.urls),
    path('', include(calc_patterns,namespace='calc')),
    path('',include(user_auth_patterns,namespace='user_auth')),
)
