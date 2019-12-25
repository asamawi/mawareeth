from django.shortcuts import get_object_or_404, render
from .models import Calculation, Person, Marriage

def index(request):
	calculation_list = Calculation.objects.filter(user=request.user)
	context = dict()
	context['calc_content'] = "hello world"
	context['calculation_list'] = calculation_list
	return render(request,'index.html',context)

def detail(request, calculation_id):
	calculation = get_object_or_404(Calculation, pk=calculation_id)
	return render(request,'detail.html',{'calculation': calculation})

def results(request, calculation_id):
	calculation = get_object_or_404(Calculation, pk=calculation_id)
	return render(request,'results.html',{'calculation': calculation})

def vote(request, calculation_id):
	calculation = get_object_or_404(Calculation, pk=calculation_id)
	return render(request,'vote.html',{'calculation': calculation})
