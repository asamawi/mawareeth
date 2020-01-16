from django import forms
from django.utils.translation import gettext as _


class HeirForm(forms.Form):
    clac = forms.HiddenInput()
    first_name = forms.CharField(label=_('First Name'))
    last_name = forms.CharField(label=_('Last Name'))

class DeceasedForm(forms.Form):
    calc = forms.HiddenInput()
    first_name = forms.CharField(label=_('First Name'))
    last_name = forms.CharField(label=_('Last Name'))
    sex_options = ['M','F']
    sex = forms.ChoiceField(widget=forms.Select(choices=sex_options))
    estate = forms.IntegerField(localize=True)
