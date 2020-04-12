from django.urls import path
from . import views

app_name = 'calc'
urlpatterns = [
	path('calc/', views.IndexView.as_view(), name='index'),
	path('', views.HomePage.as_view(), name='home'),
	path('terms/', views.Terms.as_view(), name='terms'),
	path('privacy/', views.Privacy.as_view(), name='privacy'),
	path('about/', views.About.as_view(), name='about'),
	path('new/', views.new, name='new'),
	path('<int:pk>/', views.DetailView.as_view(), name='detail'),
	path('<int:pk>/delete/', views.delete, name='delete'),
	path('<int:calc_id>/deceased', views.DeceasedCreate.as_view(), name='deceased'),
	path('<int:pk>/deceased_delete', views.DeceasedDelete.as_view(), name='deceased_delete'),
	path('<int:pk>/deceased_update', views.DeceasedUpdate.as_view(), name='deceased_update'),
	path('<int:pk>/calc_update', views.CalculationUpdate.as_view(), name='calc_update'),
	path('<int:calc_id>/mother', views.MotherCreate.as_view(), name='mother'),
	path('<int:pk>/heir_delete', views.HeirDelete.as_view(), name='heir_delete'),
	path('<int:pk>/heir_update', views.HeirUpdate.as_view(), name='heir_update'),
	path('<int:calc_id>/father', views.FatherCreate.as_view(), name='father'),
	path('<int:calc_id>/husband', views.HusbandCreate.as_view(), name='husband'),
	path('<int:calc_id>/wife', views.WifeCreate.as_view(), name='wife'),
	path('<int:calc_id>/daughter', views.DaughterCreate.as_view(), name='daughter'),
	path('<int:calc_id>/son', views.SonCreate.as_view(), name='son'),
	path('<int:calc_id>/bother', views.BrotherCreate.as_view(), name='brother'),
	path('<int:calc_id>/sister', views.SisterCreate.as_view(), name='sister'),
	path('<int:calc_id>/grandFather', views.GrandFatherCreate.as_view(), name='grandFather'),
	path('<int:pk>/results/', views.ResultsView.as_view(), name='results'),
	path('error/', views.error, name='error'),
	path('signup/', views.SignUp.as_view(), name='signup'),
]
