import re
import threading
import traceback
import unittest
from unittest import mock

from decimal import Decimal, ROUND_HALF_UP
from itertools import product
from pathlib import Path

from django.conf import settings
from django.core.cache import cache
from django.db import connection, connections
from django.db.models.signals import post_delete
from django.test import TestCase, TransactionTestCase, Client, override_settings, tag
from django.utils import translation
from django.utils.translation import gettext as _
from calc.models import *
from django.contrib.auth.models import User
from django.contrib.auth import authenticate
from django.contrib.messages import ERROR, get_messages
from django.http.request import HttpRequest
from django.urls import resolve, reverse
from waffle.testutils import override_flag

from calc import schools
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
        # The grouped rows come back in no fixed order, so compare their totals sorted.
        totals = calc2.heir_set.filter(correction=True).values('polymorphic_ctype_id','quote').annotate(total=Count('id'))
        self.assertEqual(sorted(row["total"] for row in totals), [2, 3])
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

    def test_new_missing_or_empty_name_redirects_without_creating(self):
        for data in ({}, {'name': ''}):
            with self.subTest(data=data):
                client = Client()
                client.force_login(self.owner)
                response = client.post(reverse('calc:new'), data, secure=True)
                self.assertRedirects(response, reverse('calc:error'), fetch_redirect_response=False)
                queued = list(get_messages(response.wsgi_request))
                self.assertEqual(len(queued), 1)
                self.assertEqual(queued[0].level, ERROR)
                self.assertEqual(str(queued[0]), str(_("Must enter a name for your calcualtion")))
                self.assertEqual(Calculation.objects.count(), 0)

    @override_settings(WAFFLE_FLAG_DEFAULT=True)
    def test_results_post_does_not_compute(self):
        calc, _, _ = self.make_case()
        self.client.force_login(self.owner)
        for route in ('results', 'new_results'):
            with self.subTest(route=route), mock.patch.object(Calculation, 'compute') as compute:
                response = self.client.post(reverse(f'calc:{route}', args=[calc.pk]), secure=True)
                self.assertEqual(response.status_code, 405)
                compute.assert_not_called()

    @override_settings(WAFFLE_FLAG_DEFAULT=False)
    def test_new_results_flag_off_does_not_compute(self):
        calc, _, _ = self.make_case()
        self.client.force_login(self.owner)
        with mock.patch.object(Calculation, 'compute') as compute:
            response = self.client.get(reverse('calc:new_results', args=[calc.pk]), secure=True)
        self.assertEqual(response.status_code, 404)
        compute.assert_not_called()

    @override_settings(WAFFLE_FLAG_DEFAULT=True)
    def test_results_get_computes_once(self):
        calc, _, _ = self.make_case()
        self.client.force_login(self.owner)
        for route in ('results', 'new_results'):
            with self.subTest(route=route), mock.patch.object(Calculation, 'compute') as compute:
                response = self.client.get(reverse(f'calc:{route}', args=[calc.pk]), secure=True)
                self.assertEqual(response.status_code, 200)
                self.assertTemplateUsed(response, f'calc/{route}.html')
                compute.assert_called_once_with()

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

    def test_home_links_to_the_interview_in_each_language(self):
        expected = {
            'en': 'Start a case without an account',
            'ar': 'ابدأ حالة بدون حساب',
            'fr': 'Commencer un dossier sans compte',
        }
        for language, text in expected.items():
            with self.subTest(language=language):
                response = self.client.get(f'/{language}/', secure=True)
                self.assertContains(response, f'href="/app/{language}/interview/"')
                self.assertContains(response, text)
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


# Engine-heavy tests are TransactionTestCase: inside TestCase's per-test transaction every
# compute() is a savepoint, and past 64 subtransactions PostgreSQL slows every query sharply.
class ChildMotherTests(TransactionTestCase):
    """The mother of a son or daughter is optional, and a refused request adds no heir."""

    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user('owner', password='x')
        self.client.force_login(self.owner)

    def make_case(self, wives=2, sex='M'):
        calc = Calculation.objects.create(name='case', user=self.owner)
        Deceased.objects.create(first_name='D', last_name='L', sex=sex, estate=1000, calc=calc)
        made = []
        for index in range(wives):
            wife = Wife.objects.create(first_name=f'Wife{index}', last_name='L', sex='F', calc=calc)
            calc.add_wife(wife)
            made.append(wife)
        return calc, made

    def add(self, kind, calc, **data):
        return self.client.post(
            reverse(f'calc:{kind}', args=[calc.pk]), {'first_name': 'A', 'last_name': 'B', **data}, secure=True)

    def count(self, kind, calc):
        return calc.heir_set.instance_of(Son if kind == 'son' else Daughter).count()

    def test_blank_or_missing_mother_adds_one_child(self):
        for kind in ('son', 'daughter'):
            for data in ({'mother': ''}, {}):
                with self.subTest(kind=kind, data=data):
                    calc, _wives = self.make_case()
                    response = self.add(kind, calc, **data)
                    self.assertEqual(response.status_code, 302)
                    self.assertEqual(self.count(kind, calc), 1)
                    child = calc.heir_set.instance_of(Son, Daughter).get()
                    self.assertIsNone(child.parents.female)

    def test_two_children_without_a_mother_share_one_link(self):
        calc, _wives = self.make_case()
        self.add('son', calc, mother='')
        self.add('daughter', calc, mother='')
        parents = {child.parents_id for child in calc.heir_set.instance_of(Son, Daughter)}
        self.assertEqual(len(parents), 1)

    def test_chosen_mother_is_stored(self):
        for kind in ('son', 'daughter'):
            with self.subTest(kind=kind):
                calc, wives = self.make_case()
                self.add(kind, calc, mother=wives[1].pk)
                child = calc.heir_set.instance_of(Son, Daughter).get()
                self.assertEqual(child.parents.female_id, wives[1].pk)

    def test_refused_mother_adds_no_child(self):
        other_case, other_wives = self.make_case()
        for kind in ('son', 'daughter'):
            for value in ('abc', '999999', other_wives[0].pk):
                with self.subTest(kind=kind, value=value):
                    calc, _wives = self.make_case()
                    response = self.add(kind, calc, mother=value)
                    self.assertEqual(response.status_code, 404)
                    self.assertEqual(self.count(kind, calc), 0)

    def test_child_added_before_and_after_a_wife(self):
        calc, _wives = self.make_case(wives=0)
        self.add('son', calc)
        wife = Wife.objects.create(first_name='W', last_name='L', sex='F', calc=calc)
        calc.add_wife(wife)
        self.assertEqual(self.add('son', calc, mother='').status_code, 302)
        self.assertEqual(self.add('son', calc, mother=wife.pk).status_code, 302)
        self.assertEqual(self.count('son', calc), 3)

    def test_female_deceased_ignores_the_mother_field(self):
        calc, _wives = self.make_case(wives=0, sex='F')
        self.assertEqual(self.add('son', calc, mother='').status_code, 302)
        self.assertEqual(self.count('son', calc), 1)

    def test_mother_offered_by_the_page_is_accepted_in_every_language(self):
        """A large id must not be formatted as a number ("123,456") in the form."""
        for language, base in (('en', 123456), ('fr', 123556), ('ar', 123656)):
            for kind in ('son', 'daughter'):
                with self.subTest(language=language, kind=kind):
                    calc, _wives = self.make_case(wives=0)
                    wives = []
                    for offset in (0, 1):
                        wife = Wife.objects.create(id=base + offset, first_name='W', last_name='L', sex='F', calc=calc)
                        calc.add_wife(wife)
                        wives.append(wife)
                    base += 10
                    with translation.override(language):
                        page = self.client.get(reverse('calc:detail', args=[calc.pk]), secure=True)
                        html = page.content.decode().split('id="mother"')[1].split('</select>')[0]
                        offered = re.findall(r'<option[^>]*value="([^"]+)"', html)
                        self.assertEqual(offered, [str(wife.pk) for wife in wives])
                        response = self.add(kind, calc, mother=offered[0])
                    self.assertEqual(response.status_code, 302)
                    child = calc.heir_set.instance_of(Son, Daughter).get()
                    self.assertEqual(child.parents.female_id, wives[0].pk)

    def test_every_wife_is_named_in_the_mother_list(self):
        calc, wives = self.make_case()
        unnamed = Wife.objects.create(first_name='', last_name='', sex='F', calc=calc)
        calc.add_wife(unnamed)
        with translation.override('en'):
            page = self.client.get(reverse('calc:detail', args=[calc.pk]), secure=True)
        self.assertEqual(page.status_code, 200)
        html = re.sub(r'\s+', ' ', page.content.decode())
        self.assertRegex(html, rf'<option selected value="{wives[0].pk}"> Wife0 </option>')
        self.assertRegex(html, rf'<option value="{wives[1].pk}"> Wife1 </option>')
        self.assertRegex(html, rf'<option value="{unnamed.pk}"> \S+ 3 </option>')


# ---------------------------------------------------------------------------
# Hanbali distribution: fixture table and invariants
# ---------------------------------------------------------------------------

F = Fraction

HEIR_SEX = {
    Father: 'M', Mother: 'F', Husband: 'M', Wife: 'F', Daughter: 'F', Son: 'M',
    Brother: 'M', Sister: 'F', GrandFather: 'M', GrandMother: 'F', MaternalGrandMother: 'F', SonOfSon: 'M',
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


class DistributionFixtureTests(TransactionTestCase):
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
    for _ in range(200):
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


def assert_invariants(test, calc, heirs, exact):
    """The properties every result must have, whichever school it was calculated under."""
    rows = {h.pk: stored(h) for h in heirs}
    live = [h for h in heirs if not rows[h.pk].blocked]
    total = sum(exact[h.pk] for h in heirs)
    if all(isinstance(h, (Husband, Wife)) for h in live):
        test.assertLessEqual(total, 1)
    else:
        test.assertEqual(total, 1)
    for h in heirs:
        if rows[h.pk].blocked:
            test.assertEqual(exact[h.pk], 0)
            test.assertEqual(rows[h.pk].amount, 0)
        test.assertEqual(rows[h.pk].amount, half_up(ESTATE, exact[h.pk]))
    calc.refresh_from_db()
    if calc.correction and total == 1:
        # a spouse with no other heir leaves part of the estate unallocated, so only whole estates are checked
        test.assertEqual(sum(rows[h.pk].corrected_share for h in live), calc.shares_corrected)
    for cls in {type(h) for h in heirs}:
        test.assertLessEqual(len({exact[h.pk] for h in live if type(h) is cls}), 1)
    if calc.gf_shares_with_siblings():
        groups = [[h for h in live if isinstance(h, (Brother, Sister))],
                  [h for h in live if isinstance(h, (PaternalBrother, PaternalSister))]]
    else:
        groups = [[h for h in live if rows[h.pk].asaba]]
    for group in groups:
        males = {exact[h.pk] for h in group if HEIR_SEX[type(h)] == 'M' and exact[h.pk] > 0}
        females = {exact[h.pk] for h in group if HEIR_SEX[type(h)] == 'F' and exact[h.pk] > 0}
        if males and females:
            test.assertEqual(males.pop(), 2 * females.pop())


@tag('slow')
class DistributionInvariantTests(TransactionTestCase):
    """Properties that hold for every family, over all 22 relationship types."""

    def test_every_family_adds_up_and_is_fair(self):
        for sex, types in families():
            with self.subTest(f'{sex}: {[t.__name__ for t in types]}'):
                calc, heirs = build_case(sex, types)
                assert_invariants(self, calc, heirs, calc.compute())


@tag('slow')
class DistributionEntryOrderTests(TransactionTestCase):
    """Entry order never changes a result, over every family."""

    def test_entry_order_does_not_matter(self):
        for sex, types in families():
            with self.subTest(f'{sex}: {[t.__name__ for t in types]}'):
                forward, forward_heirs = build_case(sex, types)
                backward, backward_heirs = build_case(sex, list(reversed(types)))
                self.assertEqual(
                    fingerprint(forward, forward_heirs, forward.compute()),
                    fingerprint(backward, backward_heirs, backward.compute()),
                )


def core_family_reference(wives, husband, father, mother, sons, daughters):
    """The expected whole-group shares of a family of spouses, parents and children.

    Written separately from the engine, so that the two can only agree by being right. It
    follows the Hanbali position: awl, radd to non-spouse sharers, and Umariyyatan.
    """
    has_child = sons + daughters > 0
    fixed = {}
    if husband:
        fixed[Husband] = F(1, 4) if has_child else F(1, 2)
    if wives:
        fixed[Wife] = F(1, 8) if has_child else F(1, 4)
    spouse = sum(fixed.values(), F(0))
    if mother:
        if has_child:
            fixed[Mother] = F(1, 6)
        elif spouse and father:
            fixed[Mother] = (1 - spouse) / 3
        else:
            fixed[Mother] = F(1, 3)
    if father and has_child:
        fixed[Father] = F(1, 6)
    if daughters and not sons:
        fixed[Daughter] = F(1, 2) if daughters == 1 else F(2, 3)
    total = sum(fixed.values(), F(0))
    if total > 1:
        fixed = {cls: share / total for cls, share in fixed.items()}
        total = F(1)
    remainder = 1 - total
    shares = dict(fixed)
    if remainder:
        if sons:
            unit = remainder / (2 * sons + daughters)
            shares[Son] = 2 * unit * sons
            if daughters:
                shares[Daughter] = unit * daughters
        elif father:
            shares[Father] = shares.get(Father, F(0)) + remainder
        else:
            sharers = {cls: share for cls, share in fixed.items() if cls not in (Husband, Wife)}
            base = sum(sharers.values(), F(0))
            for cls, share in sharers.items():
                shares[cls] = share + remainder * share / base
    return shares


@tag('slow')
class CoreFamilyReferenceTests(TransactionTestCase):
    """Every mix of spouses, parents, and up to three sons and three daughters."""

    def test_every_core_family_matches_the_reference(self):
        checked = 0
        spouses = [('M', count, 0) for count in range(5)] + [('F', 0, 0), ('F', 0, 1)]
        for sex, wives, husband in spouses:
            for father, mother, sons, daughters in product((0, 1), (0, 1), range(4), range(4)):
                if not (wives or husband or father or mother or sons or daughters):
                    continue
                types = ([Wife] * wives + [Husband] * husband + [Father] * father + [Mother] * mother
                         + [Son] * sons + [Daughter] * daughters)
                with self.subTest(f'{sex}: {[t.__name__ for t in types]}'):
                    calc, heirs = build_case(sex, types)
                    exact = calc.compute()
                    groups = {}
                    for heir in heirs:
                        groups[type(heir)] = groups.get(type(heir), F(0)) + exact[heir.pk]
                    expected = core_family_reference(wives, husband, father, mother, sons, daughters)
                    self.assertEqual(groups, expected)
                checked += 1
        self.assertEqual(checked, 446)


# Calculation by school
# ---------------------------------------------------------------------------

SUNNI_SCHOOLS = schools.SUNNI
HANAFI, MALIKI, SHAFII, HANBALI = schools.HANAFI, schools.MALIKI, schools.SHAFII, schools.HANBALI
MUSHTARAKA_REASON = "Mushtaraka: the full siblings share the maternal siblings' third equally"

# (title, schools, deceased sex, heirs, [expected fraction of the whole estate per heir] or a refusal reason code)
# The Malikiyya family, which only Maliki refuses.
MALIKIYYA = [Husband, Mother, GrandFather, MaternalBrother, MaternalBrother, PaternalBrother]

SCHOOL_FIXTURES = [
    ('grandfather, brother', (HANBALI,), 'M', [GrandFather, Brother], [F(1, 2), F(1, 2)]),
    ('grandfather, brother', (HANAFI,), 'M', [GrandFather, Brother], [F(1), F(0)]),
    ('grandfather, sister', (HANAFI,), 'M', [GrandFather, Sister], [F(1), F(0)]),
    ('grandfather, paternal brother', (HANAFI,), 'M', [GrandFather, PaternalBrother], [F(1), F(0)]),
    ('grandfather, paternal sister', (HANAFI,), 'M', [GrandFather, PaternalSister], [F(1), F(0)]),
    ('grandfather, paternal brother and sister', (HANAFI,), 'M',
     [GrandFather, PaternalBrother, PaternalSister], [F(1), F(0), F(0)]),
    ('wife, grandfather, brother', (HANAFI,), 'M', [Wife, GrandFather, Brother], [F(1, 4), F(3, 4), F(0)]),
    ('daughter, grandfather, sister', (HANAFI,), 'M', [Daughter, GrandFather, Sister], [F(1, 2), F(1, 2), F(0)]),
    ('no akdariyya', (HANAFI,), 'F', [Husband, Mother, GrandFather, Sister], [F(1, 2), F(1, 3), F(1, 6), F(0)]),
    ('no shared-sibling rule', (HANAFI,), 'F', [Husband, Mother, MaternalBrother, MaternalBrother, Brother],
     [F(1, 2), F(1, 6), F(1, 6), F(1, 6), F(0)]),
    ('radd, as Hanbali', (HANAFI,), 'M', [Wife, Mother, Daughter, Daughter, Daughter],
     [F(1, 8), F(7, 40), F(7, 30), F(7, 30), F(7, 30)]),
    ('grandfather, brother', (MALIKI, SHAFII), 'M', [GrandFather, Brother], [F(1, 2), F(1, 2)]),
    ('mushtaraka', (MALIKI, SHAFII), 'F', [Husband, Mother, MaternalBrother, MaternalBrother, Brother],
     [F(1, 2), F(1, 6), F(1, 9), F(1, 9), F(1, 9)]),
    ('mushtaraka, equal regardless of sex', (MALIKI, SHAFII), 'F',
     [Husband, GrandMother, MaternalBrother, MaternalSister, Brother, Sister],
     [F(1, 2), F(1, 6), F(1, 12), F(1, 12), F(1, 12), F(1, 12)]),
    ('no full brother, so no sharing, awl to 9', (MALIKI, SHAFII), 'F',
     [Husband, Mother, MaternalBrother, MaternalBrother, Sister], [F(3, 9), F(1, 9), F(1, 9), F(1, 9), F(3, 9)]),
    ('muqasama', (SHAFII,), 'F', MALIKIYYA,
     [F(1, 2), F(1, 6), F(1, 6), F(0), F(0), F(1, 6)]),
    ('malikiyya', (MALIKI,), 'F', MALIKIYYA,
     schools.MALIKIYYA_DISPUTED),
    ('malikiyya with a grandmother', (MALIKI,), 'F',
     [Husband, GrandMother, GrandFather, MaternalBrother, MaternalBrother, PaternalBrother],
     schools.MALIKIYYA_DISPUTED),
    ('one maternal brother is not the malikiyya', (MALIKI,), 'F',
     [Husband, Mother, GrandFather, MaternalBrother, PaternalBrother], [F(1, 2), F(1, 6), F(1, 6), F(0), F(1, 6)]),
    ('no paternal brother is not the malikiyya', (MALIKI,), 'F',
     [Husband, Mother, GrandFather, MaternalBrother, MaternalBrother], [F(1, 2), F(1, 6), F(1, 3), F(0), F(0)]),
    ('mother, daughter', (MALIKI, SHAFII), 'M', [Mother, Daughter], [F(1, 4), F(3, 4)]),
    ('wife, grandmother', (MALIKI, SHAFII), 'M', [Wife, GrandMother], [F(1, 4), F(3, 4)]),
    ('radd with a spouse, as Hanbali', (MALIKI, SHAFII), 'M', [Wife, Mother, Daughter, Daughter, Daughter],
     [F(1, 8), F(7, 40), F(7, 30), F(7, 30), F(7, 30)]),
    ('spouse alone', (MALIKI, SHAFII), 'M', [Wife], [F(1, 4)]),
    ('one grandmother and a son is not refused', (HANAFI, MALIKI, SHAFII), 'M', [GrandMother, Son], [F(1, 6), F(5, 6)]),
    ('mother blocks both grandmothers', SUNNI_SCHOOLS, 'M', [Mother, MaternalGrandMother, GrandMother, Son],
     [F(1, 6), F(0), F(0), F(5, 6)]),
    ('father, paternal and maternal grandmother', (HANBALI,), 'M', [Father, GrandMother, MaternalGrandMother],
     [F(5, 6), F(1, 12), F(1, 12)]),
    ('father blocks his mother', (HANAFI, MALIKI, SHAFII), 'M', [Father, GrandMother, MaternalGrandMother],
     [F(5, 6), F(0), F(1, 6)]),
    ('father, paternal grandmother', (HANBALI,), 'M', [Father, GrandMother], [F(5, 6), F(1, 6)]),
    ('father, paternal grandmother', (HANAFI, MALIKI, SHAFII), 'M', [Father, GrandMother], [F(1), F(0)]),
    ('father, maternal grandmother', SUNNI_SCHOOLS, 'M', [Father, MaternalGrandMother], [F(5, 6), F(1, 6)]),
    ('both grandmothers share one sixth', SUNNI_SCHOOLS, 'M', [GrandMother, MaternalGrandMother, Son],
     [F(1, 12), F(1, 12), F(5, 6)]),
    ('grandfather does not block the grandmother', SUNNI_SCHOOLS, 'M', [GrandFather, GrandMother], [F(5, 6), F(1, 6)]),
    ('grandfather does not block the maternal grandmother', SUNNI_SCHOOLS, 'M',
     [GrandFather, MaternalGrandMother], [F(5, 6), F(1, 6)]),
    ('wife, maternal grandmother', (HANAFI, HANBALI), 'M', [Wife, MaternalGrandMother], [F(1, 4), F(3, 4)]),
    ('wife, maternal grandmother', (MALIKI, SHAFII), 'M', [Wife, MaternalGrandMother], [F(1, 4), F(3, 4)]),
    ('mushtaraka with both grandmothers', (MALIKI, SHAFII), 'F',
     [Husband, MaternalGrandMother, GrandMother, MaternalBrother, MaternalBrother, Brother],
     [F(1, 2), F(1, 12), F(1, 12), F(1, 9), F(1, 9), F(1, 9)]),
    ('malikiyya with a maternal grandmother', (MALIKI,), 'F',
     [Husband, MaternalGrandMother, GrandFather, MaternalBrother, MaternalBrother, PaternalBrother],
     schools.MALIKIYYA_DISPUTED),
    ('jafari', (schools.JAFARI,), 'M', [Son], schools.SCHOOL_NOT_SUPPORTED),
]


def run(sex, types, madhab=None):
    """Build a case, compute it under `madhab`, and return (outcome, calc, heirs).
    The outcome is the reason code when the run is refused."""
    calc, heirs = build_case(sex, types)
    try:
        exact = calc.compute() if madhab is None else calc.compute(madhab=madhab)
    except schools.UnsupportedCase as refusal:
        return refusal.reason, calc, heirs
    return exact, calc, heirs


def label(madhab, sex, types):
    return f'{madhab} {sex}: {[t.__name__ for t in types]}'


MUADDA_FIXTURES = [
    ('full brother', [GrandFather, Brother, PaternalBrother, PaternalSister],
     [F(1, 3), F(2, 3), F(0), F(0)]),
    ('sister with a daughter', [Daughter, GrandFather, Sister, PaternalSister],
     [F(1, 2), F(1, 4), F(1, 4), F(0)]),
    ("sisters with a son's daughter", [DaughterOfSon, GrandFather, Sister, Sister, PaternalBrother],
     [F(1, 2), F(1, 6), F(1, 6), F(1, 6), F(0)]),
]


class MuaddaTests(TransactionTestCase):
    def test_fractions_are_unchanged_and_the_predicate_holds(self):
        for madhab in (MALIKI, SHAFII, HANBALI):
            for title, types, expected in MUADDA_FIXTURES:
                with self.subTest(f'{madhab}: {title}'):
                    outcome, calc, heirs = run('M', types, madhab)
                    if expected is not None:
                        self.assertEqual([outcome[h.pk] for h in heirs], expected)
                    self.assertEqual(outcome[heirs[-1].pk], F(0))
                    self.assertFalse(stored(heirs[-1]).blocked)
                    self.assertTrue(calc.paternal_siblings_counted_out())

    def test_ashariyya_is_not_counted_out(self):
        for madhab in (MALIKI, SHAFII, HANBALI):
            with self.subTest(madhab):
                outcome, calc, heirs = run('M', [GrandFather, Sister, PaternalBrother], madhab)
                self.assertEqual([outcome[h.pk] for h in heirs], [F(2, 5), F(1, 2), F(1, 10)])
                self.assertFalse(calc.paternal_siblings_counted_out())

    def test_predicate_is_false_without_the_conditions(self):
        for madhab, types in ((HANAFI, [GrandFather, Brother, PaternalBrother]),
                              (HANBALI, [GrandFather, Sister, PaternalSister]),
                              (HANBALI, [GrandFather, Brother]),
                              (HANBALI, [Brother, PaternalBrother]),
                              (HANBALI, [Daughter, Sister, PaternalSister])):
            with self.subTest(madhab=madhab, types=[t.__name__ for t in types]):
                _outcome, calc, _heirs = run('M', types, madhab)
                self.assertFalse(calc.paternal_siblings_counted_out())


class SchoolFixtureTests(TransactionTestCase):
    """The matrix of school differences, one family per row."""

    def test_school_fixture_table(self):
        for title, madhabs, sex, types, expected in SCHOOL_FIXTURES:
            for madhab in madhabs:
                with self.subTest(f'{madhab}: {title}'):
                    outcome, calc, heirs = run(sex, types, madhab)
                    if isinstance(expected, str):
                        self.assertEqual(outcome, expected)
                        continue
                    self.assertEqual(len(expected), len(heirs))
                    self.assertEqual([outcome[h.pk] for h in heirs], expected)
                    for heir, fraction in zip(heirs, expected):
                        self.assertEqual(stored(heir).amount, half_up(ESTATE, fraction))
                    assert_invariants(self, calc, heirs, outcome)

    def test_a_blocked_grandmother_does_not_make_the_other_one_shared(self):
        for madhab, shared in ((HANAFI, False), (MALIKI, False), (SHAFII, False), (HANBALI, True)):
            with self.subTest(madhab):
                _outcome, _calc, (_father, paternal, maternal) = run(
                    'M', [Father, GrandMother, MaternalGrandMother], madhab)
                self.assertEqual(stored(maternal).shared_quote, shared)
                if shared:
                    self.assertTrue(stored(paternal).shared_quote)

    def test_a_refusal_is_not_a_generic_failure(self):
        calc, _heirs = build_case('F', MALIKIYYA)
        with self.assertRaises(schools.UnsupportedCase) as caught:
            calc.compute(madhab=MALIKI)
        self.assertEqual(caught.exception.reason, schools.MALIKIYYA_DISPUTED)
        self.assertNotIsInstance(caught.exception, ValueError)
        self.assertTrue(caught.exception.message)

    def test_unknown_school_is_a_value_error(self):
        calc, _heirs = build_case('M', [Son])
        for bad in ('hanbalii', '', None, 3, 'Hanafi'):
            with self.subTest(bad), self.assertRaises(ValueError):
                calc.compute(madhab=bad)

    def test_jafari_is_refused_before_anything_is_written(self):
        calc, heirs = build_case('M', [Son])
        with self.assertRaises(schools.UnsupportedCase):
            calc.compute(madhab=schools.JAFARI)
        self.assertEqual(stored(heirs[0]).amount, 0)

    def test_school_is_never_stored(self):
        calc, _heirs = build_case('M', [GrandFather, Brother])
        calc.compute(madhab=HANAFI)
        fresh = Calculation.objects.get(pk=calc.pk)
        self.assertEqual(fresh.madhab, HANBALI)
        self.assertNotIn('madhab', [f.name for f in Calculation._meta.get_fields()])

    def test_refused_run_then_normal_compute_gives_the_normal_result(self):
        for madhab, sex, types in ((MALIKI, 'F', MALIKIYYA),
                                   (schools.JAFARI, 'M', [Mother, Daughter])):
            with self.subTest(madhab):
                calc, heirs = build_case(sex, types)
                with self.assertRaises(schools.UnsupportedCase):
                    calc.compute(madhab=madhab)
                again = fingerprint(calc, heirs, calc.compute())
                reference, reference_calc, reference_heirs = run(sex, types)
                self.assertEqual(again, fingerprint(reference_calc, reference_heirs, reference))

    def test_a_school_run_then_a_normal_compute_forgets_the_school(self):
        calc, heirs = build_case('M', [GrandFather, Brother])
        calc.compute(madhab=HANAFI)
        exact = calc.compute()
        self.assertEqual([exact[h.pk] for h in heirs], [F(1, 2), F(1, 2)])

    def test_mushtaraka_members_keep_their_reason(self):
        types = [Husband, GrandMother, MaternalBrother, MaternalSister, Brother, Sister]
        for madhab in (MALIKI, SHAFII):
            with self.subTest(madhab), translation.override('en'):
                _outcome, _calc, heirs = run('F', types, madhab)
                reasons = [stored(h).quote_reason for h in heirs]
                self.assertEqual(reasons[2:], [MUSHTARAKA_REASON] * 4)
                self.assertNotIn(MUSHTARAKA_REASON, reasons[:2])

    def test_reasons_are_translated(self):
        import gettext
        reused = [
            "Brother/s are blocked by grandfather",
            "Sister/s are blocked by grandfather",
            "Paternal sister/s are blocked by grandfather",
            "Paternal brother/s are blocked by grandfather",
            "Paternal grandmother is blocked by father",
            "Maternal grandmother is blocked by mother",
            "Maternal grandmother gets 1/6 if no mother",
        ]
        for lang in ('ar', 'en', 'fr'):
            catalog = gettext.translation('django', settings.BASE_DIR / 'locale', languages=[lang])
            with translation.override('en'):
                reasons = [str(reason) for reason in schools.REASONS.values()]
            msgids = reasons + [MUSHTARAKA_REASON] + reused
            for msgid in msgids:
                with self.subTest(f'{lang}: {msgid}'):
                    translated = catalog.gettext(msgid)
                    self.assertTrue(translated)
                    if lang != 'en':
                        self.assertNotEqual(translated, msgid)


@tag('slow')
class SchoolInvariantTests(TransactionTestCase):
    """The engine's invariants and its agreement with the Hanbali results, school by school."""

    def test_every_family_under_every_school(self):
        """One pass over every family: invariants under each school, refusals bounded by
        school, no argument equal to Hanbali, and no difference from Hanbali but the listed ones."""
        allowed = {
            HANAFI: set(),
            MALIKI: {schools.MALIKIYYA_DISPUTED},
            SHAFII: set(),
        }
        refused = {madhab: 0 for madhab in SUNNI_SCHOOLS}
        for sex, types in families():
            hanbali, hanbali_calc, hanbali_heirs = run(sex, types, HANBALI)
            with self.subTest(label(HANBALI, sex, types)):
                self.assertNotIsInstance(hanbali, str)
                assert_invariants(self, hanbali_calc, hanbali_heirs, hanbali)
            if isinstance(hanbali, str):
                continue
            expected = fingerprint(hanbali_calc, hanbali_heirs, hanbali)
            live = Calculation.live_counts([stored(h) for h in hanbali_heirs])
            father_and_his_mother = bool(live.get('Father') and live.get('GrandMother') and not live.get('Mother'))
            differs = {HANAFI: hanbali_calc.gf_shares_with_siblings() or father_and_his_mother,
                       MALIKI: schools.has_mushtaraka(MALIKI, live) or father_and_his_mother,
                       SHAFII: schools.has_mushtaraka(SHAFII, live) or father_and_his_mother}
            with self.subTest(f'no argument: {sex}: {[t.__name__ for t in types]}'):
                plain, plain_calc, plain_heirs = run(sex, types)
                self.assertEqual(fingerprint(plain_calc, plain_heirs, plain), expected)
            for madhab in (HANAFI, MALIKI, SHAFII):
                with self.subTest(label(madhab, sex, types)):
                    outcome, calc, heirs = run(sex, types, madhab)
                    if isinstance(outcome, str):
                        refused[madhab] += 1
                        self.assertIn(outcome, allowed[madhab])
                        continue
                    assert_invariants(self, calc, heirs, outcome)
                    if not differs[madhab]:
                        self.assertEqual(fingerprint(calc, heirs, outcome), expected)
        self.assertEqual(refused[HANAFI], 0)
        # families() holds no Malikiyya family, so no school refuses any of them
        self.assertEqual(refused, {madhab: 0 for madhab in SUNNI_SCHOOLS})


class SchoolAgreementTests(TransactionTestCase):
    """A family all four schools agree on gets the same result in each."""

    def test_agreed_family_matches_in_all_four_schools(self):
        for sex, types in (('M', [Wife, Mother, Son, Daughter]), ('M', [Father, Mother, Daughter]),
                           ('F', [Husband, Mother, Sister]), ('M', [Daughter, Sister, PaternalSister]),
                           ('M', [Brother, Sister, MaternalBrother])):
            with self.subTest(f'{sex}: {[t.__name__ for t in types]}'):
                prints = []
                for madhab in SUNNI_SCHOOLS:
                    outcome, calc, heirs = run(sex, types, madhab)
                    if isinstance(outcome, str):
                        break
                    prints.append(fingerprint(calc, heirs, outcome))
                else:
                    self.assertEqual(len(set(map(repr, prints))), 1)


@tag('slow')
class SchoolEntryOrderTests(TransactionTestCase):
    """Entry order never changes a result, under every school."""

    def test_entry_order_does_not_matter_under_every_school(self):
        # every 5th family keeps the run short; the Hanbali test already covers all of them
        for sex, types in families()[::5]:
            for madhab in (HANAFI, MALIKI, SHAFII):
                with self.subTest(label(madhab, sex, types)):
                    forward, forward_calc, forward_heirs = run(sex, types, madhab)
                    backward, backward_calc, backward_heirs = run(sex, list(reversed(types)), madhab)
                    if isinstance(forward, str) or isinstance(backward, str):
                        self.assertEqual(forward if isinstance(forward, str) else None,
                                         backward if isinstance(backward, str) else None)
                        continue
                    self.assertEqual(fingerprint(forward_calc, forward_heirs, forward),
                                     fingerprint(backward_calc, backward_heirs, backward))


@tag('slow')
class SchoolCoreFamilyTests(TransactionTestCase):
    """The core families match the reference under every school."""

    def test_core_families_match_the_reference_under_every_school(self):
        checked = 0
        spouses = [('M', count, 0) for count in range(5)] + [('F', 0, 0), ('F', 0, 1)]
        for sex, wives, husband in spouses:
            for father, mother, sons, daughters in product((0, 1), (0, 1), range(4), range(4)):
                if not (wives or husband or father or mother or sons or daughters):
                    continue
                types = ([Wife] * wives + [Husband] * husband + [Father] * father + [Mother] * mother
                         + [Son] * sons + [Daughter] * daughters)
                expected = core_family_reference(wives, husband, father, mother, sons, daughters)
                hanbali = run(sex, types, HANBALI)
                for madhab in SUNNI_SCHOOLS:
                    with self.subTest(label(madhab, sex, types)):
                        outcome, calc, heirs = hanbali if madhab == HANBALI else run(sex, types, madhab)
                        self.assertNotIsInstance(outcome, str)
                        groups = {}
                        for heir in heirs:
                            groups[type(heir)] = groups.get(type(heir), F(0)) + outcome[heir.pk]
                        self.assertEqual(groups, expected)
                        checked += 1
        self.assertEqual(checked, 446 * 4)


# Proof of a result
# ---------------------------------------------------------------------------

from calc import proof as proof_module


RADD_CODES = {HANAFI: 'radd', HANBALI: 'radd', MALIKI: 'radd_later_scholars', SHAFII: 'radd_later_scholars'}


def proof_run(sex, types, madhab):
    """Compute under `madhab` and return (proof, heirs, outcome)."""
    outcome, calc, heirs = run(sex, types, madhab)
    assert not isinstance(outcome, str), outcome
    return calc.proof, heirs, outcome


def entry_of(proof, heir):
    return next(e for e in proof['heirs'] if e['heir'] == heir.pk)


def summary(entry):
    """rule / condition / blocked_by / verse / school_rule, as the spec's matrix reads."""
    return (entry['rule'], entry['condition'], entry['blocked_by'], entry['verse'], entry['school_rule'])


def without_refs(proof):
    return {**proof, 'heirs': [{k: v for k, v in e.items() if k != 'heir'} for e in proof['heirs']]}


def step_names(proof):
    return [s['step'] for s in proof['steps']]


def step_value(proof, name):
    return next(s['value'] for s in proof['steps'] if s['step'] == name)


class ProofMatrixTests(TransactionTestCase):
    """One test per row of the proof matrix."""

    def test_hanbali_wife_and_son(self):
        proof, (wife, son), _outcome = proof_run('M', [Wife, Son], HANBALI)
        self.assertEqual(proof['version'], 1)
        self.assertEqual(proof['madhab'], HANBALI)
        self.assertEqual(summary(entry_of(proof, wife)), ('fixed', 'descendant', None, '4:12', None))
        self.assertEqual(entry_of(proof, wife)['fraction'], {'numerator': 1, 'denominator': 8})
        self.assertEqual(entry_of(proof, wife)['share'], {'numerator': 1, 'denominator': 8})
        self.assertEqual(summary(entry_of(proof, son)), ('residuary', None, None, '4:11', None))
        self.assertEqual(entry_of(proof, son)['fraction'], None)
        self.assertEqual(entry_of(proof, son)['share'], {'numerator': 7, 'denominator': 8})
        self.assertEqual(proof['steps'], [{'step': 'base', 'value': 8}])
        self.assertEqual(proof['school_rules'], [])

    def test_hanafi_grandfather_blocks_the_brother(self):
        proof, (grandfather, brother), _outcome = proof_run('M', [GrandFather, Brother], HANAFI)
        self.assertEqual(summary(entry_of(proof, brother)),
                         ('blocked', None, 'grandfather', None, 'grandfather_blocks_siblings'))
        self.assertEqual(entry_of(proof, brother)['share'], {'numerator': 0, 'denominator': 1})
        self.assertEqual(entry_of(proof, grandfather)['school_rule'], 'grandfather_blocks_siblings')
        self.assertEqual(proof['school_rules'], ['grandfather_blocks_siblings'])
        self.assertEqual(proof['steps'], [{'step': 'base', 'value': 1}])

    def test_the_other_schools_share_between_grandfather_and_brother(self):
        for madhab in (HANBALI, MALIKI, SHAFII):
            with self.subTest(madhab):
                proof, (grandfather, brother), _outcome = proof_run('M', [GrandFather, Brother], madhab)
                entry = entry_of(proof, grandfather)
                self.assertEqual((entry['rule'], entry['option']), ('grandfather_best_option', 'muqasama'))
                self.assertEqual(entry['school_rule'], 'grandfather_shares_with_siblings')
                self.assertEqual(entry_of(proof, brother)['school_rule'], 'grandfather_shares_with_siblings')
                self.assertEqual(entry_of(proof, brother)['rule'], 'residuary')
                self.assertEqual(proof['school_rules'], ['grandfather_shares_with_siblings'])

    def test_each_grandfather_option_is_named(self):
        # (family, option, the grandfather share), each worked out by hand
        cases = [
            # the whole estate is left: sharing as one more brother gives 2/4 against 1/3 and 1/6
            ('M', [GrandFather, Brother], 'muqasama', F(1, 2)),
            # four brothers: sharing gives 2/10 = 1/5, a third of the remainder gives 1/3, a sixth is smaller
            ('M', [GrandFather] + [Brother] * 4, 'third_of_remainder', F(1, 3)),
            # husband 1/2 and mother 1/6 leave 1/3: sharing with three brothers gives 1/3 * 2/8 = 1/12,
            # a third of the remainder gives 1/9, and a sixth of the estate gives 1/6
            ('F', [Husband, Mother, GrandFather, Brother, Brother, Brother], 'sixth_of_estate', F(1, 6)),
        ]
        for sex, types, option, share in cases:
            with self.subTest(option):
                proof, heirs, _outcome = proof_run(sex, types, HANBALI)
                grandfather = next(h for h in heirs if isinstance(h, GrandFather))
                entry = entry_of(proof, grandfather)
                self.assertEqual(entry['rule'], 'grandfather_best_option')
                self.assertEqual(entry['option'], option)
                self.assertEqual(entry['share'], {'numerator': share.numerator, 'denominator': share.denominator})

    def test_maliki_and_shafii_mushtaraka(self):
        types = [Husband, Mother, MaternalBrother, MaternalBrother, Brother]
        for madhab in (MALIKI, SHAFII):
            with self.subTest(madhab):
                proof, heirs, _outcome = proof_run('F', types, madhab)
                for heir in heirs[2:]:
                    self.assertEqual(entry_of(proof, heir)['rule'], 'mushtaraka')
                    self.assertEqual(entry_of(proof, heir)['school_rule'], 'mushtaraka')
                    self.assertIsNone(entry_of(proof, heir)['verse'])
                self.assertEqual(proof['school_rules'], ['mushtaraka'])

    def test_the_father_rule_for_his_mother_is_named_by_school(self):
        for madhab, rule in ((HANBALI, 'grandmother_inherits_with_her_son'), (HANAFI, 'father_blocks_his_mother'),
                             (MALIKI, 'father_blocks_his_mother'), (SHAFII, 'father_blocks_his_mother')):
            with self.subTest(madhab):
                proof, (father, paternal, maternal), _outcome = proof_run(
                    'M', [Father, GrandMother, MaternalGrandMother], madhab)
                self.assertEqual(proof['school_rules'], [rule])
                self.assertEqual(entry_of(proof, paternal)['school_rule'], rule)
                self.assertEqual(entry_of(proof, maternal)['school_rule'], rule)
                self.assertEqual(entry_of(proof, paternal)['relationship'], 'paternal_grandmother')
                self.assertEqual(entry_of(proof, maternal)['relationship'], 'maternal_grandmother')
                blocked = madhab != HANBALI
                self.assertEqual(entry_of(proof, paternal)['blocked_by'], 'father' if blocked else None)
                self.assertEqual(entry_of(proof, paternal)['rule'], 'blocked' if blocked else 'fixed')

    def test_no_grandmother_rule_is_named_when_the_mother_or_no_father_decides(self):
        for madhab in SUNNI_SCHOOLS:
            for types in ([Mother, GrandMother, MaternalGrandMother, Son], [Father, MaternalGrandMother],
                          [GrandMother, MaternalGrandMother, Son], [Father, Mother, GrandMother]):
                with self.subTest(f'{madhab} {[t.__name__ for t in types]}'):
                    proof, _heirs, _outcome = proof_run('M', types, madhab)
                    self.assertFalse({'father_blocks_his_mother', 'grandmother_inherits_with_her_son'}
                                     & set(proof['school_rules']))

    def test_hanafi_and_hanbali_keep_the_brother_residuary(self):
        types = [Husband, Mother, MaternalBrother, MaternalBrother, Brother]
        for madhab in (HANAFI, HANBALI):
            with self.subTest(madhab):
                proof, (_husband, _mother, first, second, brother), _outcome = proof_run('F', types, madhab)
                self.assertEqual(summary(entry_of(proof, brother)),
                                 ('residuary', 'estate_exhausted', None, '4:176', 'no_mushtaraka'))
                self.assertEqual(entry_of(proof, brother)['share'], {'numerator': 0, 'denominator': 1})
                for heir in (first, second):
                    self.assertEqual(summary(entry_of(proof, heir)), ('fixed', 'several', None, '4:12', 'no_mushtaraka'))
                    self.assertEqual(entry_of(proof, heir)['fraction'], {'numerator': 1, 'denominator': 3})
                self.assertEqual(proof['school_rules'], ['no_mushtaraka'])

    def test_awl(self):
        for madhab in SUNNI_SCHOOLS:
            with self.subTest(madhab):
                proof, _heirs, _outcome = proof_run('F', [Husband, Sister, Sister], madhab)
                self.assertEqual(step_value(proof, 'base'), 6)
                self.assertEqual(step_value(proof, 'awl'), 7)
                self.assertEqual(step_names(proof), ['base', 'awl'])

    def test_radd(self):
        for madhab, code in RADD_CODES.items():
            with self.subTest(madhab):
                proof, heirs, _outcome = proof_run('M', [Mother, Daughter], madhab)
                self.assertIn('radd', step_names(proof))
                self.assertEqual(proof['school_rules'], [code])
                for heir in heirs:
                    self.assertEqual(entry_of(proof, heir)['school_rule'], code)

    def test_later_scholars_radd_proof_is_hanbalis_but_for_the_code(self):
        for sex, types in (('M', [Wife, Mother, Daughter, Daughter, Daughter]), ('M', [Wife, GrandMother])):
            hanbali, _heirs, _outcome = proof_run(sex, types, HANBALI)
            for madhab in (MALIKI, SHAFII):
                with self.subTest(f'{madhab}: {[t.__name__ for t in types]}'):
                    proof, heirs, _outcome = proof_run(sex, types, madhab)
                    self.assertEqual(proof['steps'], hanbali['steps'])
                    self.assertEqual(proof['school_rules'], ['radd_later_scholars'])
                    for mine, theirs in zip(proof['heirs'], hanbali['heirs']):
                        self.assertEqual(mine['share'], theirs['share'])
                    for heir in heirs:
                        expected = None if isinstance(heir, Wife) else 'radd_later_scholars'
                        self.assertEqual(entry_of(proof, heir)['school_rule'], expected)

    def test_a_spouse_alone_leaves_an_unallocated_part(self):
        for madhab in SUNNI_SCHOOLS:
            with self.subTest(madhab):
                proof, _heirs, _outcome = proof_run('M', [Wife], madhab)
                self.assertEqual(step_value(proof, 'unallocated'), {'numerator': 3, 'denominator': 4})
                self.assertEqual(step_names(proof), ['base', 'unallocated'])

    def test_correction_step(self):
        # two wives get 1/16 each and three sons 7/24 each: the base 8 is multiplied up to 48
        proof, _heirs, _outcome = proof_run('M', [Wife, Wife, Son, Son, Son], HANBALI)
        self.assertEqual(proof['steps'], [{'step': 'base', 'value': 8}, {'step': 'correction', 'value': 48}])

    def test_a_father_with_a_daughter_takes_a_sixth_and_the_remainder(self):
        proof, (father, daughter), _outcome = proof_run('M', [Father, Daughter], HANBALI)
        entry = entry_of(proof, father)
        self.assertEqual((entry['rule'], entry['condition']), ('fixed_and_residuary', 'female_descendant'))
        self.assertEqual(entry['fraction'], {'numerator': 1, 'denominator': 6})
        self.assertEqual(entry['share'], {'numerator': 1, 'denominator': 2})
        self.assertEqual(entry_of(proof, daughter)['share'], {'numerator': 1, 'denominator': 2})

    def test_a_father_left_no_remainder_does_not_claim_one(self):
        # husband 1/4, daughters 2/3, father 1/6 and mother 1/6 exceed the estate, so awl applies
        proof, heirs, _outcome = proof_run('F', [Husband, Daughter, Daughter, Father, Mother], HANBALI)
        entry = entry_of(proof, heirs[3])
        self.assertEqual((entry['rule'], entry['condition']), ('fixed_and_residuary', 'estate_exhausted'))
        self.assertEqual(entry['fraction'], {'numerator': 1, 'denominator': 6})
        self.assertEqual(entry['share'], {'numerator': 2, 'denominator': 15})
        self.assertIn('awl', step_names(proof))

    def test_paternal_siblings_beside_full_siblings_get_nothing(self):
        proof, (_grandfather, brother, paternal), _outcome = proof_run(
            'M', [GrandFather, Brother, PaternalBrother], HANBALI)
        entry = entry_of(proof, paternal)
        self.assertEqual((entry['rule'], entry['condition']), ('residuary', 'excluded_by_full_siblings'))
        self.assertEqual(entry['share'], {'numerator': 0, 'denominator': 1})
        self.assertEqual(entry_of(proof, brother)['condition'], 'with_grandfather')

    def test_radd_with_a_spouse_reports_the_base_the_shares_end_in(self):
        for madhab, code in RADD_CODES.items():
            with self.subTest(f'{madhab}: one radd group'):
                # wife 1/8, daughter 7/8: the base is the wife denominator, 8
                proof, (wife, daughter), _outcome = proof_run('M', [Wife, Daughter], madhab)
                self.assertEqual(proof['steps'], [{'step': 'base', 'value': 8}, {'step': 'radd', 'value': 8}])
                self.assertIsNone(entry_of(proof, wife)['school_rule'])
                self.assertEqual(entry_of(proof, daughter)['school_rule'], code)
            with self.subTest(f'{madhab}: two radd groups'):
                # wife 1/8, mother 7/32, daughter 21/32: the shares end in thirty-seconds
                proof, (wife, mother, daughter), _outcome = proof_run('M', [Wife, Mother, Daughter], madhab)
                self.assertEqual(proof['steps'], [{'step': 'base', 'value': 24}, {'step': 'radd', 'value': 32}])
                self.assertIsNone(entry_of(proof, wife)['school_rule'])
                for heir in (mother, daughter):
                    self.assertEqual(entry_of(proof, heir)['school_rule'], code)
                self.assertEqual(entry_of(proof, mother)['share'], {'numerator': 7, 'denominator': 32})
                self.assertEqual(entry_of(proof, daughter)['share'], {'numerator': 21, 'denominator': 32})
                self.assertEqual(proof['school_rules'], [code])

    def test_a_proof_without_a_basis_or_a_known_class_is_refused(self):
        share = F(1)
        basis = {'rule': 'fixed', 'condition': None, 'blocked_by': None, 'fraction': F(1, 2),
                 'school_rule': None, 'option': None}
        steps = {'base': 1, 'awl': None, 'radd': None, 'correction': None, 'unallocated': None}
        with self.assertRaisesMessage(ValueError, 'Son'):
            proof_module.build(HANBALI, [(1, 'Son', None, share)], steps)
        with self.assertRaisesMessage(ValueError, 'Stranger'):
            proof_module.build(HANBALI, [(1, 'Stranger', basis, share)], steps)
        built = proof_module.build(HANBALI, [(1, 'Son', basis, share)], steps)
        self.assertEqual(built['heirs'][0]['relationship'], 'son')

    def test_akdariyya(self):
        proof, (_husband, _mother, grandfather, sister), _outcome = proof_run(
            'F', [Husband, Mother, GrandFather, Sister], HANBALI)
        for heir in (grandfather, sister):
            self.assertEqual(entry_of(proof, heir)['rule'], 'akdariyya')
        self.assertEqual(entry_of(proof, grandfather)['school_rule'], 'grandfather_shares_with_siblings')

    def test_hanafi_has_no_akdariyya(self):
        proof, (_husband, _mother, grandfather, sister), _outcome = proof_run(
            'F', [Husband, Mother, GrandFather, Sister], HANAFI)
        self.assertEqual(entry_of(proof, sister)['rule'], 'blocked')
        self.assertEqual(entry_of(proof, grandfather)['rule'], 'residuary')

    def test_a_refused_case_has_no_proof(self):
        calc, _heirs = build_case('M', [Son])
        with self.assertRaises(schools.UnsupportedCase):
            calc.compute(madhab=schools.JAFARI)
        self.assertIsNone(calc.proof)
        calc, _heirs = build_case('F', MALIKIYYA)
        calc.compute(madhab=HANBALI)
        self.assertIsNotNone(calc.proof)
        with self.assertRaises(schools.UnsupportedCase):
            calc.compute(madhab=MALIKI)
        self.assertIsNone(calc.proof, 'a refused run leaves no proof from an earlier one')
        calc.compute(madhab=HANBALI)
        with self.assertRaises(schools.UnsupportedCase):
            calc.compute(madhab=schools.JAFARI)
        self.assertIsNone(calc.proof)
        calc.compute(madhab=HANBALI)
        with self.assertRaises(ValueError):
            calc.compute(madhab='nonsense')
        self.assertIsNone(calc.proof)
        self.assertIsNone(calc._proof_steps)

    def test_two_schools_name_their_own_rule(self):
        hanafi, _heirs, _outcome = proof_run('M', [GrandFather, Brother], HANAFI)
        hanbali, _heirs, _outcome = proof_run('M', [GrandFather, Brother], HANBALI)
        self.assertNotEqual(hanafi['school_rules'], hanbali['school_rules'])

    def test_the_proof_is_never_stored_and_no_argument_still_works(self):
        self.assertNotIn('proof', [f.name for f in Calculation._meta.get_fields()])
        self.assertNotIn('basis', [f.name for f in Heir._meta.get_fields()])
        calc, heirs = build_case('M', [Wife, Son])
        exact = calc.compute()
        self.assertEqual([exact[h.pk] for h in heirs], [F(1, 8), F(7, 8)])
        self.assertEqual(calc.proof['madhab'], HANBALI)

    def test_fractions_are_exact_plain_data(self):
        import json
        proof, _heirs, _outcome = proof_run('M', [Wife, Wife, Son], HANBALI)
        self.assertEqual(json.loads(json.dumps(proof)), proof)


@tag('slow')
class ProofInvariantTests(TransactionTestCase):
    """Properties of the proof over every family and school."""

    def test_every_family_under_every_school(self):
        from calc.proof import VOCABULARY
        checked = 0
        for sex, types in families():
            for madhab in SUNNI_SCHOOLS:
                with self.subTest(label(madhab, sex, types)):
                    outcome, calc, heirs = run(sex, types, madhab)
                    if isinstance(outcome, str):
                        self.assertIsNone(calc.proof)
                        continue
                    proof = calc.proof
                    checked += 1
                    self.assertEqual(proof['version'], 1)
                    self.assertEqual(proof['madhab'], madhab)
                    self.assertEqual(sorted(e['heir'] for e in proof['heirs']), sorted(h.pk for h in heirs))
                    for heir in heirs:
                        entry = entry_of(proof, heir)
                        self.assertEqual((entry['share']['numerator'], entry['share']['denominator']),
                                         (outcome[heir.pk].numerator, outcome[heir.pk].denominator))
                        self.assertEqual(entry['relationship'], proof_module.RELATIONSHIPS[type(heir).__name__])
                        self.assertIn(entry['rule'], VOCABULARY['rule'])
                        self.assertEqual(entry['rule'] == 'blocked', entry['blocked_by'] is not None)
                        if entry['rule'] == 'blocked':
                            self.assertEqual(entry['share']['numerator'], 0)
                            self.assertIsNone(entry['verse'])
                        for kind in ('condition', 'blocked_by', 'school_rule', 'option', 'verse'):
                            if entry[kind] is not None:
                                self.assertIn(entry[kind], VOCABULARY[kind])
                        self.assertEqual(entry['fraction'] is not None,
                                         entry['rule'] in ('fixed', 'fixed_and_residuary'))
                        self.assertEqual(entry['option'] is not None, entry['rule'] == 'grandfather_best_option')
                    for step in proof['steps']:
                        self.assertIn(step['step'], VOCABULARY['step'])
                    self.assertEqual(proof['steps'][0]['step'], 'base')
                    self.assertEqual(proof['school_rules'],
                                     sorted({e['school_rule'] for e in proof['heirs'] if e['school_rule']}))
                    for rule in proof['school_rules']:
                        self.assertIn(rule, VOCABULARY['school_rule'])
                    # the same family under the same school gives the same proof on a second run
                    again = calc.compute(madhab=madhab)
                    self.assertEqual(again, outcome)
                    self.assertEqual(calc.proof, proof)
        self.assertGreater(checked, 500)


@tag('slow')
class ProofGrandfatherOptionTests(TransactionTestCase):
    """The grandfather's share is what the proof's named option gives."""

    def test_the_grandfather_gets_what_his_named_option_gives(self):
        sibling_names = {'brother', 'sister', 'paternal_brother', 'paternal_sister'}
        seen = set()
        for sex, types in families():
            for madhab in SUNNI_SCHOOLS:
                outcome, calc, heirs = run(sex, types, madhab)
                if isinstance(outcome, str):
                    continue
                entries = calc.proof['heirs']
                for grandfather in (e for e in entries if e['rule'] == 'grandfather_best_option'):
                    with self.subTest(label(madhab, sex, types)):
                        if 'awl' in step_names(calc.proof):
                            continue
                        fixed = {(e['relationship'], e['fraction']['numerator'], e['fraction']['denominator'])
                                 for e in entries if e['rule'] == 'fixed'}
                        left = 1 - sum((F(n, d) for _r, n, d in fixed), F(0))
                        units = sum(2 if e['relationship'] in ('brother', 'paternal_brother') else 1
                                    for e in entries if e['relationship'] in sibling_names)
                        formula = {'muqasama': left * 2 / (2 + units), 'third_of_remainder': left / 3,
                                   'sixth_of_estate': F(1, 6)}
                        share = F(grandfather['share']['numerator'], grandfather['share']['denominator'])
                        self.assertEqual(share, formula[grandfather['option']])
                        self.assertEqual(share, max(formula.values()))
                        seen.add(grandfather['option'])
        self.assertEqual(seen, {'muqasama', 'third_of_remainder', 'sixth_of_estate'})


@tag('slow')
class ProofEntryOrderTests(TransactionTestCase):
    """Entry order never changes the proof."""

    def test_entry_order_does_not_change_the_proof(self):
        # every 3rd family keeps the run short; the invariants test above runs all of them
        for sex, types in families()[::3]:
            for madhab in SUNNI_SCHOOLS:
                with self.subTest(label(madhab, sex, types)):
                    forward, forward_calc, _heirs = run(sex, types, madhab)
                    backward, backward_calc, _heirs = run(sex, list(reversed(types)), madhab)
                    if isinstance(forward, str) or isinstance(backward, str):
                        self.assertEqual(forward if isinstance(forward, str) else None,
                                         backward if isinstance(backward, str) else None)
                        continue
                    self.assertEqual(without_refs(forward_calc.proof), without_refs(backward_calc.proof))


@tag('slow')
class ProofGrandfatherRuleTests(TransactionTestCase):
    """The proof names the grandfather rule wherever it decides a share."""

    def test_the_proof_names_the_rule_wherever_the_grandfather_rule_decides(self):
        sibling_types = {Brother, Sister, PaternalBrother, PaternalSister}
        sibling_names = {'brother', 'sister', 'paternal_brother', 'paternal_sister'}
        for sex, types in families():
            for madhab in SUNNI_SCHOOLS:
                outcome, calc, heirs = run(sex, types, madhab)
                if isinstance(outcome, str):
                    continue
                with self.subTest(label(madhab, sex, types)):
                    kinds = set(types)
                    decided = (GrandFather in kinds and not kinds & {Father, Son, SonOfSon}
                               and bool(kinds & sibling_types))
                    rules = set(calc.proof['school_rules'])
                    both = {'grandfather_blocks_siblings', 'grandfather_shares_with_siblings'}
                    if decided:
                        expected = ('grandfather_blocks_siblings' if madhab == HANAFI
                                    else 'grandfather_shares_with_siblings')
                        self.assertEqual(rules & both, {expected})
                        for entry in calc.proof['heirs']:
                            if entry['relationship'] == 'grandfather' or entry['relationship'] in sibling_names:
                                self.assertEqual(entry['school_rule'], expected)
                    else:
                        self.assertFalse(rules & both)


class ScholarsTableTests(TransactionTestCase):
    """calc.table: the legacy columns, totals and merged cells, all the engine's own numbers."""

    FIELDS = {'base': 'share', 'awl': 'share', 'radd': 'shorted_share', 'remainder': 'shorted_share',
              'radd_calc': 'shortage_calc_share', 'radd_union': 'shortage_union_share',
              'correction': 'corrected_share'}
    TOTALS = {'base': 'shares', 'awl': 'shares_excess', 'radd': 'shares_shorted',
              'remainder': 'shares_shorted', 'radd_calc': 'shortage_calc_shares',
              'radd_union': 'shortage_union_shares', 'correction': 'shares_corrected'}

    def table(self, sex, types, madhab='hanbali'):
        calc, heirs = build_case(sex, types)
        calc.compute(madhab=madhab)
        return calc.table, Calculation.objects.get(pk=calc.pk), heirs

    def codes(self, table):
        return [c['code'] for c in table['columns']]

    def test_plain_has_the_base_only(self):
        table, _calc, heirs = self.table('M', [Wife, Son])
        self.assertEqual(self.codes(table), ['base'])
        by = {r['heir']: r for r in table['rows']}
        self.assertEqual(by[heirs[0].pk]['prescribed'], {'numerator': 1, 'denominator': 8})
        self.assertIsNone(by[heirs[1].pk]['prescribed'])

    def test_prescribed_group_spans(self):
        table, _calc, heirs = self.table('M', [Wife, Wife, Son])
        wives = [r for r in table['rows'] if r['heir'] in {h.pk for h in heirs[:2]}]
        self.assertEqual([r['group_span'] for r in wives], [2, 0])
        table, _calc, _heirs = self.table('M', [Son])
        self.assertEqual(table['rows'][0]['group_span'], 1)

    def test_mushtaraka_shows_the_shared_third_once(self):
        table, _calc, heirs = self.table('F', [Husband, Mother, MaternalBrother, MaternalSister, Brother], 'maliki')
        pool = {h.pk for h in heirs[2:]}
        rows = [r for r in table['rows'] if r['heir'] in pool]
        self.assertEqual([r['prescribed'] for r in rows], [{'numerator': 1, 'denominator': 3}] * 3)
        self.assertEqual([r['group_span'] for r in rows], [3, 0, 0])

    def test_akdariyya_keeps_each_ones_own_share(self):
        table, _calc, heirs = self.table('F', [Husband, Mother, GrandFather, Sister])
        by = {r['heir']: r for r in table['rows']}
        grandfather, sister = by[heirs[2].pk], by[heirs[3].pk]
        self.assertEqual(grandfather['prescribed'], {'numerator': 1, 'denominator': 6})
        self.assertEqual(sister['prescribed'], {'numerator': 1, 'denominator': 2})
        self.assertEqual((grandfather['group_span'], sister['group_span']), (1, 1))

    def test_awl(self):
        table, _calc, _heirs = self.table('F', [Husband, Sister, Sister])
        self.assertEqual(self.codes(table), ['base', 'awl'])
        self.assertEqual([c['total'] for c in table['columns']], [6, 7])

    def test_radd_and_remainder_code(self):
        table, _calc, _heirs = self.table('F', [Mother, Daughter], 'hanafi')
        self.assertEqual(self.codes(table), ['base', 'radd'])
        table, _calc, _heirs = self.table('F', [Father, Daughter])
        self.assertEqual(self.codes(table), ['base', 'remainder'])

    def test_radd_with_a_spouse_and_several_groups(self):
        table, _calc, _heirs = self.table('M', [Wife, Mother, Daughter], 'hanafi')
        self.assertEqual(self.codes(table)[:4], ['base', 'radd', 'radd_calc', 'radd_union'])

    def test_correction_merges_the_group_cell(self):
        table, calc, heirs = self.table('M', [Wife, Son, Son, Son])
        self.assertEqual(self.codes(table), ['base', 'correction'])
        sons = [r for r in table['rows'] if r['heir'] in {h.pk for h in heirs[1:]}]
        self.assertEqual([r['cells'][0]['span'] for r in sons], [3, 0, 0])
        self.assertEqual([r['cells'][1]['span'] for r in sons], [1, 1, 1])
        self.assertEqual(table['rows'][0]['cells'][0]['span'], 1)

    def test_blocked_heirs_come_last_with_empty_cells(self):
        table, _calc, heirs = self.table('M', [Father, Son, Brother])
        last = table['rows'][-1]
        self.assertEqual(last['heir'], heirs[2].pk)
        self.assertTrue(last['blocked'])
        self.assertEqual(last['group_span'], 1)
        self.assertTrue(all(c == {'value': None, 'span': 1} for c in last['cells']))

    def test_values_equal_the_saved_fields(self):
        for sex, types in families()[::3]:
            for madhab in SUNNI_SCHOOLS:
                with self.subTest(label(madhab, sex, types)):
                    result, calc, _heirs = run(sex, types, madhab)
                    if isinstance(result, str):
                        continue
                    table = calc.table
                    # the last column, read as a fraction of its total, is each heir's share of the estate;
                    # a merged cell is the sum of the rows it covers
                    codes = set(self.codes(table))
                    self.assertFalse('awl' in codes and codes & {'radd', 'remainder'})
                    self.assertFalse('radd' in codes and 'remainder' in codes)
                    self.assertEqual('radd_calc' in codes, 'radd_union' in codes)
                    if 'radd_calc' in codes:
                        self.assertIn('radd', codes)
                    last = len(table['columns']) - 1
                    rows = table['rows']
                    for index, row in enumerate(rows):
                        cell = row['cells'][last]
                        if row['blocked'] or cell['span'] == 0:
                            continue
                        covered = rows[index:index + cell['span']]
                        self.assertEqual(F(cell['value'], table['columns'][last]['total']),
                                         sum(result[r['heir']] for r in covered))
                    self.assertEqual(table['columns'][0]['code'], 'base')
                    # a shared prescribed cell covers rows with the very same prescribed share
                    for index, row in enumerate(rows):
                        if row['group_span'] > 0:
                            covered = rows[index:index + row['group_span']]
                            self.assertEqual([r['group_span'] for r in covered[1:]], [0] * (len(covered) - 1))
                            self.assertEqual({str(r['prescribed']) for r in covered}, {str(row['prescribed'])})
                    self.assertEqual({r['heir'] for r in table['rows']}, {h.pk for h in calc.heir_set.all()})
                    saved = {h.pk: h for h in calc.heir_set.all()}
                    for index, column in enumerate(table['columns']):
                        self.assertEqual(column['total'], getattr(calc, self.TOTALS[column['code']]))
                        self.assertGreater(column['total'], 0)
                        for row in table['rows']:
                            cell = row['cells'][index]
                            if row['blocked']:
                                self.assertIsNone(cell['value'])
                            else:
                                self.assertEqual(cell['value'], getattr(saved[row['heir']], self.FIELDS[column['code']]))


class ProofLabelTests(TestCase):
    def test_every_code_has_a_label_in_every_language(self):
        import gettext
        from calc.proof import LABELS, VOCABULARY
        for kind, codes in VOCABULARY.items():
            self.assertEqual(set(LABELS[kind]), set(codes), kind)
        for lang in ('ar', 'en', 'fr'):
            catalog = gettext.translation('django', settings.BASE_DIR / 'locale', languages=[lang])
            with translation.override('en'):
                msgids = [str(LABELS[kind][code]) for kind, codes in VOCABULARY.items() for code in codes]
            self.assertEqual(len(set(msgids)), len(msgids), 'two codes share one label')
            for msgid in msgids:
                with self.subTest(f'{lang}: {msgid}'):
                    translated = catalog.gettext(msgid)
                    self.assertTrue(translated)
                    if lang != 'en':
                        self.assertNotEqual(translated, msgid)

    def test_labels_follow_the_active_language(self):
        from calc.proof import label
        with translation.override('en'):
            english = label('rule', 'blocked')
        with translation.override('ar'):
            arabic = label('rule', 'blocked')
        self.assertNotEqual(english, arabic)
        self.assertIsNone(label('rule', None))


class ComputeTransactionTests(TransactionTestCase):
    """compute() is one locked transaction. These are TransactionTestCase so no outer
    test transaction hides a rollback."""

    def settled(self):
        calc, heirs = build_case('F', MALIKIYYA)
        exact = calc.compute(madhab=HANBALI)
        return calc, heirs, exact

    def test_mid_run_failure_leaves_the_stored_result(self):
        calc, heirs, exact = self.settled()
        before = fingerprint(calc, heirs, exact)
        with mock.patch.object(Calculation, 'distribute', side_effect=RuntimeError('boom')):
            with self.assertRaises(RuntimeError):
                calc.compute()
        self.assertEqual(fingerprint(calc, heirs, exact), before)

    def test_refusal_without_a_caller_transaction_leaves_the_stored_result(self):
        calc, heirs, exact = self.settled()
        before = fingerprint(calc, heirs, exact)
        with self.assertRaises(schools.UnsupportedCase):
            calc.compute(madhab=MALIKI)
        self.assertEqual(fingerprint(calc, heirs, exact), before)

    def test_stale_instance_preserves_committed_name_and_owner(self):
        calc, heirs = build_case('M', [Son])
        owner = User.objects.create(username='new-owner')
        Calculation.objects.filter(pk=calc.pk).update(name='renamed', user=owner)
        calc.compute()
        calc.refresh_from_db()
        self.assertEqual(calc.name, 'renamed')
        self.assertEqual(calc.user_id, owner.pk)

    def test_deleted_case_is_not_recreated(self):
        calc, heirs = build_case('M', [Son])
        Calculation.objects.filter(pk=calc.pk).delete()
        with self.assertRaises(Calculation.DoesNotExist):
            calc.compute()
        self.assertFalse(Calculation.objects.filter(pk=calc.pk).exists())
        self.assertFalse(Heir.objects.filter(pk=heirs[0].pk).exists())


@unittest.skipUnless(connection.vendor == 'postgresql', 'Row locks need PostgreSQL.')
class ComputeConcurrencyTests(TransactionTestCase):
    """Concurrent compute and delete requests obey the calculation row lock."""

    WAIT = 10

    def setUp(self):
        self.calc, self.heirs = build_case('F', MALIKIYYA)
        self.exact = self.calc.compute()
        self.before = fingerprint(self.calc, self.heirs, self.exact)
        self.held = threading.Event()
        self.release = threading.Event()
        self.second_cleared = threading.Event()
        self.threads = []
        self.failures = []
        self.results = {}
        self.pids = {}
        self.addCleanup(self.release.set)

    def patched_clear(self):
        real = Calculation.clear

        def clear(calc):
            if threading.current_thread().name == 'first':
                real(calc)
                self.held.set()
                if not self.release.wait(60):
                    raise RuntimeError('The first run was never released.')
            else:
                self.second_cleared.set()
                real(calc)

        return mock.patch.object(Calculation, 'clear', clear)

    def spawn(self, name):
        def call():
            try:
                with connection.cursor() as cursor:
                    cursor.execute('SELECT pg_backend_pid()')
                    self.pids[name] = cursor.fetchone()[0]
                self.results[name] = Calculation.objects.get(pk=self.calc.pk).compute()
            except BaseException:
                self.failures.append(f'{name}:\n{traceback.format_exc()}')
            finally:
                connections.close_all()

        thread = threading.Thread(name=name, target=call, daemon=True)
        self.threads.append(thread)
        thread.start()

    def finish(self):
        for thread in self.threads:
            thread.join(30)
        self.assertEqual([t.name for t in self.threads if t.is_alive()], [])
        if self.failures:
            self.fail('A run raised:\n' + '\n'.join(self.failures))

    def second_waits_on_a_lock(self):
        pid = self.pids.get('second')
        if pid is None:
            return False
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT 1 FROM pg_stat_activity WHERE pid = %s AND wait_event_type = 'Lock'", [pid])
            return cursor.fetchone() is not None

    def test_two_runs_at_once_go_one_after_another(self):
        with self.patched_clear():
            self.spawn('first')
            self.assertTrue(self.held.wait(self.WAIT), 'The first run never reached clear().')
            self.spawn('second')
            pause = threading.Event()
            for _ in range(self.WAIT * 100):
                if self.second_cleared.is_set() or self.second_waits_on_a_lock():
                    break
                pause.wait(0.01)
            reached = self.second_cleared.is_set()
            waiting = self.second_waits_on_a_lock()
            self.release.set()
            self.finish()
        self.assertFalse(reached, 'The second run reached clear() while the first was held.')
        self.assertTrue(waiting, 'The second run was not waiting on a lock.')
        self.assertEqual(set(self.results), {'first', 'second'})
        self.assertEqual(self.results['first'], self.results['second'])
        self.assertEqual(fingerprint(self.calc, self.heirs, self.exact), self.before)

    def test_a_reader_never_sees_the_zeroed_state(self):
        with self.patched_clear():
            self.spawn('first')
            self.assertTrue(self.held.wait(self.WAIT), 'The first run never reached clear().')
            try:
                during = fingerprint(self.calc, self.heirs, self.exact)
            finally:
                self.release.set()
            self.finish()
        self.assertEqual(during, self.before)

    def test_heir_delete_waits_for_compute(self):
        pk = self.heirs[0].pk
        client = Client()
        client.force_login(self.calc.user)
        done = threading.Event()
        person_loaded = threading.Event()
        real_get_object = views.HeirDelete.get_object

        def get_object(view, *args, **kwargs):
            person_loaded.set()
            return real_get_object(view, *args, **kwargs)

        def delete_heir():
            try:
                with connection.cursor() as cursor:
                    cursor.execute('SELECT pg_backend_pid()')
                    self.pids['second'] = cursor.fetchone()[0]
                self.results['delete'] = client.post(
                    reverse('calc:heir_delete', args=[pk]), secure=True)
            except BaseException:
                self.failures.append(traceback.format_exc())
            finally:
                done.set()
                connections.close_all()

        with self.patched_clear(), mock.patch.object(views.HeirDelete, 'get_object', get_object):
            self.spawn('first')
            try:
                self.assertTrue(self.held.wait(self.WAIT))
                thread = threading.Thread(name='second', target=delete_heir, daemon=True)
                self.threads.append(thread)
                thread.start()
                pause = threading.Event()
                for _ in range(self.WAIT * 100):
                    if done.is_set() or self.second_waits_on_a_lock():
                        break
                    pause.wait(0.01)
                waiting = self.second_waits_on_a_lock()
                completed = done.is_set()
                loaded = person_loaded.is_set()
            finally:
                self.release.set()
                self.finish()
        self.assertTrue(waiting, 'The heir delete did not wait on the case lock.')
        self.assertFalse(completed)
        self.assertFalse(loaded, 'The person was loaded for deletion before the case lock.')
        self.assertEqual(self.results['delete'].status_code, 302)
        self.assertFalse(Heir.objects.filter(pk=pk).exists())

    def test_delete_waits_for_compute(self):
        pk = self.calc.pk
        heirs_gone = threading.Event()

        def hold_delete(sender, instance, **kwargs):
            # Subclass signals fire before the base Heir rows are deleted.
            if (isinstance(instance, Heir) and sender is Heir
                    and threading.current_thread().name == 'delete'
                    and not heirs_gone.is_set()):
                heirs_gone.set()
                if not self.release.wait(60):
                    raise RuntimeError('The delete was never released.')

        def call(name):
            try:
                if name == 'delete':
                    client = Client()
                    client.force_login(self.calc.user)
                with connection.cursor() as cursor:
                    cursor.execute('SELECT pg_backend_pid()')
                    self.pids[name] = cursor.fetchone()[0]
                if name == 'delete':
                    # Nullable cascade FKs otherwise let Django delete the case first.
                    # Require the heir-first order whose lock inversion we exercise.
                    with mock.patch.object(Heir._meta.get_field('calc'), 'null', False):
                        self.results[name] = client.post(reverse('calc:delete', args=[pk]), secure=True)
                else:
                    Calculation.objects.get(pk=pk).compute()
            except Calculation.DoesNotExist as exc:
                if name == 'compute':
                    self.results[name] = exc
                else:
                    self.failures.append(f'{name}:\n{traceback.format_exc()}')
            except BaseException:
                self.failures.append(f'{name}:\n{traceback.format_exc()}')
            finally:
                connections.close_all()

        def start(name):
            thread = threading.Thread(name=name, target=call, args=(name,), daemon=True)
            self.threads.append(thread)
            thread.start()

        post_delete.connect(hold_delete)
        try:
            start('delete')
            self.assertTrue(heirs_gone.wait(self.WAIT), 'The delete never reached its heir cascade.')
            start('compute')
            waiting = False
            pause = threading.Event()
            for _ in range(self.WAIT * 100):
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT 1 FROM pg_stat_activity WHERE pid = %s AND wait_event_type = 'Lock'",
                        [self.pids.get('compute')])
                    waiting = cursor.fetchone() is not None
                if waiting:
                    break
                pause.wait(0.01)
        finally:
            self.release.set()
            try:
                self.finish()
            finally:
                post_delete.disconnect(hold_delete)
        self.assertTrue(waiting, 'The compute was not waiting on a lock.')
        self.assertEqual(self.results['delete'].status_code, 302)
        self.assertFalse(Calculation.objects.filter(pk=pk).exists())
        self.assertIsInstance(self.results.get('compute'), Calculation.DoesNotExist)


class CalculationWriteViewTests(TestCase):
    def setUp(self):
        self.calc, self.heirs = build_case('M', [Son])
        self.client.force_login(self.calc.user)

    def test_heir_create_and_update_keep_existing_behavior(self):
        with mock.patch('calc.views.lock_calculation', wraps=views.lock_calculation) as lock:
            response = self.client.post(reverse('calc:mother', args=[self.calc.pk]),
                                        {'first_name': 'Mother', 'last_name': 'Family'}, secure=True)
            self.assertEqual(response.status_code, 302)
            lock.assert_called_once_with(self.calc.pk)
        self.assertTrue(Mother.objects.filter(calc=self.calc, first_name='Mother').exists())
        self.calc.compute()
        before = stored(self.heirs[0])
        with mock.patch('calc.views.lock_calculation', wraps=views.lock_calculation) as lock:
            response = self.client.post(reverse('calc:heir_update', args=[before.pk]),
                                        {'first_name': 'Renamed', 'last_name': 'Family'}, secure=True)
            self.assertEqual(response.status_code, 302)
            lock.assert_called_once_with(self.calc.pk)
        after = stored(before)
        self.assertEqual(after.first_name, 'Renamed')
        for field in before._meta.concrete_fields:
            if field.name not in {'first_name', 'last_name'}:
                self.assertEqual(getattr(before, field.attname), getattr(after, field.attname))

    def test_results_return_404_if_case_vanished_at_compute(self):
        for route in ('results', 'new_results'):
            with self.subTest(route=route), override_flag('new_results', active=True):
                with mock.patch.object(Calculation, 'compute', side_effect=Calculation.DoesNotExist):
                    response = self.client.get(reverse('calc:' + route, args=[self.calc.pk]), secure=True)
                self.assertEqual(response.status_code, 404)

    def test_every_person_write_view_posts_under_the_case_lock(self):
        writers = [view for view in vars(views).values()
                   if isinstance(view, type) and issubclass(view, (views.CreateView, views.UpdateView, views.DeleteView))
                   and isinstance(view.model, type) and issubclass(view.model, (Heir, Deceased))]
        self.assertEqual(len(writers), 27)  # 22 heir creates, HeirUpdate, HeirDelete, 3 deceased views
        for view in writers:
            with self.subTest(view=view.__name__):
                self.assertIs(view.post, views.CalculationLockMixin.post)

    def test_lock_on_a_deleted_case_gives_404(self):
        pk = self.calc.pk
        Calculation.objects.filter(pk=pk).delete()
        with self.assertRaises(views.Http404), transaction.atomic():
            views.lock_calculation(pk)

    def test_non_owner_person_posts_never_lock(self):
        self.client.force_login(User.objects.create(username='other-owner'))
        deceased = self.calc.deceased_set.get()
        for route, pk in [('heir_update', self.heirs[0].pk), ('heir_delete', self.heirs[0].pk),
                          ('mother', self.calc.pk), ('deceased', self.calc.pk),
                          ('deceased_update', deceased.pk), ('deceased_delete', deceased.pk)]:
            with self.subTest(route=route), mock.patch('calc.views.lock_calculation') as lock:
                response = self.client.post(reverse('calc:' + route, args=[pk]), {}, secure=True)
                self.assertEqual(response.status_code, 404)
                lock.assert_not_called()

class LayeredResultsViewTests(TestCase):
    def setUp(self):
        self.root, root_heirs = build_case('M', [Wife, Son, Son])
        self.layer, layer_heirs = build_layer(
            self.root, root_heirs[1], 'M', [Mother, Brother],
            [(0, root_heirs[0]), (1, root_heirs[2])])
        self.heirs = root_heirs + layer_heirs
        self.client.force_login(self.root.user)

    def test_owner_results_refuse_root_and_layer_without_changing_heirs(self):
        before = [stored(heir) for heir in self.heirs]
        for route in ('results', 'new_results'):
            for calc in (self.root, self.layer):
                with self.subTest(route=route, case=calc.pk), override_flag('new_results', active=True):
                    with translation.override('en'):
                        response = self.client.get(reverse('calc:' + route, args=[calc.pk]), secure=True)
                    self.assertEqual(response.status_code, 200)
                    self.assertTemplateUsed(response, 'calc/error.html')
                    self.assertContains(response, 'This successive inheritance case is not supported')
                    for original in before:
                        after = stored(original)
                        for field in original._meta.concrete_fields:
                            self.assertEqual(getattr(original, field.attname), getattr(after, field.attname))

    def test_non_owner_layered_results_return_404_without_compute(self):
        self.client.force_login(User.objects.create(username='other-owner'))
        for route in ('results', 'new_results'):
            with self.subTest(route=route), override_flag('new_results', active=True):
                with mock.patch.object(Calculation, 'compute') as compute:
                    response = self.client.get(reverse('calc:' + route, args=[self.root.pk]), secure=True)
                self.assertEqual(response.status_code, 404)
                compute.assert_not_called()

    def test_results_show_other_engine_refusals(self):
        refusal = schools.UnsupportedCase(schools.SCHOOL_NOT_SUPPORTED)
        for route in ('results', 'new_results'):
            with self.subTest(route=route), override_flag('new_results', active=True):
                with translation.override('en'), mock.patch.object(Calculation, 'compute', side_effect=refusal):
                    response = self.client.get(reverse('calc:' + route, args=[self.root.pk]), secure=True)
                    self.assertContains(response, refusal.message)
                self.assertTemplateUsed(response, 'calc/error.html')


# Successive inheritance fixtures keep person identity explicit across layers.
def build_layer(parent, earlier, sex, heir_types, links=(), order=2):
    calc, heirs = build_case(sex, heir_types, estate=999999)
    calc.parent = parent
    calc.save()
    death = calc.deceased_set.get()
    death.heir = earlier
    death.death_order = order
    death.save()
    for index, person in links:
        heirs[index].same_person = person
        heirs[index].save()
    return calc, heirs


class ManasikhatTests(TestCase):
    def run_layered(self, calc, school):
        from .manasikhat import compute_manasikhat
        return compute_manasikhat(calc, school)

    def fixture(self, third=False, reverse=False):
        root, heirs = build_case('M', [Son, Son, Wife] if reverse else [Wife, Son, Son], estate=101)
        w, s1, s2 = (heirs[2], heirs[0], heirs[1]) if reverse else heirs
        second, later = build_layer(root, s1, 'M', [Mother, Brother], [(0, w), (1, s2)])
        if third:
            last, newest = build_layer(second, w, 'F', [Son, Mother], [(0, later[1])], order=3)
            return root, (w, s1, s2, newest[1]), (second, last)
        return root, (w, s1, s2), (second,)

    def test_matrix_and_determinism(self):
        import time
        for school in schools.SUNNI:
            for third in (False, True):
                with self.subTest(school=school, third=third):
                    root, people, layers = self.fixture(third)
                    start = time.perf_counter()
                    final, evidence = self.run_layered(root, school)
                    if third:
                        self.assertLess(time.perf_counter() - start, 1)
                        expected = {people[2].pk: F(275, 288), people[3].pk: F(13, 288)}
                    else:
                        expected = {people[0].pk: F(13, 48), people[2].pk: F(35, 48)}
                    self.assertEqual([layer['heir'] for layer in evidence['layers']],
                                     [None, people[1].pk] + ([people[0].pk] if third else []))
                    expected_people = []
                    for row in Heir.objects.filter(calc__in=layers).order_by('pk'):
                        if row.same_person_id is not None:
                            person = row.same_person
                            while person.same_person_id is not None:
                                person = person.same_person
                            expected_people.append({'row': row.pk, 'person': person.pk})
                    self.assertEqual(evidence['people'], expected_people)
                    self.assertEqual(final, expected)
                    self.assertEqual(sum(final.values()), 1)
                    self.assertEqual(evidence['base'], 288 if third else 48)
                    self.assertTrue(all((v * evidence['base']).denominator == 1 for v in final.values()))
                    self.assertEqual((final, evidence), self.run_layered(root, school))
                    self.assertEqual(evidence['layers'][1]['estate'], {'numerator': 7, 'denominator': 16})

    def test_sibling_layers(self):
        for school in schools.SUNNI:
            with self.subTest(school=school):
                root, (w, s1, s2) = build_case('M', [Wife, Son, Son])
                build_layer(root, s1, 'M', [Mother, Brother], [(0, w), (1, s2)])
                _, (_, uncle) = build_layer(root, s2, 'M', [Mother, Uncle], [(0, w)], order=3)
                final, evidence = self.run_layered(root, school)
                self.assertEqual(final, {w.pk: F(37, 72), uncle.pk: F(35, 72)})
                self.assertEqual(evidence['base'], 72)

    def test_school_difference(self):
        for school in schools.SUNNI:
            root, (h, s1, s2) = build_case('F', [Husband, Son, Son])
            second, (_, pgm, _) = build_layer(root, s1, 'M', [Father, GrandMother, Brother], [(0, h), (2, s2)])
            final, evidence = self.run_layered(root, school)
            hanbali = school == schools.HANBALI
            self.assertEqual(final, {h.pk: F(9,16) if hanbali else F(5,8),
                                     pgm.pk: F(1,16) if hanbali else F(0), s2.pk: F(3,8)})
            self.assertIn(schools.GRANDMOTHER_INHERITS_WITH_HER_SON if hanbali else schools.FATHER_BLOCKS_HIS_MOTHER,
                          evidence['layers'][1]['proof']['school_rules'])

    def test_plain_compute_and_jafari(self):
        root, _, (second, third) = self.fixture(True)
        for call, reason in [(lambda: root.compute(), schools.MANASIKHAT_UNSUPPORTED),
                             (lambda: second.compute(), schools.MANASIKHAT_UNSUPPORTED),
                             (lambda: third.compute(), schools.MANASIKHAT_UNSUPPORTED),
                             (lambda: self.run_layered(root, schools.JAFARI), schools.SCHOOL_NOT_SUPPORTED)]:
            with self.assertRaises(schools.UnsupportedCase) as error:
                call()
            self.assertEqual(error.exception.reason, reason)

    def test_refusal_rolls_back_earlier_layer(self):
        root, (w, daughter) = build_case('M', [Wife, Daughter])
        build_layer(root, daughter, 'F', [Husband, Mother, GrandFather, MaternalBrother, MaternalBrother, PaternalBrother])
        before = list(Heir.objects.non_polymorphic().values())
        before_calcs = list(Calculation.objects.values())
        with self.assertRaises(schools.UnsupportedCase) as error:
            self.run_layered(root, schools.MALIKI)
        self.assertEqual(error.exception.reason, schools.MALIKIYYA_DISPUTED)
        self.assertEqual(before, list(Heir.objects.non_polymorphic().values()))
        self.assertEqual(before_calcs, list(Calculation.objects.values()))

    def test_invalid_topology(self):
        for invalid in ('four', 'duplicate_order', 'dead_heir', 'cycle', 'external', 'duplicate_person', 'bad_order', 'bad_death', 'parent_cycle', 'gap_order', 'death_sex', 'person_sex', 'external_heir'):
            with self.subTest(invalid=invalid):
                root, (w, s1, s2, m), (second, third) = self.fixture(True)
                if invalid == 'gap_order':
                    third.delete()
                    second.deceased_set.update(death_order=3)
                elif invalid == 'death_sex':
                    second.deceased_set.update(sex='F')
                elif invalid == 'person_sex':
                    Heir.objects.filter(calc=second, same_person=w).update(sex='M')
                elif invalid == 'external_heir':
                    other, (outsider,) = build_case('M', [Son])
                    outsider.same_person = s2
                    outsider.save()
                elif invalid == 'four':
                    build_layer(third, m, 'F', [Son], order=4)
                elif invalid in ('duplicate_order', 'bad_order'):
                    third.deceased_set.update(death_order=2 if invalid == 'duplicate_order' else 0)
                elif invalid == 'dead_heir':
                    heir = third.heir_set.first(); heir.same_person = s1; heir.save()
                elif invalid == 'cycle':
                    w.same_person = second.heir_set.get(same_person=w); w.save()
                elif invalid == 'external':
                    other, (outsider,) = build_case('M', [Son]); w.same_person = outsider; w.save()
                elif invalid == 'duplicate_person':
                    second.heir_set.update(same_person=w)
                elif invalid == 'bad_death':
                    second.deceased_set.update(heir=m)
                else:
                    root.parent = third; root.save()
                before = list(Heir.objects.non_polymorphic().values())
                with self.assertRaises(schools.UnsupportedCase) as error:
                    self.run_layered(root, schools.HANBALI)
                self.assertEqual(error.exception.reason, schools.MANASIKHAT_UNSUPPORTED)
                self.assertEqual(before, list(Heir.objects.non_polymorphic().values()))

    def test_cascade(self):
        root, people, layers = self.fixture(True)
        ids = [root.pk] + [c.pk for c in layers]
        heir_ids = list(Heir.objects.filter(calc_id__in=ids).values_list('pk', flat=True))
        root.delete()
        self.assertFalse(Calculation.objects.filter(pk__in=ids).exists())
        self.assertFalse(Heir.objects.filter(pk__in=heir_ids).exists())
        self.assertFalse(Deceased.objects.filter(calc_id__in=ids).exists())

    def test_unallocated_conservation(self):
        root, (w, s) = build_case('M', [Wife, Son])
        build_layer(root, s, 'M', [Wife])
        final, evidence = self.run_layered(root, schools.HANBALI)
        remainder = F(0)
        for layer in evidence['layers']:
            for step in layer['proof']['steps']:
                if step['step'] == 'unallocated':
                    amount = step['value']; estate = layer['estate']
                    remainder += F(amount['numerator'], amount['denominator']) * F(estate['numerator'], estate['denominator'])
        self.assertEqual(sum(final.values()) + remainder, 1)

    def test_creation_order(self):
        # References necessarily differ across new cases; compare after remapping
        # their database identities to the fixture's semantic person names.
        def normalized(reverse):
            root, people, layers = self.fixture(True, reverse)
            result, evidence = self.run_layered(root, schools.HANBALI)
            mapping = {p.pk: name for p, name in zip(people, ('W', 'S1', 'S2', 'M'))}
            mapping.update({h.pk: ('W' if isinstance(h, Mother) else 'S2') for h in layers[0].heir_set.all()})
            mapping.update({h.pk: ('M' if isinstance(h, Mother) else 'S2') for h in layers[1].heir_set.all()})
            for layer in evidence['layers']:
                layer['heir'] = mapping[layer['heir']] if layer['heir'] is not None else None
                layer['deceased'] = layer['order']
                for h in layer['proof']['heirs']:
                    h['heir'] = mapping[h['heir']]
                layer['proof']['heirs'].sort(key=lambda h: h['heir'])
            for entry in evidence['people']:
                entry['row'] = mapping[entry['row']]
                entry['person'] = mapping[entry['person']]
            evidence['people'].sort(key=lambda e: (e['row'], e['person']))
            for entry in evidence['final']:
                entry['heir'] = mapping[entry['heir']]
            evidence['final'].sort(key=lambda e: e['heir'])
            return {mapping[pk]: value for pk, value in result.items()}, evidence
        self.assertEqual(normalized(False), normalized(True))

    def test_layered_reason_is_separate_and_translated(self):
        self.assertNotIn(schools.MANASIKHAT_UNSUPPORTED, schools.REASONS)
        texts = []
        for language in ('ar', 'en', 'fr'):
            with translation.override(language):
                texts.append(schools.UnsupportedCase(schools.MANASIKHAT_UNSUPPORTED).message)
        self.assertEqual(len(set(texts)), 3)
        self.assertTrue(all('?' not in text for text in texts))

    def test_explicit_school_and_zero_inherited_estate(self):
        from .manasikhat import compute_manasikhat
        root, (father, brother) = build_case('M', [Father, Brother])
        second, (son,) = build_layer(root, brother, 'M', [Son])
        with self.assertRaises(TypeError):
            compute_manasikhat(root)
        final, evidence = compute_manasikhat(root, schools.HANBALI)
        self.assertEqual(final, {father.pk: F(1), son.pk: F(0)})
        self.assertEqual(evidence['layers'][1]['estate'], {'numerator': 0, 'denominator': 1})
