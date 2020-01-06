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

urlpatterns = [
    #path('admin/', admin.site.urls),
    #path('calc/', include('calc.urls')),
    path('i18n/', include('django.conf.urls.i18n')),
    path('accounts/', include('django.contrib.auth.urls')),
]

calc_patterns = ([
    path('', calc_views.IndexView.as_view(), name='index'),
    path('<int:pk>/', calc_views.DetailView.as_view(), name='detail'),
    path('<int:pk>/results/', calc_views.ResultsView.as_view(), name='results'),
], 'calc')

urlpatterns += i18n_patterns(
    path('admin/', admin.site.urls),
    path('', include(calc_patterns,namespace='calc')),
)
