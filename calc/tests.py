import re
from unittest import mock

from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from django.conf import settings
from django.core.cache import cache
from django.test import TestCase, Client, override_settings
from django.utils import translation
from calc.models import *
from django.contrib.auth.models import User
from django.contrib.auth import authenticate
from django.http.request import HttpRequest
from django.urls import resolve, reverse
from waffle.testutils import override_flag

from . import views
from mawareeth.urls import calc_patterns



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
        response = c.get('/en/calc',follow=True, secure=True)
        self.assertTrue(logged_in)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["calculation_list"].count(), 1)

    def test_calc_page(self):
        c = Client()
        calc = Calculation.objects.get(name="calc1")
        logged_in = c.login(username='john', password='johnpassword')
        response = c.get(f"/en/{calc.id}/",follow=True, secure=True)
        self.assertTrue(logged_in)
        self.assertEqual(response.status_code, 200)

    def test_delete_calc(self):
        calc = Calculation.objects.get(name="calc1")
        expected = (10, {'calc.Calculation': 1, 'calc.Deceased': 1, 'calc.Marriage': 1, 'calc.Father': 1, 'calc.Mother': 1, 'calc.Heir': 2, 'calc.Person': 3})
        result = calc.delete()
        self.assertEqual(result, expected)

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
        self.assertEqual(calc1.has_descendent(), True)
        self.assertEqual(calc2.has_descendent(), True)
        self.assertEqual(calc3.has_descendent(), False)

    def test_has_male_descenent(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc2 = Calculation.objects.get(name="calc2")
        calc3 = Calculation.objects.get(name="calc3")
        self.assertEqual(calc1.has_male_descendent(), False)
        self.assertEqual(calc2.has_male_descendent(), True)
        self.assertEqual(calc3.has_male_descendent(), False)
    def test_has_female_descenent(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc2 = Calculation.objects.get(name="calc2")
        calc3 = Calculation.objects.get(name="calc3")
        self.assertEqual(calc1.has_female_descendent(), True)
        self.assertEqual(calc2.has_female_descendent(), False)
        self.assertEqual(calc3.has_female_descendent(), False)

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
        calc3.add_father(father3)

    def test_father_qet_quote(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc2 = Calculation.objects.get(name="calc2")
        calc3 = Calculation.objects.get(name="calc3")
        calc1.compute()
        calc2.compute()
        calc3.compute()
        self.assertEqual(Fraction(calc1.get_father().quote).limit_denominator(), Fraction(1,6))
        self.assertEqual(calc1.get_father().asaba, False)
        self.assertEqual(Fraction(calc2.get_father().quote).limit_denominator(), Fraction(1,6))
        self.assertEqual(Fraction(calc3.get_father().quote).limit_denominator(), Fraction(1,1))
        self.assertEqual(calc3.get_father().asaba, True)

class GrandFatherQuoteTestCase(TestCase):

    def setUp(self):
        user1 = User.objects.create_user('john', 'lennon@thebeatles.com', 'johnpassword')
        #case 1 where Grandfather has quote 1/6 only
        calc1 = Calculation.objects.create(name='calc1', user=user1)
        deceased = Deceased.objects.create(first_name="Deceased", last_name="test", sex="M",estate="1000",calc=calc1)
        grandfather = GrandFather.objects.create(first_name="Grandfather", last_name="test", sex="M", calc=calc1)
        calc1.add_grandFather(grandfather)
        son1 = Son.objects.create(first_name="Son", last_name="test", sex="M", calc=calc1)
        calc1.add_son(son1, mother=None, father=None)
        #case 2 where Grandfather has quote 1/6 and remainder
        calc2 = Calculation.objects.create(name='calc2', user=user1)
        deceased2 = Deceased.objects.create(first_name="Deceased2", last_name="test", sex="M",estate="1000",calc=calc2)
        grandfather2 = GrandFather.objects.create(first_name="Grandfather2", last_name="test", sex="M", calc=calc2)
        calc2.add_grandFather(grandfather2)
        daughter = Daughter.objects.create(first_name="Daughter", last_name="test", sex="F", calc=calc2)
        calc2.add_daughter(daughter, mother=None, father=None)
        #case 3 where Grandfather has remainder only
        calc3 = Calculation.objects.create(name='calc3', user=user1)
        deceased3 = Deceased.objects.create(first_name="Deceased3", last_name="test", sex="M",estate="1000",calc=calc3)
        grandfather3 = GrandFather.objects.create(first_name="Grandfather3", last_name="test", sex="M", calc=calc3)
        calc3.add_grandFather(grandfather3)
        #case 4 where Grandfather is blocked by father
        calc4 = Calculation.objects.create(name='calc4', user=user1)
        deceased4 = Deceased.objects.create(first_name="Deceased4", last_name="test", sex="M",estate="1000",calc=calc4)
        father4 = Father.objects.create(first_name="Father4", last_name="test", sex="M", calc=calc4)
        calc4.add_father(father4)
        grandfather4 = GrandFather.objects.create(first_name="Grandfather4", last_name="test", sex="M", calc=calc4)
        calc4.add_grandFather(grandfather4)

    def test_grandfather_qet_quote(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc2 = Calculation.objects.get(name="calc2")
        calc3 = Calculation.objects.get(name="calc3")
        calc4 = Calculation.objects.get(name="calc4")
        calc1.compute()
        calc2.compute()
        calc3.compute()
        calc4.compute()
        self.assertEqual(Fraction(calc1.get_grandFather().quote).limit_denominator(), Fraction(1,6))
        self.assertEqual(calc1.get_grandFather().asaba, False)
        self.assertEqual(Fraction(calc2.get_grandFather().quote).limit_denominator(), Fraction(1,6))
        self.assertEqual(Fraction(calc3.get_grandFather().quote).limit_denominator(), Fraction(1,1))
        self.assertEqual(calc3.get_grandFather().asaba, True)
        self.assertEqual(Fraction(calc4.get_grandFather().quote).limit_denominator(), Fraction(0,1))
        self.assertEqual(calc4.get_grandFather().blocked, True)

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
        self.assertEqual(calc1.has_spouse(), True)
        self.assertEqual(calc2.has_spouse(), True)
        self.assertEqual(calc3.has_spouse(), False)

    def test_has_father(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc2 = Calculation.objects.get(name="calc2")
        calc3 = Calculation.objects.get(name="calc3")
        self.assertEqual(calc1.has_father(), False)
        self.assertEqual(calc2.has_father(), False)
        self.assertEqual(calc3.has_father(), True)

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
        self.assertEqual(Fraction(calc1.get_mother().quote).limit_denominator(), Fraction(1,6))
        self.assertEqual(calc1.get_mother().asaba, False)
        self.assertEqual(Fraction(calc2.get_mother().quote).limit_denominator(), Fraction(1,4))
        self.assertEqual(calc2.get_mother().asaba, False)
        self.assertEqual(Fraction(calc3.get_mother().quote).limit_denominator(), Fraction(1,6))
        self.assertEqual(calc3.get_mother().asaba, False)

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

        calc1.compute()
        calc2.compute()

        self.assertEqual(Fraction(calc1.get_husband().quote).limit_denominator(), Fraction(1,4))
        self.assertEqual(calc1.get_husband().asaba, False)
        self.assertEqual(Fraction(calc2.get_husband().quote).limit_denominator(), Fraction(1,2))
        self.assertEqual(calc2.get_husband().asaba, False)

class WifeQuoteTestCase(TestCase):

    def setUp(self):
        user1 = User.objects.create_user('john', 'lennon@thebeatles.com', 'johnpassword')
        #case 1 where wife get 1/8
        calc11 = Calculation.objects.create(name='calc11', user=user1)
        deceased = Deceased.objects.create(first_name="Deceased", last_name="test", sex="M",estate="1000",calc=calc11)
        son1 = Son.objects.create(first_name="Son", last_name="test", sex="M", calc=calc11)
        calc11.add_son(son1, mother=None, father=None)
        wife1 = Wife.objects.create(first_name="Wife1", last_name="test", sex="F", calc=calc11)
        calc11.add_wife(wife1)

        #case 2  where wife get 1/4
        calc2 = Calculation.objects.create(name='calc2', user=user1)
        deceased2 = Deceased.objects.create(first_name="Deceased2", last_name="test", sex="M",estate="1000",calc=calc2)
        mother2 = Mother.objects.create(first_name="Mother2", last_name="test", sex="F", calc=calc2)
        calc2.add_mother(mother2)
        father2 = Father.objects.create(first_name="Father2", last_name="test", sex="M", calc=calc2)
        calc2.add_father(father2)
        wife2 = Wife.objects.create(first_name="Wife2", last_name="test", sex="F", calc=calc2)
        calc2.add_wife(wife2)

        #case 3  where wives get 1/4
        calc3 = Calculation.objects.create(name='calc3', user=user1)
        deceased3 = Deceased.objects.create(first_name="Deceased3", last_name="test", sex="M",estate="1000",calc=calc3)
        wife3 = Wife.objects.create(first_name="Wife3", last_name="test", sex="F", calc=calc3)
        calc3.add_wife(wife3)
        wife4 = Wife.objects.create(first_name="Wife3", last_name="test", sex="F", calc=calc3)
        calc3.add_wife(wife4)
        wife5 = Wife.objects.create(first_name="Wife3", last_name="test", sex="F", calc=calc3)
        calc3.add_wife(wife5)

    def test_wife_qet_quote(self):
        calc11 = Calculation.objects.get(name="calc11")
        calc2 = Calculation.objects.get(name="calc2")
        calc3 = Calculation.objects.get(name="calc3")

        calc11.compute()
        calc2.compute()
        calc3.compute()

        self.assertEqual(Fraction(calc11.get_wives().first().quote).limit_denominator(), Fraction(1,8))
        self.assertEqual(calc11.get_wives().first().asaba, False)
        self.assertEqual(calc11.get_wives().first().shared_quote, False)
        self.assertEqual(calc11.get_fractions(calc11.heir_set.all()),{Fraction(7, 8), Fraction(1, 8)})
        self.assertEqual(calc11.shares,8)

        self.assertEqual(Fraction(calc2.get_wives().first().quote).limit_denominator(), Fraction(1,4))
        self.assertEqual(calc2.get_wives().first().asaba, False)
        self.assertEqual(calc2.get_wives().first().shared_quote, False)
        self.assertEqual(calc2.get_fractions(calc2.heir_set.all()), {Fraction(1,2), Fraction(1,4)})
        self.assertEqual(calc2.shares,4)

        self.assertEqual(Fraction(calc3.get_wives().first().quote).limit_denominator(), Fraction(1,4))
        self.assertEqual(calc3.get_wives().first().asaba, False)
        self.assertEqual(calc3.get_wives().first().shared_quote, True)
        self.assertEqual(calc3.get_fractions(calc3.heir_set.all()), {Fraction(1,4)})
        self.assertEqual(calc3.shares,4)

class DaughterQuoteTestCase(TestCase):

    def setUp(self):
        user1 = User.objects.create_user('john', 'lennon@thebeatles.com', 'johnpassword')
        #case 1 where daughter share residuary i.e becomes asaba (agnate) with others
        calc1 = Calculation.objects.create(name='calc1', user=user1)
        deceased = Deceased.objects.create(first_name="Deceased", last_name="test", sex="M",estate="1000",calc=calc1)
        son1 = Son.objects.create(first_name="Son1", last_name="test", sex="M", calc=calc1)
        calc1.add_son(son1, mother=None, father=None)
        daughter1 = Daughter.objects.create(first_name="Daughter1", last_name="test", sex="F", calc=calc1)
        calc1.add_daughter(daughter1, mother=None, father=None)

        #case 2 where daughters share residuary i.e becomes asaba (agnate) with others
        calc2 = Calculation.objects.create(name='calc2', user=user1)
        deceased2 = Deceased.objects.create(first_name="Deceased2", last_name="test", sex="M",estate="1000",calc=calc2)
        son2 = Son.objects.create(first_name="Son2", last_name="test", sex="M", calc=calc2)
        calc2.add_son(son2, mother=None, father=None)
        daughter2 = Daughter.objects.create(first_name="Daughter2", last_name="test", sex="F", calc=calc2)
        calc1.add_daughter(daughter2, mother=None, father=None)
        daughter3 = Daughter.objects.create(first_name="Daughter3", last_name="test", sex="F", calc=calc2)
        calc1.add_daughter(daughter3, mother=None, father=None)

        #case 3  where daughter get 1/2
        calc3 = Calculation.objects.create(name='calc3', user=user1)
        deceased3 = Deceased.objects.create(first_name="Deceased3", last_name="test", sex="M",estate="1000",calc=calc3)
        daughter4 = Daughter.objects.create(first_name="Daughter4", last_name="test", sex="F", calc=calc3)
        calc1.add_daughter(daughter4, mother=None, father=None)

        #case 4  where daughters get 2/3
        calc4 = Calculation.objects.create(name='calc4', user=user1)
        deceased4 = Deceased.objects.create(first_name="Deceased4", last_name="test", sex="M",estate="1000",calc=calc4)
        daughter5 = Daughter.objects.create(first_name="Daughter5", last_name="test", sex="F", calc=calc4)
        calc1.add_daughter(daughter5, mother=None, father=None)
        daughter6 = Daughter.objects.create(first_name="Daughter6", last_name="test", sex="F", calc=calc4)
        calc1.add_daughter(daughter6, mother=None, father=None)

    def test_daughter_qet_quote(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc2 = Calculation.objects.get(name="calc2")
        calc3 = Calculation.objects.get(name="calc3")
        calc4 = Calculation.objects.get(name="calc4")

        calc1.compute()
        calc2.compute()
        calc3.compute()
        calc4.compute()


        self.assertEqual(Fraction(calc1.get_daughters().first().quote).limit_denominator(), Fraction(1,1))
        self.assertEqual(calc1.get_daughters().first().asaba, True)
        self.assertEqual(calc1.get_daughters().first().shared_quote, False)
        self.assertEqual(calc1.get_fractions(calc1.heir_set.all()), {Fraction(1,1)})
        self.assertEqual(calc1.shares,3)

        self.assertEqual(Fraction(calc2.get_daughters().first().quote).limit_denominator(), Fraction(1,1))
        self.assertEqual(calc2.get_daughters().first().asaba, True)
        self.assertEqual(calc2.get_daughters().first().shared_quote, True)
        self.assertEqual(calc1.get_fractions(calc1.heir_set.all()), {Fraction(1,1)})
        self.assertEqual(calc2.shares,4)

        self.assertEqual(Fraction(calc3.get_daughters().first().quote).limit_denominator(), Fraction(1,2))
        self.assertEqual(calc3.get_daughters().first().asaba, False)
        self.assertEqual(calc3.get_daughters().first().shared_quote, False)
        self.assertEqual(calc1.get_fractions(calc1.heir_set.all()), {Fraction(1,1)})
        self.assertEqual(calc3.shares,2)

        self.assertEqual(Fraction(calc4.get_daughters().first().quote).limit_denominator(), Fraction(2,3))
        self.assertEqual(calc4.get_daughters().first().asaba, False)
        self.assertEqual(calc4.get_daughters().first().shared_quote, True)
        self.assertEqual(calc1.get_fractions(calc1.heir_set.all()), {Fraction(1,1)})
        self.assertEqual(calc4.shares,3)

class SonQuoteTestCase(TestCase):

    def setUp(self):
        user1 = User.objects.create_user('john', 'lennon@thebeatles.com', 'johnpassword')
        #case 1 where son get residuary i.e asaba (agnate)
        calc1 = Calculation.objects.create(name='calc1', user=user1)
        deceased = Deceased.objects.create(first_name="Deceased", last_name="test", sex="M",estate="1000",calc=calc1)
        son1 = Son.objects.create(first_name="Son1", last_name="test", sex="M", calc=calc1)
        calc1.add_son(son1, mother=None, father=None)
        daughter1 = Daughter.objects.create(first_name="Daughter1", last_name="test", sex="F", calc=calc1)
        calc1.add_daughter(daughter1, mother=None, father=None)

        #case 2 where Son share residuary i.e asaba (agnate)
        calc2 = Calculation.objects.create(name='calc2', user=user1)
        deceased2 = Deceased.objects.create(first_name="Deceased2", last_name="test", sex="M",estate="1000",calc=calc2)
        son2 = Son.objects.create(first_name="Son2", last_name="test", sex="M", calc=calc2)
        calc2.add_son(son2, mother=None, father=None)
        son3 = Son.objects.create(first_name="Son3", last_name="test", sex="M", calc=calc2)
        calc2.add_son(son3, mother=None, father=None)



    def test_son_qet_quote(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc2 = Calculation.objects.get(name="calc2")


        calc1.compute()
        calc2.compute()


        self.assertEqual(Fraction(calc1.get_sons().first().quote).limit_denominator(), Fraction(1,1))
        self.assertEqual(calc1.get_sons().first().asaba, True)
        self.assertEqual(calc1.get_sons().first().shared_quote, False)
        self.assertEqual(calc1.shares,3)

        self.assertEqual(Fraction(calc2.get_sons().first().quote).limit_denominator(), Fraction(1,1))
        self.assertEqual(calc2.get_sons().first().asaba, True)
        self.assertEqual(calc2.get_sons().first().shared_quote, True)
        self.assertEqual(calc2.shares,2)

class SisterQuoteTestCase(TestCase):

    def setUp(self):
        user1 = User.objects.create_user('john', 'lennon@thebeatles.com', 'johnpassword')
        #case 1 where sister is blocked by son
        calc1 = Calculation.objects.create(name='calc1', user=user1)
        deceased = Deceased.objects.create(first_name="Deceased", last_name="test", sex="M",estate="1000",calc=calc1)
        son1 = Son.objects.create(first_name="Son1", last_name="test", sex="M", calc=calc1)
        calc1.add_son(son1, mother=None, father=None)
        daughter1 = Daughter.objects.create(first_name="Daughter1", last_name="test", sex="F", calc=calc1)
        calc1.add_daughter(daughter1, mother=None, father=None)
        sister1 = Sister.objects.create(first_name="Sister 1", last_name="test", sex="F", calc=calc1)
        calc1.add_sister(sister1)


        #case 2 where Sister is blocked by father
        calc2 = Calculation.objects.create(name='calc2', user=user1)
        deceased2 = Deceased.objects.create(first_name="Deceased2", last_name="test", sex="M",estate="1000",calc=calc2)
        sister2 = Sister.objects.create(first_name="Sister 2", last_name="test", sex="F", calc=calc2)
        calc2.add_sister(sister2)
        father2 = Father.objects.create(first_name="Father2", last_name="test", sex="M", calc=calc2)
        calc2.add_father(father2)

        #case 3 sister get remainder with daughter
        calc3 = Calculation.objects.create(name='calc3', user=user1)
        deceased3 = Deceased.objects.create(first_name="Deceased3", last_name="test", sex="M",estate="1000",calc=calc3)
        sister3 = Sister.objects.create(first_name="Sister 3", last_name="test", sex="F", calc=calc3)
        calc3.add_sister(sister3)
        daughter3 = Daughter.objects.create(first_name="Daughter3", last_name="test", sex="F", calc=calc3)
        calc3.add_daughter(daughter3, mother=None, father=None)

        #case 4 sister get remainder with brother
        calc4 = Calculation.objects.create(name='calc4', user=user1)
        deceased4 = Deceased.objects.create(first_name="Deceased4", last_name="test", sex="M",estate="1000",calc=calc4)
        sister4 = Sister.objects.create(first_name="Sister 4", last_name="test", sex="F", calc=calc4)
        calc4.add_sister(sister4)
        brother4 = Brother.objects.create(first_name="Brother 4", last_name="test", sex="M", calc=calc4)
        calc4.add_brother(brother4)

        #case 5 sister get 1/2
        calc5 = Calculation.objects.create(name='calc5', user=user1)
        deceased5 = Deceased.objects.create(first_name="Deceased5", last_name="test", sex="M",estate="1000",calc=calc5)
        sister5 = Sister.objects.create(first_name="Sister 4", last_name="test", sex="F", calc=calc5)
        calc5.add_sister(sister5)


        #case 6 sisters get 2/3
        calc6 = Calculation.objects.create(name='calc6', user=user1)
        deceased6 = Deceased.objects.create(first_name="Deceased6", last_name="test", sex="M",estate="1000",calc=calc6)
        sister6 = Sister.objects.create(first_name="Sister 6", last_name="test", sex="F", calc=calc6)
        calc6.add_sister(sister6)
        sister7 = Sister.objects.create(first_name="Sister 7", last_name="test", sex="F", calc=calc6)
        calc6.add_sister(sister7)

    def test_sister_qet_quote(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc2 = Calculation.objects.get(name="calc2")
        calc3 = Calculation.objects.get(name="calc3")
        calc4 = Calculation.objects.get(name="calc4")
        calc5 = Calculation.objects.get(name="calc5")
        calc6 = Calculation.objects.get(name="calc6")

        calc1.compute()
        calc2.compute()
        calc3.compute()
        calc4.compute()
        calc5.compute()
        calc6.compute()


        self.assertEqual(calc1.shares,3)
        self.assertEqual(calc2.shares,1)
        self.assertEqual(calc3.shares,2)

        self.assertEqual(Fraction(calc1.get_sisters().first().quote).limit_denominator(), Fraction(0,1))
        self.assertEqual(Fraction(calc2.get_sisters().first().quote).limit_denominator(), Fraction(0,1))
        self.assertEqual(Fraction(calc3.get_sisters().first().quote).limit_denominator(), Fraction(1,2))
        self.assertEqual(Fraction(calc4.get_sisters().first().quote).limit_denominator(), Fraction(1,1))
        self.assertEqual(Fraction(calc5.get_sisters().first().quote).limit_denominator(), Fraction(1,2))
        self.assertEqual(Fraction(calc6.get_sisters().first().quote).limit_denominator(), Fraction(2,3))
        self.assertEqual(calc1.get_sisters().first().blocked, True)
        self.assertEqual(calc2.get_sisters().first().blocked, True)
        self.assertEqual(calc3.get_sisters().first().blocked, False)
        self.assertEqual(calc4.get_sisters().first().blocked, False)
        self.assertEqual(calc5.get_sisters().first().blocked, False)
        self.assertEqual(calc6.get_sisters().first().blocked, False)
        self.assertEqual(calc1.get_sisters().first().asaba, False)
        self.assertEqual(calc2.get_sisters().first().asaba, False)
        self.assertEqual(calc3.get_sisters().first().asaba, True)
        self.assertEqual(calc4.get_sisters().first().asaba, True)
        self.assertEqual(calc5.get_sisters().first().asaba, False)
        self.assertEqual(calc6.get_sisters().first().asaba, False)

class BrotherQuoteTestCase(TestCase):

    def setUp(self):
        user1 = User.objects.create_user('john', 'lennon@thebeatles.com', 'johnpassword')
        #case 1 where brtother is blocked by son
        calc1 = Calculation.objects.create(name='calc1', user=user1)
        deceased = Deceased.objects.create(first_name="Deceased", last_name="test", sex="M",estate="1000",calc=calc1)
        son1 = Son.objects.create(first_name="Son1", last_name="test", sex="M", calc=calc1)
        calc1.add_son(son1, mother=None, father=None)
        daughter1 = Daughter.objects.create(first_name="Daughter1", last_name="test", sex="F", calc=calc1)
        calc1.add_daughter(daughter1, mother=None, father=None)
        brother1 = Brother.objects.create(first_name="Brother 1", last_name="test", sex="M", calc=calc1)
        calc1.add_brother(brother1)


        #case 2 where brother is blocked by father
        calc2 = Calculation.objects.create(name='calc2', user=user1)
        deceased2 = Deceased.objects.create(first_name="Deceased2", last_name="test", sex="M",estate="1000",calc=calc2)
        brother2 = Brother.objects.create(first_name="Brother 2", last_name="test", sex="M", calc=calc2)
        calc2.add_brother(brother2)
        father2 = Father.objects.create(first_name="Father2", last_name="test", sex="M", calc=calc2)
        calc2.add_father(father2)

        #case 3 brother get remainder
        calc3 = Calculation.objects.create(name='calc3', user=user1)
        deceased3 = Deceased.objects.create(first_name="Deceased3", last_name="test", sex="M",estate="1000",calc=calc3)
        brother3 = Brother.objects.create(first_name="Brother 3", last_name="test", sex="M", calc=calc3)
        calc3.add_brother(brother3)
        daughter3 = Daughter.objects.create(first_name="Daughter3", last_name="test", sex="F", calc=calc3)
        calc3.add_daughter(daughter3, mother=None, father=None)



    def test_brother_qet_quote(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc2 = Calculation.objects.get(name="calc2")
        calc3 = Calculation.objects.get(name="calc3")


        calc1.compute()
        calc2.compute()
        calc3.compute()


        self.assertEqual(calc1.shares,3)
        self.assertEqual(calc2.shares,1)
        self.assertEqual(calc3.shares,2)

        self.assertEqual(Fraction(calc1.get_brothers().first().quote).limit_denominator(), Fraction(0,1))
        self.assertEqual(Fraction(calc2.get_brothers().first().quote).limit_denominator(), Fraction(0,1))
        self.assertEqual(Fraction(calc3.get_brothers().first().quote).limit_denominator(), Fraction(1,2))
        self.assertEqual(calc1.get_brothers().first().blocked, True)
        self.assertEqual(calc2.get_brothers().first().blocked, True)
        self.assertEqual(calc3.get_brothers().first().blocked, False)


class CalculationGetSharesTestCase(TestCase):

    def setUp(self):
        user1 = User.objects.create_user('john', 'lennon@thebeatles.com', 'johnpassword')

        calc1 = Calculation.objects.create(name='calc1', user=user1)
        deceased = Deceased.objects.create(first_name="Deceased", last_name="test", sex="M",estate="1000",calc=calc1)
        son1 = Son.objects.create(first_name="Son1", last_name="test", sex="M", calc=calc1)
        calc1.add_son(son1, mother=None, father=None)
        daughter1 = Daughter.objects.create(first_name="Daughter1", last_name="test", sex="F", calc=calc1)
        calc1.add_daughter(daughter1, mother=None, father=None)

        #case 2 where father has quote 1/6 and duaghter gets 1/2
        calc22 = Calculation.objects.create(name='calc22', user=user1)
        deceased2 = Deceased.objects.create(first_name="Deceased2", last_name="test", sex="M",estate="1000",calc=calc22)
        father2 = Father.objects.create(first_name="Father2", last_name="test", sex="M", calc=calc22)
        calc22.add_father(father2)
        daughter = Daughter.objects.create(first_name="Daughter", last_name="test", sex="F", calc=calc22)
        calc22.add_daughter(daughter, mother=None, father=father2)




    def test_calc_set_share(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc22 = Calculation.objects.get(name="calc22")

        calc1.compute()
        calc22.compute()

        self.assertEqual(calc1.get_fractions(calc1.heir_set.all()), {Fraction(1,1)})
        self.assertEqual(calc22.get_fractions(calc22.heir_set.all()), {Fraction(1,2), Fraction(1,6)})
        self.assertEqual(calc1.shares,3)
        self.assertEqual(calc22.shares,6)
        self.assertEqual(calc1.get_shares(), 3)
        self.assertEqual(calc22.get_shares(), 4)

class CalculationGetShareTestCase(TestCase):

    def setUp(self):
        user1 = User.objects.create_user('john', 'lennon@thebeatles.com', 'johnpassword')

        calc1 = Calculation.objects.create(name='calc1', user=user1)
        deceased = Deceased.objects.create(first_name="Deceased", last_name="test", sex="M",estate="1000",calc=calc1)
        mother = Mother.objects.create(first_name="Mother", last_name="test", sex="F", calc=calc1)
        calc1.add_mother(mother)
        father = Father.objects.create(first_name="Father", last_name="test", sex="M", calc=calc1)
        calc1.add_father(father)
        daughter1 = Daughter.objects.create(first_name="Daughter1", last_name="test", sex="F", calc=calc1)
        calc1.add_daughter(daughter1, mother=None, father=None)
        daughter2 = Daughter.objects.create(first_name="Daughter2", last_name="test", sex="F", calc=calc1)
        calc1.add_daughter(daughter2, mother=None, father=None)

    def test_set_calc_correction(self):
        calc1 = Calculation.objects.get(name="calc1")

        calc1.compute()

        self.assertEqual(calc1.get_fractions(calc1.heir_set.all()), {Fraction(1,6),Fraction(2,3)})
        self.assertEqual(calc1.set_calc_shares(), 6)
        self.assertEqual(calc1.get_daughters().first().get_fraction(), Fraction(2,3))
        self.assertEqual(calc1.get_daughters().first().set_share(calc1), 2)
        self.assertEqual(calc1.get_daughters().first().correction, False)
        self.assertEqual(calc1.get_mother().set_share(calc1), 1)
        self.assertEqual(calc1.get_father().set_share(calc1), 1)
        self.assertEqual(calc1.get_shares(), 6)
        self.assertEqual(calc1.get_daughters().first().shared_quote, True)



class CalculationSetCalcCorrectionTestCase(TestCase):

    def setUp(self):
        user1 = User.objects.create_user('john', 'lennon@thebeatles.com', 'johnpassword')

        calc1 = Calculation.objects.create(name='calc1', user=user1)
        deceased = Deceased.objects.create(first_name="Deceased", last_name="test", sex="M",estate="1000",calc=calc1)
        mother = Mother.objects.create(first_name="Mother", last_name="test", sex="F", calc=calc1)
        calc1.add_mother(mother)
        father = Father.objects.create(first_name="Father", last_name="test", sex="M", calc=calc1)
        calc1.add_father(father)
        daughter1 = Daughter.objects.create(first_name="Daughter1", last_name="test", sex="F", calc=calc1)
        calc1.add_daughter(daughter1, mother=None, father=None)
        daughter2 = Daughter.objects.create(first_name="Daughter2", last_name="test", sex="F", calc=calc1)
        calc1.add_daughter(daughter2, mother=None, father=None)
        daughter3 = Daughter.objects.create(first_name="Daughter3", last_name="test", sex="F", calc=calc1)
        calc1.add_daughter(daughter3, mother=None, father=None)

        calc2 = Calculation.objects.create(name='calc2', user=user1)
        deceased = Deceased.objects.create(first_name="Deceased2", last_name="test", sex="M",estate="4800",calc=calc2)
        wife1 = Wife.objects.create(first_name='wife1',last_name='test', sex='F', calc=calc2)
        calc2.add_wife(wife1)
        wife2 = Wife.objects.create(first_name='wife2',last_name='test', sex='F', calc=calc2)
        calc2.add_wife(wife2)
        wife3 = Wife.objects.create(first_name='wife3',last_name='test', sex='F', calc=calc2)
        calc2.add_wife(wife3)
        son1 = Son.objects.create(first_name='son1',last_name='test', sex='M', calc=calc2)
        calc2.add_son(son1, mother=wife1, father=None)
        son2 = Son.objects.create(first_name='son2',last_name='test', sex='M', calc=calc2)
        calc2.add_son(son2, mother=wife1, father=None)


    def test_set_calc_correction(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc2 = Calculation.objects.get(name="calc2")

        calc1.compute()
        calc2.compute()

        self.assertEqual(calc1.get_fractions(calc1.heir_set.all()), {Fraction(1,6),Fraction(2,3)})
        self.assertEqual(calc1.set_calc_shares(), 6)
        self.assertEqual(calc1.get_daughters().first().get_fraction(), Fraction(2,3))
        self.assertEqual(calc1.get_daughters().first().set_share(calc1), 4)
        self.assertEqual(calc1.get_daughters().first().correction, True)
        self.assertEqual(calc1.get_daughters().count(), 3)
        self.assertEqual(calc1.heir_set.filter(correction=True).count(),3)
        self.assertEqual(calc1.get_mother().set_share(calc1), 1)
        self.assertEqual(calc1.get_father().set_share(calc1), 1)
        self.assertEqual(calc1.get_shares(), 6)
        self.assertEqual(calc1.shares, 6)
        self.assertEqual(calc1.shares_excess, 0)
        self.assertEqual(calc1.set_calc_correction(),18)
        self.assertEqual(calc2.get_wives().first().get_quote(calc2), 1/8)
        self.assertEqual(calc2.get_wives().first().set_share(calc2), 1)
        self.assertEqual(calc2.shares, 8)
        self.assertEqual(calc2.get_wives().first().shared_quote, True)
        self.assertEqual(calc2.get_wives().first().set_share(calc2), 1)
        self.assertEqual(calc2.get_wives().first().correction, True)
        self.assertEqual(calc2.get_sons().first().shared_quote, True)
        self.assertEqual(calc2.shares, 8)
        self.assertEqual(calc2.heir_set.filter(asaba=True).count(),2)
        self.assertEqual(calc2.heir_set.filter(asaba=True, sex='M').count(),2)
        self.assertEqual(calc2.heir_set.filter(asaba=True, sex='F').count(),0)
        self.assertEqual(calc2.get_shares(),8)
        self.assertEqual(calc2.get_sons().first().get_fraction(), Fraction(7,8))
        self.assertEqual(calc2.get_sons().first().share, 7)
        self.assertEqual(calc2.get_sons().first().correction, True)
        self.assertEqual(calc2.heir_set.filter(correction=True).values('polymorphic_ctype_id').annotate(total=Count('id')).count(),2)
        self.assertEqual(calc2.get_sons().first().get_quote(calc2), 7/8)
        self.assertEqual(calc2.get_fractions(calc2.heir_set.all()), {Fraction(1,8),Fraction(7,8)})
        self.assertEqual(calc2.get_sons().first().share, 7)
        self.assertEqual(calc2.heir_set.filter(correction=True).values('polymorphic_ctype_id','quote').annotate(total=Count('id'))[0]["total"],2)
        self.assertEqual(calc2.heir_set.filter(correction=True).values('polymorphic_ctype_id','quote').annotate(total=Count('id'))[1]["total"],3)
        self.assertEqual(calc2.set_calc_correction(),48)
        self.assertEqual(calc2.get_wives().first().shared_quote,True)
        self.assertEqual(calc2.get_sons().first().shared_quote,True)
        self.assertEqual(calc2.heir_set.filter(correction=True).values('polymorphic_ctype_id','quote').annotate(total=Count('id')).count(), 2)
        self.assertEqual(calc2.get_wives().first().corrected_share,2)

class CalculationSetCalcExcessTestCase(TestCase):

    def setUp(self):
        user1 = User.objects.create_user('john', 'lennon@thebeatles.com', 'johnpassword')

        calc1 = Calculation.objects.create(name='calc1', user=user1)
        deceased = Deceased.objects.create(first_name="Deceased", last_name="test", sex="M",estate="8100",calc=calc1)
        mother = Mother.objects.create(first_name="Mother", last_name="test", sex="F", calc=calc1)
        calc1.add_mother(mother)
        father = Father.objects.create(first_name="Father", last_name="test", sex="M", calc=calc1)
        calc1.add_father(father)
        daughter1 = Daughter.objects.create(first_name="Daughter1", last_name="test", sex="F", calc=calc1)
        calc1.add_daughter(daughter1, mother=None, father=None)
        daughter2 = Daughter.objects.create(first_name="Daughter2", last_name="test", sex="F", calc=calc1)
        calc1.add_daughter(daughter2, mother=None, father=None)
        daughter3 = Daughter.objects.create(first_name="Daughter3", last_name="test", sex="F", calc=calc1)
        calc1.add_daughter(daughter3, mother=None, father=None)
        wife = Wife.objects.create(first_name="Wife", last_name="test", sex='F', calc=calc1)
        calc1.add_wife(wife)

    def test_set_calc_Excess(self):
        calc1 = Calculation.objects.get(name="calc1")

        calc1.compute()


        self.assertEqual(calc1.get_fractions(calc1.heir_set.all()), {Fraction(1,6),Fraction(2,3),Fraction(1,8)})
        self.assertEqual(calc1.set_calc_shares(), 24)
        self.assertEqual(calc1.get_shares(), 27)
        self.assertEqual(calc1.shares, 24)
        self.assertEqual(calc1.shares_excess, 27)
        self.assertEqual(calc1.set_calc_correction(),81)
        self.assertEqual(calc1.shares_corrected,81)
        self.assertEqual(calc1.get_daughters().first().get_corrected_share(calc1),16)
        self.assertEqual(calc1.get_mother().get_corrected_share(calc1),12)
        self.assertEqual(calc1.get_father().get_corrected_share(calc1),12)
        self.assertEqual(calc1.get_corrected_shares(),81)
        self.assertEqual(calc1.get_daughters().first().amount,1600)
        self.assertEqual(calc1.get_mother().amount,1200)
        self.assertEqual(calc1.get_father().amount,1200)
        self.assertEqual(calc1.get_wives().first().amount,900)

class CalculationShortageTestCase(TestCase):

    def setUp(self):
        user1 = User.objects.create_user('john', 'lennon@thebeatles.com', 'johnpassword')

        calc1 = Calculation.objects.create(name='calc1', user=user1)
        deceased = Deceased.objects.create(first_name="Deceased", last_name="test", sex="F",estate="8100",calc=calc1)
        mother = Mother.objects.create(first_name="Mother", last_name="test", sex="F", calc=calc1)
        calc1.add_mother(mother)
        husband = Husband.objects.create(first_name="Husband", last_name="test", sex="M", calc=calc1)
        calc1.add_husband(husband)
        daughter1 = Daughter.objects.create(first_name="Daughter1", last_name="test", sex="F", calc=calc1)
        calc1.add_daughter(daughter1, mother=None, father=husband)


    def test_set_calc_Excess(self):
        calc1 = Calculation.objects.get(name="calc1")

        calc1.compute()


        self.assertEqual(calc1.get_fractions(calc1.heir_set.all()), {Fraction(1,6),Fraction(1,4),Fraction(1,2)})
        self.assertEqual(calc1.get_shares(), 11)
        self.assertEqual(calc1.shares, 12)
        self.assertEqual(calc1.shares_shorted, 4)
        self.assertEqual(calc1.shortage_calc_shares,6)
        self.assertEqual(calc1.shortage_union_shares,16)
        self.assertEqual(calc1.get_daughters().first().shorted_share,3)
        self.assertEqual(calc1.get_daughters().first().shortage_calc_share,3)
        self.assertEqual(calc1.get_daughters().first().shortage_union_share,9)

class CalculationAsabaTestCase(TestCase):

    def setUp(self):
        user1 = User.objects.create_user('john', 'lennon@thebeatles.com', 'johnpassword')

        calc1 = Calculation.objects.create(name='calc1', user=user1)
        deceased = Deceased.objects.create(first_name="Deceased", last_name="test", sex="M",estate="8100",calc=calc1)
        mother = Mother.objects.create(first_name="Mother", last_name="test", sex="F", calc=calc1)
        calc1.add_mother(mother)
        father = Father.objects.create(first_name="Father", last_name="test", sex="M", calc=calc1)
        calc1.add_father(father)
        wife = Wife.objects.create(first_name="Wife", last_name="test", sex="F", calc=calc1)
        calc1.add_wife(wife)
        son1 = Son.objects.create(first_name="Son 1", last_name="test", sex="M", calc=calc1)
        calc1.add_son(son1, mother=wife, father=None)
        son2 = Son.objects.create(first_name="Son 2", last_name="test", sex="M", calc=calc1)
        calc1.add_son(son2, mother=wife, father=None)

    def test_set_calc_Excess(self):
        calc1 = Calculation.objects.get(name="calc1")

        calc1.compute()


        self.assertEqual(calc1.get_fractions(calc1.heir_set.all()), {Fraction(1,6),Fraction(1,8),Fraction(13,24)})
        self.assertEqual(calc1.get_shares(), 24)
        self.assertEqual(calc1.shares, 24)
        self.assertEqual(calc1.correction, True)
        self.assertEqual(calc1.shares_corrected, 48)
        self.assertEqual(calc1.get_sons().first().corrected_share, 13)

class CalculationSonOfUncleTestCase(TestCase):

    def setUp(self):
        user1 = User.objects.create_user('john', 'lennon@thebeatles.com', 'johnpassword')
        calc1 = Calculation.objects.create(name='calc1', user=user1)
        deceased = Deceased.objects.create(first_name="Deceased", last_name="test", sex="M",estate="2400",calc=calc1)
        sonOfUncle1= SonOfUncle.objects.create(first_name="Son of Uncle", last_name="test", sex="M", calc=calc1)
        duaghter1 = Daughter.objects.create(first_name="Daughter", last_name="test",sex="F", calc=calc1)
        duaghterOfSon1 = DaughterOfSon.objects.create(first_name="Daughter of Son", last_name="test",sex="F", calc=calc1)
        wife1 = Wife.objects.create(first_name="Wife", last_name="test",sex="F", calc=calc1)
        sister1 = Sister.objects.create(first_name="Sister", last_name="test",sex="F", calc=calc1)

    def test_son_of_uncle(self):
        calc1 = Calculation.objects.get(name="calc1")
        calc1.compute()

        self.assertEqual(calc1.heir_set.instance_of(SonOfUncle).first().blocked, True)
        self.assertEqual(calc1.heir_set.instance_of(SonOfUncle).first().asaba, False)
        self.assertEqual(calc1.heir_set.instance_of(SonOfUncle).first().amount, 0)
        self.assertEqual(calc1.heir_set.instance_of(SonOfUncle).first().share, 0)
        self.assertEqual(calc1.residual_shares, 5)

        self.assertEqual(calc1.correction, False)
        self.assertEqual(calc1.shares, 24)
        self.assertEqual(calc1.shares_corrected, 0)
        self.assertEqual(calc1.heir_set.filter(asaba=True).count(), 1)


CALC_ROUTES = {
    'detail', 'delete', 'calc_update', 'results', 'new_results',
    'deceased', 'mother', 'father', 'husband', 'wife', 'daughter', 'son',
    'brother', 'sister', 'grandFather', 'grandMother', 'sonOfSon',
    'daughterOfSon', 'paternalSister', 'paternalBrother', 'maternalSister',
    'maternalBrother', 'sonOfBrother', 'sonOfPaternalBrother', 'uncle',
    'paternalUncle', 'sonOfUncle', 'sonOfPaternalUncle',
}
DECEASED_ROUTES = {'deceased_update', 'deceased_delete'}
HEIR_ROUTES = {'heir_update', 'heir_delete'}
PUBLIC_ROUTES = {'home', 'terms', 'privacy', 'about', 'error', 'signup'}
LOGIN_ONLY_ROUTES = {'index', 'new'}
TAMPER = {'name': 'HACKED', 'first_name': 'HACKED', 'last_name': 'HACKED', 'sex': 'M', 'estate': '1'}


class CalculationAccessControlTests(TestCase):

    def setUp(self):
        cache.clear()  # waffle caches flag state across tests
        self.owner = User.objects.create_user('owner', password='x')
        self.other = User.objects.create_user('other', password='x')

    def make_case(self, user=None):
        calc = Calculation.objects.create(name='case', user=user or self.owner)
        deceased = Deceased.objects.create(first_name='D', last_name='L', sex='M', estate=1000, calc=calc)
        father = Father.objects.create(first_name='F', last_name='L', sex='M', calc=calc)
        calc.add_father(father)
        return calc, deceased, father

    def case_url(self, name, calc, deceased, heir):
        if name in DECEASED_ROUTES:
            return reverse(f'calc:{name}', args=[deceased.pk])
        if name in HEIR_ROUTES:
            return reverse(f'calc:{name}', args=[heir.pk])
        return reverse(f'calc:{name}', args=[calc.pk])

    def snapshot(self):
        return (
            sorted(Calculation.objects.values_list('pk', 'name', 'user_id')),
            sorted(Person.objects.non_polymorphic().values_list('pk', 'first_name', 'last_name')),
            sorted(Deceased.objects.non_polymorphic().values_list('pk', 'estate')),
        )

    def assert_redirects_to_login(self, response):
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response['Location'].startswith(reverse('login')), response['Location'])

    def test_every_route_is_classified(self):
        names = {pattern.name for pattern in calc_patterns[0]}
        case_routes = {p.name for p in calc_patterns[0] if p.pattern.converters}
        self.assertEqual(case_routes, CALC_ROUTES | DECEASED_ROUTES | HEIR_ROUTES)
        self.assertEqual(names - case_routes, PUBLIC_ROUTES | LOGIN_ONLY_ROUTES)

    @override_settings(WAFFLE_FLAG_DEFAULT=True)
    def test_owner_reaches_every_case_route(self):
        # The control for the denials below: a route that 404s for its owner
        # would make those assertions pass without testing ownership.
        self.client.force_login(self.owner)
        for name in sorted(CALC_ROUTES | DECEASED_ROUTES | HEIR_ROUTES):
            for method in ('get', 'post'):
                with self.subTest(route=name, method=method):
                    url = self.case_url(name, *self.make_case())
                    response = getattr(self.client, method)(url, TAMPER, secure=True)
                    self.assertNotEqual(response.status_code, 404)

    @override_settings(WAFFLE_FLAG_DEFAULT=True)
    def test_other_user_gets_404_on_every_case_route(self):
        self.client.force_login(self.other)
        for name in sorted(CALC_ROUTES | DECEASED_ROUTES | HEIR_ROUTES):
            for method in ('get', 'post'):
                with self.subTest(route=name, method=method):
                    url = self.case_url(name, *self.make_case())
                    before = self.snapshot()
                    with mock.patch.object(Calculation, 'compute') as compute:
                        response = getattr(self.client, method)(url, TAMPER, secure=True)
                    self.assertEqual(response.status_code, 404)
                    compute.assert_not_called()
                    self.assertEqual(self.snapshot(), before)

    @override_settings(WAFFLE_FLAG_DEFAULT=True)
    def test_anonymous_goes_to_login_on_every_case_route(self):
        for name in sorted(CALC_ROUTES | DECEASED_ROUTES | HEIR_ROUTES):
            for method in ('get', 'post'):
                with self.subTest(route=name, method=method):
                    url = self.case_url(name, *self.make_case())
                    before = self.snapshot()
                    with mock.patch.object(Calculation, 'compute') as compute:
                        response = getattr(self.client, method)(url, TAMPER, secure=True)
                    self.assert_redirects_to_login(response)
                    compute.assert_not_called()
                    self.assertEqual(self.snapshot(), before)

    def test_missing_id_matches_another_users_case(self):
        calc, _, _ = self.make_case()
        self.client.force_login(self.other)
        for name in ('detail', 'results'):
            with self.subTest(route=name):
                missing = self.client.get(reverse(f'calc:{name}', args=[calc.pk + 1000]), secure=True)
                denied = self.client.get(reverse(f'calc:{name}', args=[calc.pk]), secure=True)
                self.assertEqual(missing.status_code, 404)
                self.assertEqual(denied.status_code, 404)

    def test_null_owner_case_is_404_in_the_app_and_open_in_admin(self):
        calc = Calculation.objects.create(name='legacy', user=None)
        self.client.force_login(self.owner)
        response = self.client.get(reverse('calc:detail', args=[calc.pk]), secure=True)
        self.assertEqual(response.status_code, 404)
        self.client.force_login(User.objects.create_superuser('root', password='x'))
        response = self.client.get(reverse('admin:calc_calculation_change', args=[calc.pk]), secure=True)
        self.assertEqual(response.status_code, 200)

    def test_flag_off_still_404s_for_owner(self):
        calc, _, _ = self.make_case()
        self.client.force_login(self.owner)
        response = self.client.get(reverse('calc:new_results', args=[calc.pk]), secure=True)
        self.assertEqual(response.status_code, 404)

    def test_anonymous_new_redirects_without_creating(self):
        response = self.client.post(reverse('calc:new'), {'name': 'x'}, secure=True)
        self.assert_redirects_to_login(response)
        self.assertEqual(Calculation.objects.count(), 0)

    def test_new_get_after_login_redirects_to_index(self):
        self.client.force_login(self.owner)
        response = self.client.get(reverse('calc:new'), secure=True)
        self.assertRedirects(response, reverse('calc:index'), fetch_redirect_response=False)

    def test_owner_can_still_create_a_case(self):
        self.client.force_login(self.owner)
        response = self.client.post(reverse('calc:new'), {'name': 'mine'}, secure=True)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Calculation.objects.get().user, self.owner)

    def test_owner_deletes_heir(self):
        calc, _, father = self.make_case()
        self.client.force_login(self.owner)
        response = self.client.post(reverse('calc:heir_delete', args=[father.pk]), secure=True)
        self.assertRedirects(response, reverse('calc:detail', args=[calc.pk]), fetch_redirect_response=False)
        self.assertFalse(Father.objects.filter(pk=father.pk).exists())

    def test_owner_deleting_deceased_removes_the_heirs(self):
        calc, deceased, _ = self.make_case()
        self.client.force_login(self.owner)
        response = self.client.post(reverse('calc:deceased_delete', args=[deceased.pk]), secure=True)
        self.assertRedirects(response, reverse('calc:detail', args=[calc.pk]), fetch_redirect_response=False)
        self.assertFalse(Deceased.objects.filter(pk=deceased.pk).exists())
        self.assertEqual(calc.heir_set.count(), 0)

    def test_public_pages_stay_reachable_when_logged_out(self):
        for name in sorted(PUBLIC_ROUTES):
            with self.subTest(route=name):
                response = self.client.get(reverse(f'calc:{name}'), secure=True)
                self.assertEqual(response.status_code, 200)
        for url in (reverse('login'), reverse('password_reset'), reverse('admin:login')):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url, secure=True).status_code, 200)

    def test_language_switch_works_when_logged_out(self):
        response = self.client.post(reverse('set_language'), {'language': 'en', 'next': '/en/'}, secure=True)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], '/en/')
        self.assertEqual(response.cookies[settings.LANGUAGE_COOKIE_NAME].value, 'en')

    def test_health_and_social_login_are_exempt_from_login(self):
        urls = [reverse(name) for name in ('ops-live', 'ops-ready', 'ops-release')]
        urls.append(reverse('social:begin', args=['linkedin-openidconnect']))
        urls.append(reverse('social:complete', args=['linkedin-openidconnect']))
        for url in urls:
            with self.subTest(url=url):
                self.assertIs(resolve(url).func.login_required, False)

    def test_admin_sends_anonymous_to_admin_login(self):
        response = self.client.get(reverse('admin:index'), secure=True)
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response['Location'].startswith(reverse('admin:login')), response['Location'])

    def test_owner_deletes_whole_case(self):
        calc, _, _ = self.make_case()
        self.client.force_login(self.owner)
        response = self.client.post(reverse('calc:delete', args=[calc.pk]), secure=True)
        self.assertRedirects(response, reverse('calc:index'), fetch_redirect_response=False)
        self.assertFalse(Calculation.objects.filter(pk=calc.pk).exists())

    def test_get_and_head_never_delete_a_case(self):
        calc, _, _ = self.make_case()
        self.client.force_login(self.owner)
        url = reverse('calc:delete', args=[calc.pk])
        for method in ('get', 'head'):
            with self.subTest(method=method):
                response = getattr(self.client, method)(url, secure=True)
                self.assertRedirects(response, reverse('calc:index'), fetch_redirect_response=False)
                self.assertTrue(Calculation.objects.filter(pk=calc.pk).exists())

    def test_post_without_csrf_token_does_not_delete(self):
        calc, _, _ = self.make_case()
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.owner)
        response = client.post(
            reverse('calc:delete', args=[calc.pk]), secure=True, headers={'referer': 'https://testserver/'},
        )
        self.assertEqual(response.status_code, 403)
        self.assertTrue(Calculation.objects.filter(pk=calc.pk).exists())

    def test_delete_button_on_the_list_works_with_csrf_checks_on(self):
        calc, _, _ = self.make_case()
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.owner)
        url = reverse('calc:delete', args=[calc.pk])
        page = client.get(reverse('calc:index'), secure=True)
        html = page.content.decode()
        self.assertIn(f'<form action="{url}" method="post"', html)
        self.assertNotIn(f'href="{url}"', html)
        token = re.search(rf'<form action="{re.escape(url)}".*?name="csrfmiddlewaretoken" value="([^"]+)"', html, re.S)
        response = client.post(
            url, {'csrfmiddlewaretoken': token.group(1)}, secure=True, headers={'referer': 'https://testserver/'},
        )
        self.assertRedirects(response, reverse('calc:index'), fetch_redirect_response=False)
        self.assertFalse(Calculation.objects.filter(pk=calc.pk).exists())

    def test_delete_link_cannot_replay_through_login(self):
        calc, _, _ = self.make_case()
        response = self.client.get(reverse('calc:delete', args=[calc.pk]), secure=True)
        self.assert_redirects_to_login(response)
        self.assertNotIn('next=', response['Location'])
        self.assertTrue(Calculation.objects.filter(pk=calc.pk).exists())

    def test_delete_verb_is_rejected_without_deleting(self):
        calc, deceased, father = self.make_case()
        self.client.force_login(self.owner)
        for name, obj in (('heir_delete', father), ('deceased_delete', deceased)):
            with self.subTest(route=name):
                response = self.client.delete(reverse(f'calc:{name}', args=[obj.pk]), secure=True)
                self.assertEqual(response.status_code, 405)
        self.assertTrue(Father.objects.filter(pk=father.pk).exists())
        self.assertTrue(Deceased.objects.filter(pk=deceased.pk).exists())

    def test_owner_updates_are_saved(self):
        calc, deceased, father = self.make_case()
        self.client.force_login(self.owner)
        self.client.post(reverse('calc:calc_update', args=[calc.pk]), {'name': 'renamed'}, secure=True)
        self.client.post(reverse('calc:heir_update', args=[father.pk]), {'first_name': 'New', 'last_name': 'L'}, secure=True)
        self.client.post(reverse('calc:deceased_update', args=[deceased.pk]), {'first_name': 'D', 'last_name': 'L', 'estate': '2000'}, secure=True)
        calc.refresh_from_db()
        father.refresh_from_db()
        deceased.refresh_from_db()
        self.assertEqual(calc.name, 'renamed')
        self.assertEqual(father.first_name, 'New')
        self.assertEqual(deceased.estate, 2000)

    def test_owner_creates_deceased_and_flagged_heir(self):
        calc = Calculation.objects.create(name='empty', user=self.owner)
        self.client.force_login(self.owner)
        response = self.client.post(reverse('calc:deceased', args=[calc.pk]), {'first_name': 'D', 'last_name': 'L', 'sex': 'M', 'estate': '1000'}, secure=True)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(calc.deceased_set.count(), 1)
        with override_settings(WAFFLE_FLAG_DEFAULT=True):
            response = self.client.post(reverse('calc:brother', args=[calc.pk]), {'first_name': 'B', 'last_name': 'L'}, secure=True)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(calc.heir_set.instance_of(Brother).count(), 1)

    def test_anonymous_index_goes_to_login(self):
        self.assert_redirects_to_login(self.client.get(reverse('calc:index'), secure=True))

    def test_logout_does_not_get_stuck_behind_login(self):
        response = self.client.post(reverse('logout'), secure=True)
        self.assertFalse(response.get('Location', '').startswith(reverse('login') + '?next='))
        self.client.force_login(self.owner)
        self.client.post(reverse('logout'), secure=True)
        self.assertNotIn('_auth_user_id', self.client.session)


class ErrorPageTests(TestCase):

    def setUp(self):
        cache.clear()  # waffle caches flag state across tests
        self.owner = User.objects.create_user('owner', password='x')
        self.other = User.objects.create_user('other', password='x')
        self.calc = Calculation.objects.create(name='secret case name', user=self.owner)

    def strip_csrf(self, response):
        return re.sub(r'name="csrfmiddlewaretoken" value="[^"]+"', '', response.content.decode())

    def test_logged_out_404_uses_site_page(self):
        response = self.client.get('/en/no-such-page/', secure=True)
        self.assertEqual(response.status_code, 404)
        self.assertTemplateUsed(response, '404.html')
        self.assertContains(response, 'Page not found', status_code=404)
        self.assertContains(response, reverse('calc:home'), status_code=404)
        self.assertNotContains(response, 'Go to my calculations', status_code=404)

    def test_logged_in_404_links_to_calculations(self):
        self.client.force_login(self.other)
        response = self.client.get('/en/no-such-page/', secure=True)
        self.assertContains(response, 'Go to my calculations', status_code=404)
        self.assertContains(response, self.other.username, status_code=404)

    def test_other_accounts_case_looks_the_same_as_a_missing_one(self):
        self.client.force_login(self.other)
        missing_pk = Calculation.objects.order_by('-pk').first().pk + 1
        for name in ('detail', 'results'):
            with self.subTest(route=name):
                theirs = self.client.get(reverse(f'calc:{name}', args=[self.calc.pk]), secure=True)
                missing = self.client.get(reverse(f'calc:{name}', args=[missing_pk]), secure=True)
                self.assertEqual(theirs.status_code, 404)
                self.assertEqual(missing.status_code, 404)
                self.assertTemplateUsed(theirs, '404.html')
                self.assertEqual(self.strip_csrf(theirs), self.strip_csrf(missing))
                self.assertNotContains(theirs, 'secret case name', status_code=404)

    def test_404_is_translated(self):
        expected = {'ar': 'الصفحة غير موجودة', 'fr': 'Page introuvable'}
        for language, text in expected.items():
            with self.subTest(language=language):
                response = self.client.get(f'/{language}/no-such-page/', secure=True)
                self.assertContains(response, text, status_code=404)

    def get_500(self, language):
        self.client.force_login(self.owner)
        self.client.raise_request_exception = False
        with translation.override(language):
            url = reverse('calc:detail', args=[self.calc.pk])
        with mock.patch('calc.views.get_owned_calculation', side_effect=RuntimeError('secret detail')):
            return self.client.get(url, secure=True)

    def test_500_uses_standalone_page(self):
        response = self.get_500('en')
        self.assertEqual(response.status_code, 500)
        self.assertTemplateUsed(response, '500.html')
        self.assertTemplateNotUsed(response, 'calc/base.html')
        self.assertContains(response, 'Something went wrong', status_code=500)
        self.assertContains(response, 'dir="ltr"', status_code=500)
        self.assertNotContains(response, 'secret detail', status_code=500)

    def test_500_is_translated_and_right_to_left(self):
        response = self.get_500('ar')
        self.assertContains(response, 'حدث خطأ ما', status_code=500)
        self.assertContains(response, 'dir="rtl"', status_code=500)
        self.assertContains(self.get_500('fr'), 'Une erreur est survenue', status_code=500)


class TemplateTagTests(TestCase):

    def test_no_template_tag_spans_lines(self):
        # Django only recognises a tag on one line; a split one is printed as
        # literal text on the page.
        split_tag = re.compile(r'\{%((?!%\}).)*\n|\{\{((?!\}\}).)*\n|\{#((?!#\}).)*\n', re.S)
        templates = [p for p in Path(settings.BASE_DIR).glob('*/templates/**/*') if p.is_file()]
        self.assertGreater(len(templates), 20)
        for path in templates:
            with self.subTest(template=str(path)):
                self.assertIsNone(split_tag.search(path.read_text(encoding='utf-8')))

    def test_signup_button_is_translated(self):
        expected = {'en': 'Sign up', 'ar': 'تسجيل', 'fr': "S'inscrire"}
        for language, text in expected.items():
            with self.subTest(language=language), translation.override(language):
                response = self.client.get(reverse('calc:signup'), secure=True)
                self.assertContains(response, f'type="submit">{text}</button>')
                self.assertNotContains(response, '{%')

    def test_login_no_access_message_is_translated(self):
        self.client.force_login(User.objects.create_user('someone', password='x'))
        expected = {
            'en': "Your account doesn't have access to this page.",
            'ar': 'حسابك لا يملك إذنًا للوصول إلى هذه الصفحة.',
            'fr': "Votre compte n'a pas accès à cette page.",
        }
        for language, text in expected.items():
            with self.subTest(language=language):
                # This URL has no language prefix, so the cookie sets the language.
                self.client.cookies[settings.LANGUAGE_COOKIE_NAME] = language
                response = self.client.get(reverse('login') + '?next=/en/', secure=True)
                self.assertContains(response, text)
                self.assertNotContains(response, '{%')


# ---------------------------------------------------------------------------
# Hanbali distribution: fixture table and invariants
# ---------------------------------------------------------------------------

F = Fraction

HEIR_SEX = {
    Father: 'M', Mother: 'F', Husband: 'M', Wife: 'F', Daughter: 'F', Son: 'M',
    Brother: 'M', Sister: 'F', GrandFather: 'M', GrandMother: 'F', SonOfSon: 'M',
    DaughterOfSon: 'F', PaternalSister: 'F', PaternalBrother: 'M', MaternalSister: 'F',
    MaternalBrother: 'M', SonOfBrother: 'M', SonOfPaternalBrother: 'M', Uncle: 'M',
    PaternalUncle: 'M', SonOfUncle: 'M', SonOfPaternalUncle: 'M',
}
ALL_HEIR_TYPES = list(HEIR_SEX)
ESTATE = 7000


def build_case(deceased_sex, heir_types, estate=ESTATE):
    """Create a case with one heir per entry of `heir_types`, in that order."""
    user, _created = User.objects.get_or_create(username='fixture-owner')
    calc = Calculation.objects.create(name='case', user=user)
    Deceased.objects.create(first_name='Deceased', sex=deceased_sex, estate=estate, calc=calc)
    heirs = [cls.objects.create(first_name=cls.__name__, sex=HEIR_SEX[cls], calc=calc) for cls in heir_types]
    return calc, heirs


def half_up(estate, fraction):
    exact = Decimal(fraction.numerator) * estate / Decimal(fraction.denominator)
    return exact.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def stored(heir):
    return Heir.objects.get(pk=heir.pk)


# (title, deceased sex, [(heir type, expected fraction of the whole estate for that heir), ...])
FIXTURES = [
    ('two wives, one son', 'M', [(Wife, F(1, 16)), (Wife, F(1, 16)), (Son, F(7, 8))]),
    ('three wives, mother, two sons', 'M',
     [(Wife, F(1, 24))] * 3 + [(Mother, F(1, 6)), (Son, F(17, 48)), (Son, F(17, 48))]),
    ('radd with spouse', 'M',
     [(Wife, F(1, 8)), (Mother, F(7, 40))] + [(Daughter, F(7, 30))] * 3),
    ('radd, deceased female', 'F', [(Husband, F(1, 4))] + [(Daughter, F(1, 4))] * 3),
    ('radd, two wives', 'M',
     [(Wife, F(1, 16)), (Wife, F(1, 16)), (Mother, F(7, 32)), (Daughter, F(21, 32))]),
    ('awl', 'M',
     [(Wife, F(1, 18)), (Wife, F(1, 18)), (Mother, F(4, 27)), (Father, F(4, 27)),
      (Daughter, F(8, 27)), (Daughter, F(8, 27))]),
    ('father with daughters', 'M',
     [(Wife, F(1, 16)), (Wife, F(1, 16)), (Father, F(5, 24)), (Daughter, F(1, 3)), (Daughter, F(1, 3))]),
    ('mushtaraka gives the full brother nothing', 'F',
     [(Husband, F(1, 2)), (Mother, F(1, 6)), (MaternalBrother, F(1, 6)), (MaternalBrother, F(1, 6)),
      (Brother, F(0))]),
    ('sister residuary blocks the paternal brother', 'M',
     [(Daughter, F(1, 3)), (Daughter, F(1, 3)), (Sister, F(1, 6)), (Sister, F(1, 6)),
      (PaternalBrother, F(0))]),
    ('grandfather, one brother', 'M', [(GrandFather, F(1, 2)), (Brother, F(1, 2))]),
    ('grandfather, three brothers', 'M',
     [(GrandFather, F(1, 3))] + [(Brother, F(2, 9))] * 3),
    ('grandfather, sister', 'M', [(GrandFather, F(2, 3)), (Sister, F(1, 3))]),
    ('grandfather after a spouse', 'M', [(Wife, F(1, 4)), (GrandFather, F(3, 8)), (Brother, F(3, 8))]),
    ("grandfather's minimum, deceased female", 'F',
     [(Husband, F(1, 2)), (Mother, F(1, 3)), (GrandFather, F(1, 6)), (Brother, F(0))]),
    ('daughter, sister, grandfather', 'M', [(Daughter, F(1, 2)), (GrandFather, F(1, 3)), (Sister, F(1, 6))]),
    ('akdariyya', 'F',
     [(Husband, F(9, 27)), (Mother, F(6, 27)), (GrandFather, F(8, 27)), (Sister, F(4, 27))]),
    ('akdariyya with a paternal sister', 'F',
     [(Husband, F(9, 27)), (Mother, F(6, 27)), (GrandFather, F(8, 27)), (PaternalSister, F(4, 27))]),
    ('counting paternal siblings', 'M',
     [(GrandFather, F(1, 3)), (Brother, F(2, 3)), (PaternalBrother, F(0))]),
    ('ashariyya', 'M', [(GrandFather, F(2, 5)), (Sister, F(1, 2)), (PaternalBrother, F(1, 10))]),
    ('spouse alone', 'M', [(Wife, F(1, 4))]),
    ('no heirs yet', 'M', []),
    # classical cases
    ('umariyyatan, deceased male', 'M', [(Wife, F(1, 4)), (Mother, F(1, 4)), (Father, F(1, 2))]),
    ('umariyyatan, deceased female', 'F', [(Husband, F(1, 2)), (Mother, F(1, 6)), (Father, F(1, 3))]),
    ('minbariyya', 'M',
     [(Wife, F(1, 9)), (Mother, F(4, 27)), (Father, F(4, 27)), (Daughter, F(8, 27)), (Daughter, F(8, 27))]),
    ('husband with two full sisters', 'F',
     [(Husband, F(3, 7)), (Sister, F(2, 7)), (Sister, F(2, 7))]),
    ("daughter with son's daughter", 'M', [(Daughter, F(3, 4)), (DaughterOfSon, F(1, 4))]),
    ("daughter, son's daughter and father", 'M',
     [(Daughter, F(1, 2)), (DaughterOfSon, F(1, 6)), (Father, F(1, 3))]),
    ("daughter, son's daughter and brother", 'M',
     [(Daughter, F(1, 2)), (DaughterOfSon, F(1, 6)), (Brother, F(1, 3))]),
    ('mother and daughter', 'M', [(Mother, F(1, 4)), (Daughter, F(3, 4))]),
    ('grandfather, full sister and paternal sister', 'M',
     [(GrandFather, F(1, 2)), (Sister, F(1, 2)), (PaternalSister, F(0))]),
    ('grandfather, brother and sister', 'M', [(GrandFather, F(2, 5)), (Brother, F(2, 5)), (Sister, F(1, 5))]),
    ('grandfather, two sisters and a paternal brother', 'M',
     [(GrandFather, F(1, 3)), (Sister, F(1, 3)), (Sister, F(1, 3)), (PaternalBrother, F(0))]),
    ('grandfather still blocks maternal siblings, nephews and uncles', 'M',
     [(GrandFather, F(1, 2)), (Brother, F(1, 2)), (MaternalBrother, F(0)), (SonOfBrother, F(0)), (Uncle, F(0))]),
    ('grandfather with a daughter and no siblings', 'M', [(Daughter, F(1, 2)), (GrandFather, F(1, 2))]),
    ('grandfather with a son', 'M', [(Son, F(5, 6)), (GrandFather, F(1, 6)), (Brother, F(0))]),
    ('son of brother blocks the uncle', 'M', [(SonOfBrother, F(1)), (Uncle, F(0))]),
    ('son of brother blocks the son of a paternal brother', 'M', [(SonOfBrother, F(1)), (SonOfPaternalBrother, F(0))]),
    ('paternal brother blocks the son of a brother', 'M', [(PaternalBrother, F(1)), (SonOfBrother, F(0))]),
    ('wife, daughter, grandfather and sister', 'M',
     [(Wife, F(1, 8)), (Daughter, F(1, 2)), (GrandFather, F(1, 4)), (Sister, F(1, 8))]),
    ('grandfather, two sisters and a paternal sister', 'M',
     [(GrandFather, F(2, 5)), (Sister, F(3, 10)), (Sister, F(3, 10)), (PaternalSister, F(0))]),
    # Al-Mughni: the daughter takes 1/2, the full sister all the rest, the paternal sister nothing.
    ('daughter, sister and paternal sister', 'M',
     [(Daughter, F(1, 2)), (Sister, F(1, 2)), (PaternalSister, F(0))]),
    ('two daughters, sister and paternal sister', 'M',
     [(Daughter, F(1, 3)), (Daughter, F(1, 3)), (Sister, F(1, 3)), (PaternalSister, F(0))]),
    ('mother, two daughters, sister and paternal sister', 'M',
     [(Mother, F(1, 6)), (Daughter, F(1, 3)), (Daughter, F(1, 3)), (Sister, F(1, 6)), (PaternalSister, F(0))]),
    # Al-Mughni 6/168: with no child, the full sister has 1/2 and the paternal sister 1/6 to complete 2/3.
    ('uncle, sister and paternal sister', 'M',
     [(Uncle, F(1, 3)), (Sister, F(1, 2)), (PaternalSister, F(1, 6))]),
    ('sister and two paternal sisters, with radd', 'M',
     [(Sister, F(3, 4)), (PaternalSister, F(1, 8)), (PaternalSister, F(1, 8))]),
    # Al-Mughni 6/168: a paternal brother makes the paternal sister residuary, with twice her share.
    ('sister, paternal brother and paternal sister', 'M',
     [(Sister, F(1, 2)), (PaternalBrother, F(1, 3)), (PaternalSister, F(1, 6))]),
]


class DistributionFixtureTests(TestCase):
    """Whole-estate shares for classical families, as the Hanbali school gives them."""

    def test_fixture_table(self):
        for title, sex, expected in FIXTURES:
            with self.subTest(title):
                calc, heirs = build_case(sex, [cls for cls, _fraction in expected])
                exact = calc.compute()
                self.assertEqual([exact[h.pk] for h in heirs], [fraction for _cls, fraction in expected])
                for heir, (cls, fraction) in zip(heirs, expected):
                    self.assertEqual(stored(heir).amount, half_up(ESTATE, fraction), cls.__name__)
                if expected and not all(cls in (Wife, Husband) for cls, _fraction in expected):
                    total = sum(stored(h).amount for h in heirs)
                    self.assertAlmostEqual(float(total), ESTATE, delta=0.05)

    def test_awl_columns(self):
        calc, heirs = build_case('M', [Wife, Wife, Mother, Father, Daughter, Daughter])
        calc.compute()
        calc.refresh_from_db()
        self.assertEqual((calc.shares, calc.shares_excess, calc.excess), (24, 27, True))
        self.assertEqual((calc.correction, calc.shares_corrected), (True, 54))
        wife, _wife2, mother, father, daughter, _daughter2 = [stored(h) for h in heirs]
        self.assertEqual((wife.share, mother.share, father.share, daughter.share), (3, 4, 4, 8))
        self.assertEqual((wife.corrected_share, daughter.corrected_share), (3, 16))
        self.assertEqual(calc.get_shares(), 27)

    def test_radd_columns(self):
        calc, heirs = build_case('M', [Wife, Mother, Daughter, Daughter, Daughter])
        calc.compute()
        calc.refresh_from_db()
        self.assertEqual((calc.shortage, calc.shortage_calc), (True, True))
        self.assertEqual((calc.shares_shorted, calc.shortage_union_shares), (8, 40))
        wife, mother, daughter = stored(heirs[0]), stored(heirs[1]), stored(heirs[2])
        self.assertEqual((wife.shorted_share, mother.shorted_share), (1, 7))
        self.assertEqual((wife.shortage_union_share, mother.shortage_union_share), (5, 7))
        self.assertEqual(calc.correction, True)
        self.assertEqual(daughter.amount, half_up(ESTATE, F(7, 30)))

    def test_radd_without_spouse_columns(self):
        calc, heirs = build_case('M', [Mother, Daughter])
        calc.compute()
        calc.refresh_from_db()
        mother, daughter = stored(heirs[0]), stored(heirs[1])
        self.assertTrue(calc.shortage)
        self.assertFalse(calc.shortage_calc)
        self.assertEqual(calc.shares_shorted, 4)
        self.assertEqual((mother.shorted_share, daughter.shorted_share), (1, 3))

    def test_grandfather_quote_is_stored_and_shown(self):
        calc, heirs = build_case('M', [GrandFather, Brother])
        calc.compute()
        grandfather = stored(heirs[0])
        self.assertEqual(grandfather.get_fraction(), F(1, 2))
        self.assertEqual(stored(heirs[1]).get_fraction(), F(1, 2))
        cache.clear()
        client = Client()
        client.force_login(calc.user)
        response = client.get(f'/en/{calc.id}/results/', secure=True)
        self.assertTemplateUsed(response, 'calc/results.html')
        self.assertContains(response, '<td>1/2</td>', count=1)

    def test_fiqh_order_covers_every_heir_type(self):
        concrete = {cls for cls in Heir.__subclasses__()}
        self.assertEqual(concrete, set(FIQH_ORDER))
        self.assertEqual(len(FIQH_ORDER), len(set(FIQH_ORDER)))

    def test_unknown_heir_type_sorts_last_instead_of_failing(self):
        calc, heirs = build_case('M', [Father])
        with mock.patch('calc.models.FIQH_ORDER', [Son]):
            calc.compute()
        self.assertEqual(stored(heirs[0]).amount, Decimal(ESTATE))

    def test_father_with_daughters_shows_the_remainder_as_shortage(self):
        calc, heirs = build_case('M', [Father, Daughter])
        calc.compute()
        calc.refresh_from_db()
        father, daughter = stored(heirs[0]), stored(heirs[1])
        self.assertEqual((calc.shares, calc.shortage, calc.shares_shorted), (6, True, 6))
        self.assertEqual((father.share, father.shorted_share, daughter.shorted_share), (1, 3, 3))

    def test_amounts_round_half_up(self):
        calc, heirs = build_case('M', [Wife, Mother, Son], estate=1)
        calc.compute()
        self.assertEqual([stored(h).amount for h in heirs], [Decimal('0.13'), Decimal('0.17'), Decimal('0.71')])

    def test_stale_results_correct_themselves_on_compute(self):
        calc, heirs = build_case('M', [Wife, Wife, Son])
        for heir in heirs:
            heir.share = 99
            heir.amount = Decimal('1234.00')
            heir.save()
        Calculation.objects.filter(pk=calc.pk).update(shares=77, excess=True, shares_excess=88)
        calc = Calculation.objects.get(pk=calc.pk)
        calc.compute()
        calc.refresh_from_db()
        self.assertEqual((calc.shares, calc.excess, calc.shares_excess), (8, False, 0))
        self.assertEqual(stored(heirs[0]).amount, Decimal('437.50'))
        self.assertEqual(stored(heirs[2]).amount, Decimal('6125.00'))

    def test_results_pages_show_columns_that_add_up(self):
        cases = {
            'awl': ('M', [Wife, Wife, Mother, Father, Daughter, Daughter]),
            'radd': ('M', [Wife, Mother, Daughter, Daughter, Daughter]),
            'correction': ('M', [Wife, Wife, Wife, Son, Son]),
            'grandfather': ('F', [Husband, Mother, GrandFather, Sister]),
        }
        cache.clear()
        client = Client()
        for title, (sex, types) in cases.items():
            calc, heirs = build_case(sex, types)
            client.force_login(calc.user)
            for lang in ('en', 'ar'):
                for page in ('results', 'new-results'):
                    with self.subTest(f'{title} {lang} {page}'), override_flag('new_results', active=True):
                        response = client.get(f'/{lang}/{calc.id}/{page}/', secure=True)
                        self.assertEqual(response.status_code, 200)
                        self.assertTemplateUsed(response, f'calc/{page.replace("-", "_")}.html')
                        for heir in heirs:
                            self.assertContains(response, f'{stored(heir).amount:,}')
            total = sum(stored(h).amount for h in heirs)
            self.assertAlmostEqual(float(total), ESTATE, delta=0.05)

    def test_new_reasons_are_translated(self):
        import gettext
        po_ids = [
            "Grandfather shares the estate with the full and paternal siblings and takes the best of his options",
            "Grandfather shares the remainder with the siblings as one more brother, which is the best of his options",
            "Grandfather gets 1/3 of the remainder, which is the best of his options with siblings",
            "Grandfather gets 1/6 of the estate, which is the best of his options with siblings",
            "Akdariyya: the grandfather and the sister pool their shares and split them two to one",
            "Paternal siblings count against the grandfather but get nothing because of the full siblings",
            "The shares of the grandfather and the others use up the whole estate, so nothing is left for the siblings",
            "The fixed shares use up the whole estate, so nothing is left for the residuary heirs",
            "Brother/s share the estate with the grandfather",
            "Sister/s share the estate with the grandfather",
            "Paternal brother/s share the estate with the grandfather",
            "Paternal sister/s share the estate with the grandfather",
            "Paternal sister/s are blocked by sisters",
        ]
        for lang in ('fr', 'ar'):
            catalog = gettext.translation('django', settings.BASE_DIR / 'locale', languages=[lang])
            for msgid in po_ids:
                with self.subTest(f'{lang}: {msgid}'):
                    translated = catalog.gettext(msgid)
                    self.assertTrue(translated)
                    self.assertNotEqual(translated, msgid)
        calc, heirs = build_case('F', [Husband, Mother, GrandFather, Sister])
        with translation.override('fr'):
            calc.compute()
            self.assertNotIn('Akdariyya: the grandfather', stored(heirs[2]).quote_reason)


def family_types(rng, deceased_sex):
    """A random family, with only as many of each heir as the model allows."""
    types = []
    for cls in ALL_HEIR_TYPES:
        if (cls is Husband and deceased_sex != 'F') or (cls is Wife and deceased_sex != 'M'):
            continue
        if rng.random() > 0.3:
            continue
        if cls in (Father, Mother, Husband, GrandFather):
            count = 1
        elif cls is Wife:
            count = rng.randint(1, 4)
        else:
            count = rng.randint(1, 3)
        types += [cls] * count
    return types


def families():
    """Every type on its own and in a few common contexts, plus random families."""
    import random
    rng = random.Random(20261107)
    found = []
    for cls in ALL_HEIR_TYPES:
        sex = 'F' if cls is Husband else 'M'
        spouse = Wife if sex == 'M' else Husband
        for context in ([], [Mother], [Father, Mother], [Daughter, Daughter], [GrandFather], [spouse]):
            if cls in context:
                continue
            found.append((sex, [cls] + context))
        if cls not in (Father, Mother, Husband, GrandFather):
            found.append((sex, [cls, cls]))
    found.append(('M', [Wife] * 4))
    for _ in range(60):
        sex = rng.choice('MF')
        types = family_types(rng, sex)
        if types:
            found.append((sex, types))
    return found


def fingerprint(calc, heirs, exact):
    """Everything stored for each heir, without the order they were entered in."""
    rows = []
    for heir in heirs:
        row = stored(heir)
        rows.append((type(heir).__name__, exact[heir.pk], row.amount, row.share, row.shorted_share,
                     row.corrected_share, row.blocked, row.asaba, row.correction))
    calc.refresh_from_db()
    return sorted(rows, key=repr), (calc.shares, calc.shares_excess, calc.shares_shorted, calc.shares_corrected,
                                    calc.shortage_calc_shares, calc.shortage_union_shares)


class DistributionInvariantTests(TestCase):
    """Properties that hold for every family, over all 22 relationship types."""

    def test_every_family_adds_up_and_is_fair(self):
        for sex, types in families():
            with self.subTest(f'{sex}: {[t.__name__ for t in types]}'):
                calc, heirs = build_case(sex, types)
                exact = calc.compute()
                rows = {h.pk: stored(h) for h in heirs}
                live = [h for h in heirs if not rows[h.pk].blocked]
                total = sum(exact[h.pk] for h in heirs)
                if all(isinstance(h, (Husband, Wife)) for h in live):
                    self.assertLessEqual(total, 1)
                else:
                    self.assertEqual(total, 1)
                for h in heirs:
                    if rows[h.pk].blocked:
                        self.assertEqual(exact[h.pk], 0)
                        self.assertEqual(rows[h.pk].amount, 0)
                    self.assertEqual(rows[h.pk].amount, half_up(ESTATE, exact[h.pk]))
                calc.refresh_from_db()
                if calc.correction and total == 1:
                    # a spouse with no other heir leaves part of the estate unallocated, so only whole estates are checked
                    self.assertEqual(sum(rows[h.pk].corrected_share for h in live), calc.shares_corrected)
                for cls in {type(h) for h in heirs}:
                    self.assertLessEqual(len({exact[h.pk] for h in live if type(h) is cls}), 1)
                if calc.gf_shares_with_siblings():
                    groups = [[h for h in live if isinstance(h, (Brother, Sister))],
                              [h for h in live if isinstance(h, (PaternalBrother, PaternalSister))]]
                else:
                    groups = [[h for h in live if rows[h.pk].asaba]]
                for group in groups:
                    males = {exact[h.pk] for h in group if HEIR_SEX[type(h)] == 'M' and exact[h.pk] > 0}
                    females = {exact[h.pk] for h in group if HEIR_SEX[type(h)] == 'F' and exact[h.pk] > 0}
                    if males and females:
                        self.assertEqual(males.pop(), 2 * females.pop())

    def test_entry_order_does_not_matter(self):
        for sex, types in families():
            with self.subTest(f'{sex}: {[t.__name__ for t in types]}'):
                forward, forward_heirs = build_case(sex, types)
                backward, backward_heirs = build_case(sex, list(reversed(types)))
                self.assertEqual(
                    fingerprint(forward, forward_heirs, forward.compute()),
                    fingerprint(backward, backward_heirs, backward.compute()),
                )
