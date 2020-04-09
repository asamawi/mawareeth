from django.http import HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404, render
from django.urls import reverse
from django.views import generic
from django.contrib.auth.views import LoginView
from django.contrib.auth.decorators import login_required
from django.utils.decorators import method_decorator
from django.views.generic import View
from django.contrib import messages
from user_auth.forms import UserCreationForm
from django.urls import reverse_lazy
from calc.forms import HeirForm, DeceasedForm
from django.views.generic.edit import CreateView, UpdateView, DeleteView
from django.utils.translation import gettext as _
from django.views.generic.base import TemplateView
from .models import *
from waffle.decorators import waffle_flag

class HomePage(TemplateView):
	template_name="calc/home.html"
class Terms(TemplateView):
	template_name="calc/terms.html"
class Privacy(TemplateView):
	template_name="calc/privacy.html"
class About(TemplateView):
	template_name="calc/about.html"
class DeceasedCreate(CreateView):
	model = Deceased
	fields = ['first_name','last_name','sex', 'estate']

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_object_or_404(Calculation, pk=kwargs['calc_id'])
		if self.calc.deceased_set.count() >= 1:
			messages.error(request,_("Decease already exist"))
			return HttpResponseRedirect(reverse( 'calc:error'))
		return super().dispatch(request, *args, **kwargs)
	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		return super().form_valid(form)

class DeceasedUpdate(UpdateView):
	model = Deceased
	fields = ['first_name','last_name', 'estate']

class DeceasedDelete(DeleteView):
	model = Deceased
	def delete(self, request, *args, **kwargs):
		self.object = self.get_object()
		self.calc = self.object.calc # assuming that deceased have a foreignkey reference to Calculation model
		self.calc.heir_set.all().delete()
		self.object.delete()
		success_url = self.get_success_url()
		return HttpResponseRedirect(success_url)

	def get_success_url(self):
		calc = self.calc
		return reverse(  # no need for lazy here
			'calc:detail',
			 kwargs={'pk': calc.id}
		)
class MotherCreate(CreateView):
	model = Mother
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_object_or_404(Calculation, pk=kwargs['calc_id'])
		if self.calc.heir_set.instance_of(Mother).count() >= 1:
			messages.error(request,_("Mother already exist"))
			return HttpResponseRedirect(reverse( 'calc:error'))
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="F"
		self.object.save()
		form.instance.calc.add_mother(self.object)
		return super().form_valid(form)

class FatherCreate(CreateView):
	model = Father
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_object_or_404(Calculation, pk=kwargs['calc_id'])
		if self.calc.heir_set.instance_of(Father).count() >= 1:
			messages.error(request,_("Father already exist"))
			return HttpResponseRedirect(reverse( 'calc:error'))
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="M"
		self.object.save()
		form.instance.calc.add_father(self.object)
		return super().form_valid(form)

class HusbandCreate(CreateView):
	model = Husband
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_object_or_404(Calculation, pk=kwargs['calc_id'])
		if self.calc.heir_set.instance_of(Husband).count() >= 1:
			messages.error(request,_("Husband already exist"))
			return HttpResponseRedirect(reverse( 'calc:error'))
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="M"
		self.object.save()
		form.instance.calc.add_husband(self.object)
		return super().form_valid(form)

class WifeCreate(CreateView):
	model = Wife
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_object_or_404(Calculation, pk=kwargs['calc_id'])
		if self.calc.heir_set.instance_of(Wife).count() >= 4:
			messages.error(request,_("Cann't have more than 4 wifes"))
			return HttpResponseRedirect(reverse( 'calc:error'))
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="F"
		self.object.save()
		form.instance.calc.add_wife(self.object)
		return super().form_valid(form)

class DaughterCreate(CreateView):
	model = Daughter
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_object_or_404(Calculation, pk=kwargs['calc_id'])
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex ="F"
		self.object.save()
		if form.instance.calc.deceased_set.first().sex =='M':
			father = form.instance.calc.deceased_set.first()
			if form.instance.calc.deceased_set.first().male.count()==1:
				mother =form.instance.calc.deceased_set.first().male.first().female
			elif form.instance.calc.deceased_set.first().male.count()==0:
				mother = None
			else:
				mother = get_object_or_404(Wife, pk=self.request.POST.get('mother'))
		else:
			 mother = form.instance.calc.deceased_set.first()
			 if form.instance.calc.deceased_set.first().female.count()==1:
				 father = form.instance.calc.deceased_set.first().female.first().male
			 else:
				 father = None
		form.instance.calc.add_daughter(self.object, mother=mother, father=father)
		return super().form_valid(form)

class SonCreate(CreateView):
	model = Son
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_object_or_404(Calculation, pk=kwargs['calc_id'])
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="M"
		self.object.save()
		if form.instance.calc.deceased_set.first().sex =='M':
			father = form.instance.calc.deceased_set.first()
			if form.instance.calc.deceased_set.first().male.count()==1:
				mother =form.instance.calc.deceased_set.first().male.first().female
			elif form.instance.calc.deceased_set.first().male.count()==0:
				mother = None
			else:
				mother = get_object_or_404(Wife, pk=self.request.POST.get('mother'))
		else:
			 mother = form.instance.calc.deceased_set.first()
			 if form.instance.calc.deceased_set.first().female.count()==1:
				 father = form.instance.calc.deceased_set.first().female.first().male
			 else:
				 father = None
		form.instance.calc.add_son(self.object, mother=mother, father=father)
		return super().form_valid(form)

class BrotherCreate(CreateView):
	model = Brother
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_object_or_404(Calculation, pk=kwargs['calc_id'])
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="M"
		self.object.save()
		form.instance.calc.add_brother(self.object)
		return super().form_valid(form)

class HeirUpdate(UpdateView):
	model = Heir
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'

class HeirDelete(DeleteView):
	model = Heir
	template_name = 'calc/heir_confirm_delete.html'

	def delete(self, request, *args, **kwargs):
		self.object = self.get_object()
		self.calc = self.object.calc # assuming that deceased have a foreignkey reference to Calculation model
		self.object.delete()
		success_url = self.get_success_url()
		return HttpResponseRedirect(success_url)

	def get_success_url(self):
		calc = self.calc
		return reverse(  # no need for lazy here
			'calc:detail',
			 kwargs={'pk': calc.id}
		)
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

	def get_context_data(self, **kwargs):
		context = super().get_context_data(**kwargs)
		context['Father'] = self.object.heir_set.instance_of(Father)
		context['Mother'] = self.object.heir_set.instance_of(Mother)
		context['Wife'] = self.object.heir_set.instance_of(Wife)
		context['Husband'] = self.object.heir_set.instance_of(Husband)
		context['Daughter'] = self.object.heir_set.instance_of(Daughter)
		context['Son'] = self.object.heir_set.instance_of(Son)
		context['Heirs'] = self.object.heir_set.order_by('polymorphic_ctype_id')
		return context

class ResultsView(LoginRequired, generic.DetailView):
	model = Calculation
	template_name = 'calc/results.html'

	def get_context_data(self, **kwargs):
		context = super().get_context_data(**kwargs)
		context['Father'] = self.object.heir_set.instance_of(Father)
		context['Mother'] = self.object.heir_set.instance_of(Mother)
		context['Wife'] = self.object.heir_set.instance_of(Wife)
		context['Husband'] = self.object.heir_set.instance_of(Husband)
		context['Daughter'] = self.object.heir_set.instance_of(Daughter)
		context['Son'] = self.object.heir_set.instance_of(Son)
		context['female_asaba'] = self.object.heir_set.filter(asaba=True, sex="F")
		context['male_asaba'] = self.object.heir_set.filter(asaba=True, sex="M")
		context['asaba'] = self.object.heir_set.filter(asaba=True)


		return context

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_object_or_404(Calculation, pk=kwargs['pk'])
		self.calc.compute()
		return super().dispatch(request, *args, **kwargs)

class CalculationUpdate(UpdateView):
	model = Calculation
	fields = ['name']

def new(request):
	name = request.POST["name"]
	if name == "":
		messages.error(request,_("Must enter a name for your calcualtion") )
		return HttpResponseRedirect(reverse('calc:error'))

	user = request.user
	calc = Calculation.objects.create (name=name, user=user)
	if 'next' in request.POST and request.POST['next'] != "":
		return HttpResponseRedirect(reverse('calc:detail', args=(calc.id,)))
	else:
		return HttpResponseRedirect(reverse('calc:index'))

def father(request, pk):
	calc = get_object_or_404(Calculation, pk=pk)
	first_name = request.POST.get('first_name')
	last_name = request.POST.get('last_name')
	calc.add_father(first_name=first_name, last_name=last_name)
	return HttpResponseRedirect(reverse('calc:detail', args=(calc.id,)))


def delete(request, pk):
	calc = get_object_or_404(Calculation, pk=pk)
	if calc.user == request.user:
		calc.delete()
		return HttpResponseRedirect(reverse('calc:index'))
	else:
		messages.error(request,_("user not allowed") )
		return HttpResponseRedirect(reverse('calc:error'))

def error(request):
	return render(request, 'calc/error.html')

class SignUp(generic.CreateView):
	form_class = UserCreationForm
	success_url = reverse_lazy('login')
	template_name = 'registration/signup.html'
