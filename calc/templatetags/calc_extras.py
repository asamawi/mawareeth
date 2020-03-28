from django import template
from django.utils.translation import gettext as _

register = template.Library()



@register.filter
def get_class(obj):
    return _(obj.__class__.__name__)
