from django.test import TestCase
from calc.models import Person

class PersonTestCase(TestCase):
    def setUp(self):
        Person.objects.create(sex='M',first_name='Father')
        Person.objects.create(sex='M',first_name='Son')
    def test_person_can_add_father(self):
        father = Person.objects.get(first_name="Father")
        son = Person.objects.get(first_name="Son")
        self.assertIs(son.add_father(father), father)
        self.assertIs(son.parents.male, father)
