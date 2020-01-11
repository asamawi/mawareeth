from django.urls import path
from . import views

app_name = 'calc'
urlpatterns = [
	path('', views.IndexView.as_view(), name='index'),
	path('new/', views.new, name='new'),
	path('<int:pk>/', views.DetailView.as_view(), name='detail'),
	path('<int:pk>/delete/', views.delete, name='delete'),
	path('<int:pk>/deceased', views.deceased, name='deceased'),
    path('<int:pk>/results/', views.ResultsView.as_view(), name='results'),
	path('error/', views.error, name='error'),

]
