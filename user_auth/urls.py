from django.urls import path
from . import views

app_name = 'users_auth'
urlpatterns = [
    path('profile/', views.profile, name='profile'),

]
