from django.http import HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404, render
from django.urls import reverse
from django.views import generic
from django.contrib.auth.views import LoginView
from django.contrib.auth.decorators import login_required
from django.utils.decorators import method_decorator
from django.views.generic import View

from .models import Calculation, Person, Marriage

class LoginRequired(View):
    """
    Redirects to login if user is anonymous
    """
    @method_decorator(login_required)
    def dispatch(self, *args, **kwargs):
        return super(LoginRequired, self).dispatch(*args, **kwargs)

class IndexView(LoginRequired, generic.ListView):
	template_name = 'calc/index.html'
	context_object_name = 'calculation_list'

	def get_queryset(self):
		return Calculation.objects.filter(user=self.request.user)


class DetailView(LoginRequired, generic.DetailView):
	model = Calculation
	template_name = 'calc/detail.html'

class ResultsView(LoginRequired, generic.DetailView):
	model = Calculation
	template_name = 'calc/results.html'

def new(request):
    name = request.POST["name"]
    user = request.user
    calc = Calculation.objects.create (name=name, user=user)
    return HttpResponseRedirect(reverse('calc:detail', args=(calc.id,)))

def deceased(request, calc_id):
    calc = Calculation.objects.get(pk=calc_id)
    sex = request.POST["sex"]
    first_name = request.POST["first_name"]
    last_name = request.POST["last_name"]
    estate = request.POST["estate"]
    Deceased.objects.create(calc=calc, sex=sex, first_name=first_name, last_name=last_name, estate=estate)
    return HttpResponseRedirect(reverse('calc:detail', args=(calc.id,)))
