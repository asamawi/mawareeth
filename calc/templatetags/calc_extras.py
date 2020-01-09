from django import template

register = template.Library()



@register.filter
def get_class(obj):
    return obj.__class__.__name__
