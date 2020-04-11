from django.contrib import admin
from polymorphic.admin import PolymorphicParentModelAdmin, PolymorphicChildModelAdmin, PolymorphicChildModelFilter

from .models import *

admin.site.register(Calculation)
admin.site.register(Marriage)

class HeirAdmin(PolymorphicChildModelAdmin):
    """ Base admin class for all child models """
    base_model = Person # Optional, explicitly set here.

    # By using these `base_...` attributes instead of the regular ModelAdmin `form` and `fieldsets`,
    # the additional fields of the child models are automatically added to the admin form.
    # base_form = ...
    # base_fieldsets = (
    #     ...
    # )
    show_in_index = True

@admin.register(Deceased)
class DeceasedAdmin(HeirAdmin):
    base_model = Deceased  # Explicitly set here!
    show_in_index = True
    # define custom features here

@admin.register(Father)
class FatherAdmin(HeirAdmin):
    base_model = Father  # Explicitly set here!
    show_in_index = True
    # define custom features here

@admin.register(Mother)
class MotherAdmin(HeirAdmin):
    base_model = Mother  # Explicitly set here!
    show_in_index = True
    # define custom features here

@admin.register(Husband)
class HusbandAdmin(HeirAdmin):
    base_model = Husband  # Explicitly set here!
    show_in_index = True
    # define custom features here

@admin.register(Wife)
class WifeAdmin(HeirAdmin):
    base_model = Wife  # Explicitly set here!
    show_in_index = True
    # define custom features here

@admin.register(Daughter)
class DaughterAdmin(HeirAdmin):
    base_model = Daughter  # Explicitly set here!
    show_in_index = True
    # define custom features here

@admin.register(Son)
class SonAdmin(HeirAdmin):
    base_model = Son  # Explicitly set here!
    show_in_index = True
    # define custom features here

@admin.register(Brother)
class BrotherAdmin(HeirAdmin):
    base_model = Brother  # Explicitly set here!
    show_in_index = True
    # define custom features here

@admin.register(Sister)
class SisterAdmin(HeirAdmin):
    base_model = Sister  # Explicitly set here!
    show_in_index = True
    # define custom features here

@admin.register(Person)
class PersonAdmin(PolymorphicParentModelAdmin):
    """ The parent model admin """
    base_model = Person  # Optional, explicitly set here.
    child_models = (Father, Mother, Deceased, Daughter, Son)
    list_filter = (PolymorphicChildModelFilter,)  # This is optional.
