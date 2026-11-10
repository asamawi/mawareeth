from django.http import Http404, HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404, render
from django.urls import reverse
from django.views import generic
from django.contrib.auth.views import LoginView
from django.contrib.auth.decorators import login_not_required, login_required
from django.utils.decorators import method_decorator
from django.views.generic import View
from django.contrib import messages
from django.db import transaction
from user_auth.forms import UserCreationForm
from django.urls import reverse_lazy
from calc.forms import HeirForm, DeceasedForm
from django.views.generic.edit import CreateView, UpdateView, DeleteView
from django.utils.translation import gettext as _
from django.views.generic.base import TemplateView
from .models import *
from .schools import UnsupportedCase
from waffle.mixins import WaffleFlagMixin, WaffleSwitchMixin

import waffle


def get_owned_calculation(request, pk):
	"""Return the user's own calculation, or 404 so case IDs cannot be probed."""
	return get_object_or_404(Calculation, pk=pk, user=request.user)


def lock_calculation(pk):
	"""Eagerly lock the case before loading or writing its people.

	A case deleted while the caller waited for the lock gives 404."""
	if not list(Calculation.objects.select_for_update().filter(pk=pk).values_list('pk', flat=True)):
		raise Http404


class CalculationLockMixin:
	"""Serialize person POSTs with compute and case deletion."""
	def locked_calc_id(self):
		if isinstance(self, CreateView):
			return self.calc.pk
		return get_object_or_404(
			self.get_queryset().values('calc_id'), pk=self.kwargs['pk'])['calc_id']

	def post(self, request, *args, **kwargs):
		with transaction.atomic():
			lock_calculation(self.locked_calc_id())
			return super().post(request, *args, **kwargs)


class OwnedCalculationMixin:
	"""Limit a Calculation view to the logged-in user's own calculations."""
	def get_queryset(self):
		return super().get_queryset().filter(user=self.request.user)


class OwnedByCalculationMixin:
	"""Limit a Deceased or Heir view to people in the user's own calculations."""
	def get_queryset(self):
		return super().get_queryset().filter(calc__user=self.request.user)



@method_decorator(login_not_required, name='dispatch')
class HomePage(TemplateView):
	template_name="calc/home.html"

	def get(self, request, **kwargs):
		if request.user.is_authenticated:
			return HttpResponseRedirect(reverse( 'calc:index'))
		else:
			context = self.get_context_data(**kwargs)
			return self.render_to_response(context)
@method_decorator(login_not_required, name='dispatch')
class Terms(TemplateView):
	template_name="calc/terms.html"
@method_decorator(login_not_required, name='dispatch')
class Privacy(TemplateView):
	template_name="calc/privacy.html"
@method_decorator(login_not_required, name='dispatch')
class About(TemplateView):
	template_name="calc/about.html"
class DeceasedCreate(CalculationLockMixin, CreateView):
	model = Deceased
	fields = ['first_name','last_name','sex', 'estate']

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
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

class DeceasedUpdate(CalculationLockMixin, OwnedByCalculationMixin, UpdateView):
	model = Deceased
	fields = ['first_name','last_name', 'estate']

class DeceasedDelete(CalculationLockMixin, OwnedByCalculationMixin, DeleteView):
	model = Deceased
	http_method_names = ['get', 'head', 'post', 'options']

	def form_valid(self, form):
		self.calc = self.object.calc
		with transaction.atomic():
			self.calc.heir_set.all().delete()
			return super().form_valid(form)

	def get_success_url(self):
		calc = self.calc
		return reverse(  # no need for lazy here
			'calc:detail',
			 kwargs={'pk': calc.id}
		)
class MotherCreate(CalculationLockMixin, CreateView):
	model = Mother
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
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

class FatherCreate(CalculationLockMixin, CreateView):
	model = Father
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
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

class HusbandCreate(CalculationLockMixin, CreateView):
	model = Husband
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
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

class WifeCreate(CalculationLockMixin, CreateView):
	model = Wife
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
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

def child_parents(calc, request):
	"""The (mother, father) of a son or daughter being added to this case.

	The mother is optional: the shares do not depend on her. A chosen mother must be
	a wife in this case.
	"""
	deceased = calc.deceased_set.first()
	if deceased.sex != 'M':
		marriages = deceased.female_marriages
		father = marriages.first().male if marriages.count() == 1 else None
		return deceased, father
	marriages = deceased.male_marriages
	if marriages.count() == 1:
		return marriages.first().female, deceased
	chosen = request.POST.get('mother')
	if not chosen:
		return None, deceased
	if not chosen.isdecimal():
		raise Http404
	return get_object_or_404(Wife, pk=chosen, calc=calc), deceased


class DaughterCreate(CalculationLockMixin, CreateView):
	model = Daughter
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		# Checked first, so a refused request leaves no heir behind.
		mother, father = child_parents(self.calc, self.request)
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex = "F"
		self.object.save()
		form.instance.calc.add_daughter(self.object, mother=mother, father=father)
		return super().form_valid(form)

class SonCreate(CalculationLockMixin, CreateView):
	model = Son
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		# Checked first, so a refused request leaves no heir behind.
		mother, father = child_parents(self.calc, self.request)
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex = "M"
		self.object.save()
		form.instance.calc.add_son(self.object, mother=mother, father=father)
		return super().form_valid(form)

class BrotherCreate(CalculationLockMixin, WaffleFlagMixin, CreateView):
	model = Brother
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'
	waffle_flag = "Brother"

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
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

class SisterCreate(CalculationLockMixin, WaffleFlagMixin, CreateView):
	model = Sister
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'
	waffle_flag = "Sister"

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="F"
		self.object.save()
		form.instance.calc.add_sister(self.object)
		return super().form_valid(form)

class GrandFatherCreate(CalculationLockMixin, WaffleFlagMixin, CreateView):
	model = GrandFather
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'
	waffle_flag = "GrandFather"

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
		if self.calc.heir_set.instance_of(GrandFather).count() >= 1:
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
		form.instance.calc.add_grandFather(self.object)
		return super().form_valid(form)

class GrandMotherCreate(CalculationLockMixin, WaffleFlagMixin, CreateView):
	model = GrandMother
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'
	waffle_flag = "GrandMother"

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="F"
		self.object.save()
		form.instance.calc.add_grandMother(self.object)
		return super().form_valid(form)

class SonOfSonCreate(CalculationLockMixin, WaffleFlagMixin, CreateView):
	model = SonOfSon
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'
	waffle_flag = "SonOfSon"

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="M"
		self.object.save()
		form.instance.calc.add_sonOfSon(self.object)
		return super().form_valid(form)

class DaughterOfSonCreate(CalculationLockMixin, WaffleFlagMixin, CreateView):
	model = DaughterOfSon
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'
	waffle_flag = "DaughterOfSon"

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="F"
		self.object.save()
		form.instance.calc.add_daughterOfSon(self.object)
		return super().form_valid(form)

class PaternalSisterCreate(CalculationLockMixin, WaffleFlagMixin, CreateView):
	model = PaternalSister
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'
	waffle_flag = "PaternalSister"

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="F"
		self.object.save()
		form.instance.calc.add_paternalSister(self.object)
		return super().form_valid(form)

class PaternalBrotherCreate(CalculationLockMixin, WaffleFlagMixin, CreateView):
	model = PaternalBrother
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'
	waffle_flag = "PaternalBrother"

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="M"
		self.object.save()
		form.instance.calc.add_paternalBrother(self.object)
		return super().form_valid(form)

class MaternalSisterCreate(CalculationLockMixin, WaffleFlagMixin, CreateView):
	model = MaternalSister
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'
	waffle_flag = "MaternalSister"

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="F"
		self.object.save()
		form.instance.calc.add_maternalSister(self.object)
		return super().form_valid(form)

class MaternalBrotherCreate(CalculationLockMixin, WaffleFlagMixin, CreateView):
	model = MaternalBrother
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'
	waffle_flag = "MaternalBrother"

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="M"
		self.object.save()
		form.instance.calc.add_maternalBrother(self.object)
		return super().form_valid(form)

class SonOfBrotherCreate(CalculationLockMixin, WaffleFlagMixin, CreateView):
	model = SonOfBrother
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'
	waffle_flag = "SonOfBrother"

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="M"
		self.object.save()
		form.instance.calc.add_sonOfBrother(self.object)
		return super().form_valid(form)

class SonOfPaternalBrotherCreate(CalculationLockMixin, WaffleFlagMixin, CreateView):
	model = SonOfPaternalBrother
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'
	waffle_flag = "SonOfPaternalBrother"

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="M"
		self.object.save()
		form.instance.calc.add_sonOfPaternalBrother(self.object)
		return super().form_valid(form)

class UncleCreate(CalculationLockMixin, WaffleFlagMixin, CreateView):
	model = Uncle
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'
	waffle_flag = "Uncle"

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="M"
		self.object.save()
		form.instance.calc.add_uncle(self.object)
		return super().form_valid(form)

class PaternalUncleCreate(CalculationLockMixin, WaffleFlagMixin, CreateView):
	model = PaternalUncle
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'
	waffle_flag = "PaternalUncle"

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="M"
		self.object.save()
		form.instance.calc.add_paternalUncle(self.object)
		return super().form_valid(form)

class SonOfUncleCreate(CalculationLockMixin, WaffleFlagMixin, CreateView):
	model = SonOfUncle
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'
	waffle_flag = "SonOfUncle"

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="M"
		self.object.save()
		form.instance.calc.add_sonOfUncle(self.object)
		return super().form_valid(form)

class SonOfPaternalUncleCreate(CalculationLockMixin, WaffleFlagMixin, CreateView):
	model = SonOfPaternalUncle
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'
	waffle_flag = "SonOfPaternalUncle"

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['calc_id'])
		return super().dispatch(request, *args, **kwargs)

	def form_valid(self, form):
		"""
		Overridden to add the relation to the calculation instance.
		"""
		form.instance.calc = self.calc
		self.object = form.save()
		self.object.sex="M"
		self.object.save()
		form.instance.calc.add_sonOfPaternalUncle(self.object)
		return super().form_valid(form)

class HeirUpdate(CalculationLockMixin, OwnedByCalculationMixin, UpdateView):
	model = Heir
	fields = ['first_name','last_name']
	template_name = 'calc/heir_form.html'

class HeirDelete(CalculationLockMixin, OwnedByCalculationMixin, DeleteView):
	model = Heir
	template_name = 'calc/heir_confirm_delete.html'
	http_method_names = ['get', 'head', 'post', 'options']

	def form_valid(self, form):
		self.calc = self.object.calc
		return super().form_valid(form)

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


class DetailView(OwnedCalculationMixin, LoginRequired, generic.DetailView):
	model = Calculation
	template_name = 'calc/detail.html'

	def dispatch(self, request, *args, **kwargs):
		"""
		Checked here too because get_queryset only runs on GET, and a
		non-owner must also get 404 on POST.
		"""
		get_owned_calculation(request, kwargs['pk'])
		return super().dispatch(request, *args, **kwargs)

	def get_context_data(self, **kwargs):
		context = super().get_context_data(**kwargs)
		context['Father'] = self.object.heir_set.instance_of(Father)
		context['Mother'] = self.object.heir_set.instance_of(Mother)
		context['Wife'] = self.object.heir_set.instance_of(Wife)
		context['Husband'] = self.object.heir_set.instance_of(Husband)
		context['Daughter'] = self.object.heir_set.instance_of(Daughter)
		context['Son'] = self.object.heir_set.instance_of(Son)
		context['Brother'] = self.object.heir_set.instance_of(Brother)
		context['Sister'] = self.object.heir_set.instance_of(Sister)
		context['GrandFather'] = self.object.heir_set.instance_of(GrandFather)
		context['Heirs'] = self.object.heir_set.order_by('polymorphic_ctype_id')
		return context

class NewResultsView(OwnedCalculationMixin, WaffleFlagMixin, LoginRequired, generic.DetailView):
	model = Calculation
	template_name = 'calc/new_results.html'
	waffle_flag= "new_results"

	def get_context_data(self, **kwargs):
		context = super().get_context_data(**kwargs)
		context['Father'] = self.object.heir_set.instance_of(Father)
		context['Mother'] = self.object.heir_set.instance_of(Mother)
		context['Wife'] = self.object.heir_set.instance_of(Wife)
		context['Husband'] = self.object.heir_set.instance_of(Husband)
		context['Daughter'] = self.object.heir_set.instance_of(Daughter)
		context['Son'] = self.object.heir_set.instance_of(Son)
		context['Brother'] = self.object.heir_set.instance_of(Brother)
		context['Sister'] = self.object.heir_set.instance_of(Sister)
		context['GrandFather'] = self.object.heir_set.instance_of(GrandFather)
		context['female_asaba'] = self.object.heir_set.filter(asaba=True,sex="F")
		context['asaba'] = self.object.heir_set.filter(asaba=True).order_by('polymorphic_ctype_id')
		context['Heirs'] = self.object.heir_set.filter(asaba=False).order_by('polymorphic_ctype_id')
		context['Spouse'] = self.object.heir_set.instance_of(Husband, Wife)
		context['No_Spouse'] = self.object.heir_set.not_instance_of(Husband, Wife)
		return context

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['pk'])
		return super().dispatch(request, *args, **kwargs)

	def get(self, request, *args, **kwargs):
		try:
			self.calc.compute()
		except Calculation.DoesNotExist as exc:
			raise Http404 from exc
		except UnsupportedCase as exc:
			messages.error(request, exc.message)
			return render(request, 'calc/error.html')
		return super().get(request, *args, **kwargs)

class ResultsView(OwnedCalculationMixin, LoginRequired, generic.DetailView):
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
		context['Brother'] = self.object.heir_set.instance_of(Brother)
		context['Sister'] = self.object.heir_set.instance_of(Sister)
		context['GrandFather'] = self.object.heir_set.instance_of(GrandFather)
		context['female_asaba'] = self.object.heir_set.filter(asaba=True,sex="F")
		context['asaba'] = self.object.heir_set.filter(asaba=True).order_by('polymorphic_ctype_id')
		context['Heirs'] = self.object.heir_set.filter(asaba=False).order_by('polymorphic_ctype_id')
		context['Spouse'] = self.object.heir_set.instance_of(Husband, Wife)
		context['No_Spouse'] = self.object.heir_set.not_instance_of(Husband, Wife)
		return context

	def dispatch(self, request, *args, **kwargs):
		"""
		Overridden so we can make sure the `calc` instance exists
		before going any further.
		"""
		self.calc = get_owned_calculation(request, kwargs['pk'])
		return super().dispatch(request, *args, **kwargs)

	def get(self, request, *args, **kwargs):
		try:
			self.calc.compute()
		except Calculation.DoesNotExist as exc:
			raise Http404 from exc
		except UnsupportedCase as exc:
			messages.error(request, exc.message)
			return render(request, 'calc/error.html')
		return super().get(request, *args, **kwargs)

class CalculationUpdate(OwnedCalculationMixin, UpdateView):
	model = Calculation
	fields = ['name']

def new(request):
	# A login redirect replays this URL as a GET, with no form data to read.
	if request.method != "POST":
		return HttpResponseRedirect(reverse('calc:index'))
	name = request.POST.get("name", "")
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
	calc = get_owned_calculation(request, pk)
	# Only a POST deletes, so that CSRF protection applies and a link on
	# another site cannot delete a case. An old link just lands on the list.
	if request.method == "POST":
		with transaction.atomic():
			# Match the lock order in compute().
			lock_calculation(calc.pk)
			calc.delete()
	return HttpResponseRedirect(reverse('calc:index'))

# After login there is nothing useful to return to here: `next` would only
# replay a GET, which never deletes. Send the user to their list instead.
delete.redirect_field_name = None

@login_not_required
def error(request):
	return render(request, 'calc/error.html')

@method_decorator(login_not_required, name='dispatch')
class SignUp(generic.CreateView):
	form_class = UserCreationForm
	success_url = reverse_lazy('login')
	template_name = 'registration/signup.html'
