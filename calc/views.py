from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404, render
from django.urls import reverse
from django.views import generic

from .models import Calculation, Person, Marriage

class IndexView(generic.ListView):
	template_name = 'calc/index.html'
	context_object_name = 'calculation_list'

	def get_queryset(self):
		return Calculation.objects.filter(user=self.request.user)

class DetailView(generic.DetailView):
	model = Calculation
	template_name = 'calc/detail.html'

class ResultsView(generic.DetailView):
	model = Calculation
	template_name = 'calc/results.html'
