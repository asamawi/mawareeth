from django.urls import path

from . import views

app_name = 'calc'
urlpatterns = [
	path('', views.index, name='index'),
	path('<int:calculation_id>/', views.detail, name='detail'),
    path('<int:calculation_id>/results/', views.results, name='results'),
    path('<int:calculation_id>/vote/', views.vote, name='vote'),
]
