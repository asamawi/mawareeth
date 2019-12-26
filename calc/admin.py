from django.contrib import admin

from .models import Calculation, Person, Marriage

admin.site.register(Calculation)
admin.site.register(Person)
admin.site.register(Marriage)
