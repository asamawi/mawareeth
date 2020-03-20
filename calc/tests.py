from django.test import TestCase, Client
from calc.models import *
from django.contrib.auth.models import User
from django.contrib.auth import authenticate
from django.http.request import HttpRequest
from django.urls import reverse

from . import views



class PersonTestCase(TestCase):

    def setUp(self):
        Person.objects.create(sex='M',first_name='Father')
        Person.objects.create(sex='M',first_name='Son')

    def test_person_can_add_father(self):
        father = Person.objects.get(first_name="Father")
        son = Person.objects.get(first_name="Son")
        self.assertIs(son.add_father(father), father)
        self.assertIs(son.parents.male, father)

class CalculationTestCase(TestCase):

    def setUp(self):
        user1 = User.objects.create_user('john', 'lennon@thebeatles.com', 'johnpassword')
        user2 = User.objects.create_user('sandra', 'bullock@missconj.com', 'sandrapassword')
        calc1 = Calculation.objects.create(name='calc1', user=user1)
        calc2 = Calculation.objects.create(name='calc2', user=user2)
        deceased = Deceased.objects.create(first_name="Deceased", last_name="test", sex="M",estate="1000",calc=calc1)
        father = Father.objects.create(first_name="Father", last_name="test", sex="M", calc=calc1)
        calc1.add_father(father)
        mother = Mother.objects.create(first_name="Mother", last_name="test", sex="F", calc=calc1)
        calc1.add_mother(mother)

    def test_index(self):
        c = Client()
        logged_in = c.login(username='john', password='johnpassword')
        response = c.get('/en/')
        self.assertTrue(logged_in)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["calculation_list"].count(), 1)

    def test_calc_page(self):
        c = Client()
        calc = Calculation.objects.get(name="calc1")
        logged_in = c.login(username='john', password='johnpassword')
        response = c.get(f"/en/{calc.id}/")
        self.assertTrue(logged_in)
        self.assertEqual(response.status_code, 200)

    def test_delete_calc(self):
        calc = Calculation.objects.get(name="calc1")
        expected = (10, {'calc.Calculation': 1, 'calc.Deceased': 1, 'calc.Marriage': 1, 'calc.Father': 1, 'calc.Mother': 1, 'calc.Heir': 2, 'calc.Person': 3})
        result = calc.delete()
        self.assertEquals(result, expected)

class CalculationHasDescenentTestCase(TestCase):

    def setUp(self):
        user1 = User.objects.create_user('john', 'lennon@thebeatles.com', 'johnpassword')
        user2 = User.objects.create_user('sandra', 'bullock@missconj.com', 'sandrapassword')
        calc1 = Calculation.objects.create(name='calc1', user=user1)
        calc2 = Calculation.objects.create(name='calc2', user=user2)
        calc3 = Calculation.objects.create(name='calc3', user=user2)

        deceased = Deceased.objects.create(first_name="Deceased", last_name="test", sex="M",estate="1000",calc=calc1)
        deceased2 = Deceased.objects.create(first_name="Deceased2", last_name="test", sex="M",estate="1000",calc=calc2)

        father = Father.objects.create(first_name="Father", last_name="test", sex="M", calc=calc1)
        calc1.add_father(father)
        mother = Mother.objects.create(first_name="Mother", last_name="test", sex="F", calc=calc1)
        calc1.add_mother(mother)
        daughter = Daughter.objects.create(first_name="Daughter", last_name="test", sex="F", calc=calc1)
        calc1.add_daughter(daughter, mother=mother, father=father)
        son = Son.objects.create(first_name="Son", last_name="test", sex="M", calc=calc2)
        calc2.add_son(son, mother=mother, father=father)

    def test_has_descenent(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc2 = Calculation.objects.get(name="calc2")
        calc3 = Calculation.objects.get(name="calc3")
        self.assertEquals(calc1.has_descendent(), True)
        self.assertEquals(calc2.has_descendent(), True)
        self.assertEquals(calc3.has_descendent(), False)

    def test_has_male_descenent(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc2 = Calculation.objects.get(name="calc2")
        calc3 = Calculation.objects.get(name="calc3")
        self.assertEquals(calc1.has_male_descendent(), False)
        self.assertEquals(calc2.has_male_descendent(), True)
        self.assertEquals(calc3.has_male_descendent(), False)
    def test_has_female_descenent(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc2 = Calculation.objects.get(name="calc2")
        calc3 = Calculation.objects.get(name="calc3")
        self.assertEquals(calc1.has_female_descendent(), True)
        self.assertEquals(calc2.has_female_descendent(), False)
        self.assertEquals(calc3.has_female_descendent(), False)

class FatherQuoteTestCase(TestCase):

    def setUp(self):
        user1 = User.objects.create_user('john', 'lennon@thebeatles.com', 'johnpassword')
        #case 1 where father has quote 1/6 only
        calc1 = Calculation.objects.create(name='calc1', user=user1)
        deceased = Deceased.objects.create(first_name="Deceased", last_name="test", sex="M",estate="1000",calc=calc1)
        father = Father.objects.create(first_name="Father", last_name="test", sex="M", calc=calc1)
        calc1.add_father(father)
        son1 = Son.objects.create(first_name="Son", last_name="test", sex="M", calc=calc1)
        calc1.add_son(son1, mother=None, father=father)
        #case 2 where father has quote 1/6 and remainder
        calc2 = Calculation.objects.create(name='calc2', user=user1)
        deceased2 = Deceased.objects.create(first_name="Deceased2", last_name="test", sex="M",estate="1000",calc=calc2)
        father2 = Father.objects.create(first_name="Father2", last_name="test", sex="M", calc=calc2)
        calc2.add_father(father2)
        daughter = Daughter.objects.create(first_name="Daughter", last_name="test", sex="F", calc=calc2)
        calc2.add_daughter(daughter, mother=None, father=father2)
        #case 3 where father has remainder only
        calc3 = Calculation.objects.create(name='calc3', user=user1)
        deceased3 = Deceased.objects.create(first_name="Deceased3", last_name="test", sex="M",estate="1000",calc=calc3)
        father3 = Father.objects.create(first_name="Father3", last_name="test", sex="M", calc=calc3)

    def test_father_qet_quote(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc2 = Calculation.objects.get(name="calc2")
        calc3 = Calculation.objects.get(name="calc3")
        calc1.get_quotes()
        calc2.get_quotes()
        calc3.get_quotes()
        self.assertEquals(Fraction(calc1.get_father().quote).limit_denominator(), Fraction(1,6))
        self.assertEquals(calc1.get_father().asaba, False)
        self.assertEquals(Fraction(calc2.get_father().quote).limit_denominator(), Fraction(1,6))
        self.assertEquals(calc2.get_father().asaba, True)
        self.assertEquals(Fraction(calc3.get_father().quote).limit_denominator(), Fraction())
        self.assertEquals(calc3.get_father().asaba, True)

class CalculationHasSpouseTestCase(TestCase):

    def setUp(self):
        user1 = User.objects.create_user('john', 'lennon@thebeatles.com', 'johnpassword')
        calc1 = Calculation.objects.create(name='calc1', user=user1)
        deceased = Deceased.objects.create(first_name="Deceased", last_name="test", sex="M",estate="1000",calc=calc1)
        wife = Wife.objects.create(first_name="Wife", last_name="test", sex="F", calc=calc1)
        calc1.add_wife(wife)

        calc2 = Calculation.objects.create(name='calc2', user=user1)
        deceased2 = Deceased.objects.create(first_name="Deceased2", last_name="test", sex="F",estate="1000",calc=calc2)
        husband = Husband.objects.create(first_name="Husband", last_name="test", sex="M", calc=calc2)
        calc2.add_husband(husband)

        calc3 = Calculation.objects.create(name='calc3', user=user1)
        deceased3 = Deceased.objects.create(first_name="Deceased3", last_name="test", sex="M",estate="1000",calc=calc3)
        father3 = Father.objects.create(first_name="Father3", last_name="test", sex="M", calc=calc3)
        calc3.add_father(father3)

    def test_has_spouse(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc2 = Calculation.objects.get(name="calc2")
        calc3 = Calculation.objects.get(name="calc3")
        self.assertEquals(calc1.has_spouse(), True)
        self.assertEquals(calc2.has_spouse(), True)
        self.assertEquals(calc3.has_spouse(), False)

    def test_has_father(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc2 = Calculation.objects.get(name="calc2")
        calc3 = Calculation.objects.get(name="calc3")
        self.assertEquals(calc1.has_father(), False)
        self.assertEquals(calc2.has_father(), False)
        self.assertEquals(calc3.has_father(), True)

class MotherQuoteTestCase(TestCase):

    def setUp(self):
        user1 = User.objects.create_user('john', 'lennon@thebeatles.com', 'johnpassword')
        #case 1 where mother gets 1/6
        calc1 = Calculation.objects.create(name='calc1', user=user1)
        deceased = Deceased.objects.create(first_name="Deceased", last_name="test", sex="M",estate="1000",calc=calc1)
        mother = Mother.objects.create(first_name="Mother", last_name="test", sex="F", calc=calc1)
        calc1.add_mother(mother)
        son1 = Son.objects.create(first_name="Son", last_name="test", sex="M", calc=calc1)
        calc1.add_son(son1, mother=mother, father=None)
        #case 2 & 3 where mother has quote 1/3 of the remainder
        calc2 = Calculation.objects.create(name='calc2', user=user1)
        deceased2 = Deceased.objects.create(first_name="Deceased2", last_name="test", sex="M",estate="1000",calc=calc2)
        mother2 = Mother.objects.create(first_name="Mother2", last_name="test", sex="F", calc=calc2)
        calc2.add_mother(mother2)
        wife2 = Wife.objects.create(first_name="Wife2", last_name="test", sex="F", calc=calc2)
        calc2.add_wife(wife2)
        father2 = Father.objects.create(first_name="Father2", last_name="test", sex="M", calc=calc2)
        calc2.add_father(father2)

        calc3 = Calculation.objects.create(name='calc3', user=user1)
        deceased3 = Deceased.objects.create(first_name="Deceased3", last_name="test", sex="F",estate="1000",calc=calc3)
        father3 = Father.objects.create(first_name="Father3", last_name="test", sex="M", calc=calc3)
        calc3.add_father(father3)
        mother3 = Mother.objects.create(first_name="Mother3", last_name="test", sex="F", calc=calc3)
        calc3.add_mother(mother2)
        husband3 = Husband.objects.create(first_name="Husband3", last_name="test", sex="M", calc=calc3)
        calc3.add_husband(husband3)

    def test_father_qet_quote(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc2 = Calculation.objects.get(name="calc2")
        calc3 = Calculation.objects.get(name="calc3")
        calc1.get_quotes()
        calc2.get_quotes()
        calc3.get_quotes()
        self.assertEquals(Fraction(calc1.get_mother().quote).limit_denominator(), Fraction(1,6))
        self.assertEquals(calc1.get_mother().asaba, False)
        self.assertEquals(Fraction(calc2.get_mother().quote).limit_denominator(), Fraction(1,4))
        self.assertEquals(calc2.get_mother().asaba, False)
        self.assertEquals(Fraction(calc3.get_mother().quote).limit_denominator(), Fraction(1,6))
        self.assertEquals(calc3.get_mother().asaba, False)

class HusbandQuoteTestCase(TestCase):

    def setUp(self):
        user1 = User.objects.create_user('john', 'lennon@thebeatles.com', 'johnpassword')
        #case 1 where Husband get 1/4
        calc1 = Calculation.objects.create(name='calc1', user=user1)
        deceased = Deceased.objects.create(first_name="Deceased", last_name="test", sex="F",estate="1000",calc=calc1)
        son1 = Son.objects.create(first_name="Son", last_name="test", sex="M", calc=calc1)
        calc1.add_son(son1, mother=None, father=None)
        husband1 = Husband.objects.create(first_name="Husband1", last_name="test", sex="M", calc=calc1)
        calc1.add_husband(husband1)

        #case 2  where husband get 1/2
        calc2 = Calculation.objects.create(name='calc2', user=user1)
        deceased2 = Deceased.objects.create(first_name="Deceased2", last_name="test", sex="F",estate="1000",calc=calc2)
        mother2 = Mother.objects.create(first_name="Mother2", last_name="test", sex="F", calc=calc2)
        calc2.add_mother(mother2)
        father2 = Father.objects.create(first_name="Father2", last_name="test", sex="M", calc=calc2)
        calc2.add_father(father2)
        husband2 = Husband.objects.create(first_name="Husband2", last_name="test", sex="M", calc=calc2)
        calc2.add_husband(husband2)

    def test_husband_qet_quote(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc2 = Calculation.objects.get(name="calc2")

        calc1.get_quotes()
        calc2.get_quotes()

        self.assertEquals(Fraction(calc1.get_husband().quote).limit_denominator(), Fraction(1,4))
        self.assertEquals(calc1.get_husband().asaba, False)
        self.assertEquals(Fraction(calc2.get_husband().quote).limit_denominator(), Fraction(1,2))
        self.assertEquals(calc2.get_husband().asaba, False)
