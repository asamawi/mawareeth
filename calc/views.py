from django.http import HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404, render
from django.urls import reverse
from django.views import generic
from django.contrib.auth.views import LoginView
from django.contrib.auth.decorators import login_required
from django.utils.decorators import method_decorator
from django.views.generic import View
from django.contrib import messages
from django.contrib.auth.forms import UserCreationForm
from django.urls import reverse_lazy
from calc.forms import HeirForm, DeceasedForm
from django.views.generic.edit import CreateView, UpdateView, DeleteView

from .models import Calculation, Person, Marriage, Deceased, Father

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
            messages.error(request,"Decease already exist")
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
    fields = ['first_name','last_name','sex', 'estate']

class DeceasedDelete(DeleteView):
    model = Deceased
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
        return context

class ResultsView(LoginRequired, generic.DetailView):
	model = Calculation
	template_name = 'calc/results.html'

def new(request):
    name = request.POST["name"]
    if name == "":
        messages.error(request,"Must enter a name for your calcualtion" )
        return HttpResponseRedirect(reverse('calc:error'))

    user = request.user
    calc = Calculation.objects.create (name=name, user=user)
    if 'next' in request.POST and request.POST['next'] != "":
        return HttpResponseRedirect(reverse('calc:detail', args=(calc.id,)))
    else:
        return HttpResponseRedirect(reverse('calc:index'))
def deceased(request, pk):
    calc = get_object_or_404(Calculation, pk=pk)
    sex = request.POST.get('sex')
    first_name = request.POST.get('first_name')
    last_name = request.POST.get('last_name')
    estate = request.POST.get('estate')
    Deceased.objects.create(calc=calc, sex=sex, first_name=first_name, last_name=last_name, estate=estate)
    return HttpResponseRedirect(reverse('calc:detail', args=(calc.id,)))

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
        messages.error(request,"user not allowed" )
        return HttpResponseRedirect(reverse('calc:error'))

def error(request):
    return render(request, 'calc/error.html')

class SignUp(generic.CreateView):
    form_class = UserCreationForm
    success_url = reverse_lazy('login')
    template_name = 'registration/signup.html'
