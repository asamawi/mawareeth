from django.shortcuts import render


def index(request):
	context = dict()
	context['calc_content'] = "hello world"
	return render(request,'index.html',context=context)
