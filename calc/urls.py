from django.urls import path
from . import views

app_name = 'calc'
urlpatterns = [
	path('', views.IndexView.as_view(), name='index'),
	path('new/', views.new, name='new'),
	path('<int:pk>/', views.DetailView.as_view(), name='detail'),
	path('<int:pk>/delete/', views.delete, name='delete'),
	path('<int:calc_id>/deceased', views.DeceasedCreate.as_view(), name='deceased'),
	path('<int:pk>/deceased_delete', views.DeceasedDelete.as_view(), name='deceased_delete'),
	path('<int:pk>/deceased_update', views.DeceasedUpdate.as_view(), name='deceased_update'),
	path('<int:calc_id>/mother', views.MotherCreate.as_view(), name='mother'),
	path('<int:pk>/heir_delete', views.HeirDelete.as_view(), name='heir_delete'),
	path('<int:pk>/heir_update', views.HeirUpdate.as_view(), name='heir_update'),
	path('<int:pk>/father', views.father, name='father'),
    path('<int:pk>/results/', views.ResultsView.as_view(), name='results'),
	path('error/', views.error, name='error'),
	path('signup/', views.SignUp.as_view(), name='signup'),


]
