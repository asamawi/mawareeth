from django.db import models
from polymorphic.models import PolymorphicModel
from polymorphic.managers import PolymorphicManager
from django.urls import reverse
from django.utils.translation import gettext as _
from polymorphic.managers import PolymorphicManager, PolymorphicQuerySet
from fractions import Fraction
from functools import reduce
import math
from django.db.models import Count



from django.contrib.auth.models import User
def NON_POLYMORPHIC_CASCADE(collector, field, sub_objs, using):
    return models.CASCADE(collector, field, sub_objs.non_polymorphic(), using)

class CascadeDeletePolymorphicQuerySet(PolymorphicQuerySet):
    """
    Patch the QuerySet to call delete on the non_polymorphic QuerySet, avoiding models.deletion.Collector typing problem

    Based on workarounds proposed in: https://github.com/django-polymorphic/django-polymorphic/issues/229
    See also: https://github.com/django-polymorphic/django-polymorphic/issues/34,
              https://github.com/django-polymorphic/django-polymorphic/issues/84
    Related Django ticket: https://code.djangoproject.com/ticket/23076
    """
    def delete(self):
        if not self.polymorphic_disabled:
            return self.non_polymorphic().delete()
        else:
            return super().delete()


class CascadeDeletePolymorphicManager(PolymorphicManager):
    queryset_class = CascadeDeletePolymorphicQuerySet

class Person(PolymorphicModel):
    non_polymorphic = CascadeDeletePolymorphicManager()

    class Meta:
        base_manager_name = 'non_polymorphic'
    """Person Class"""
    GENDER_CHOICES = (
        ('M', 'Male'),
        ('F', 'Female'),
    )
    sex = models.CharField(max_length=1, choices=GENDER_CHOICES,null=False,blank=True)
    first_name = models.CharField(max_length=200,blank=True)
    last_name = models.CharField(max_length=200,blank=True)
    parents = models.ForeignKey('Marriage',null=True, on_delete=models.SET_NULL, blank=True)

    def add_father(self, father):
        if self.parents and self.parents.male:
            raise _("father already exist")
        else:
            #check for parents
            if self.parents is None:
                self.parents = Marriage.objects.create()

            self.parents.add_male(father)
            self.save()

            return father
    def add_mother(self, mother):
        if self.parents and self.parents.female:
            raise _("Mother already exist")
        else:
            #check for parents
            if self.parents is None:
                self.parents = Marriage.objects.create()

            self.parents.add_female(mother)
            self.save()
            return mother

    def add_husband(self, husband):
        #check for existing marriages
        if self.male.count() == 0:
            m = Marriage.objects.create()
            m.add_male(husband)
            m.add_female(self)
            return m
        else:
             raise _("Husband already exist")

    def add_wife(self, wife):
        #check for existing marriages
        if self.female.count() < 4:
            m = Marriage.objects.create()
            m.add_male(self)
            m.add_female(wife)
            return m
        else:
            raise _("Cann't have more than 4 wifes")

    def add_daughter(self, daughter, mother, father):

        #check if person is a male
        if self.sex == 'M':
            #check for marriages
            if self.male.count() != 0:
                daughter.parents=Marriage.objects.get(male=self, female=mother)
            else:
                daughter.parents=Marriage.objects.create()
                daughter.parents.add_male(self)
                daughter.parents.add_female(mother)

        elif self.sex == 'F':
            if self.female.count() != 0:
                daughter.parents=Marriage.objects.get(female=self, male=father)
            else:
                daughter.parents=Marriage.objects.create()
                daughter.parents.add_male(father)
                daughter.parents.add_female(self)

    def add_son(self, son, mother, father):

        #check if person is a male
        if self.sex == 'M':
            #check for marriages
            if self.male.count() != 0:
                son.parents=Marriage.objects.get(male=self, female=mother)
            else:
                son.parents=Marriage.objects.create()
                son.parents.add_male(self)
                son.parents.add_female(mother)

        elif self.sex == 'F':
            if self.female.count() != 0:
                son.parents=Marriage.objects.get(female=self, male=father)
            else:
                son.parents=Marriage.objects.create()
                son.parents.add_male(father)
                son.parents.add_female(self)

    def __str__(self):
        return f"{self.first_name} id: {self.id}"

class Marriage(models.Model):
    """Marriage Class"""
    male = models.ForeignKey(Person,null=True, on_delete=models.CASCADE,related_name='male',blank=True)
    female = models.ForeignKey(Person,null=True, on_delete=models.CASCADE,related_name='female',blank=True)

    def add_male(self, person):
        self.male = person
        self.save()

    def add_female(self, person):
        self.female = person
        self.save()

    def __str__(self):
        return "id: " + str(self.id) + " " +(self.male.first_name if self.male  else "") + " " + (self.female.first_name if self.female else "")


class Calculation(models.Model):
    """Calculation for bequest class"""
    shares = models.IntegerField(default=0)      # LCM for all prescribed shares
    excess = models.BooleanField(default=False)       # if prescribed shares is greater than gcm
    shortage = models.BooleanField(default=False)
    correction = models.BooleanField(default=False)  # shares and heirs number division should give no fractions
    shares_excess = models.IntegerField(default=0)
    shares_corrected = models.IntegerField(default=0)
    shares_shorted = models.IntegerField(default=0)

    user = models.ForeignKey(User,on_delete=models.CASCADE,null=True)
    name = models.CharField(max_length=200)

    def add_father(self, father):
        return Father().add(calc=self, father=father)

    def add_mother(self, mother):
        return Mother().add(calc=self, mother=mother)

    def add_husband(self, husband):
        return Husband().add(calc=self, husband=husband)

    def add_wife(self, wife):
        return Wife().add(calc=self, wife=wife)

    def add_daughter(self, daughter, mother, father):
        return Daughter().add(calc=self, daughter=daughter,mother=mother, father=father)

    def add_son(self, son, mother, father):
        return Son().add(calc=self, son=son, mother=mother, father=father)

    def __str__(self):
        return str(self.name)

    def get_quotes(self):
        for heir in self.heir_set.all():
            heir.get_quote(self)

    def lcm(self, a, b):
        return abs(a*b) // math.gcd(a, b)

    def lcm_list(self, list):
        return reduce(lambda a, b : self.lcm(a, b), list)

    def has_descendent(self):
        return self.heir_set.instance_of(Son).count() > 0 or self.heir_set.instance_of(Daughter).count() > 0 or self.heir_set.instance_of(SonOfSon).count() > 0 or self.heir_set.instance_of(DaughterOfSon).count() > 0

    def has_male_descendent(self):
        return self.heir_set.instance_of(Son).count() > 0 or self.heir_set.instance_of(SonOfSon).count() > 0

    def has_female_descendent(self):
        return self.heir_set.instance_of(Daughter).count() > 0 or self.heir_set.instance_of(DaughterOfSon).count() > 0

    def has_siblings(self):
        return self.heir_set.instance_of(Brother).count() + self.heir_set.instance_of(PaternalHalfBrother).count() + self.heir_set.instance_of(MaternalHalfBrother).count() + self.heir_set.instance_of(Sister).count() + self.heir_set.instance_of(PaternalHalfSister).count() + self.heir_set.instance_of(MaternalHalfSister).count() > 1

    def has_spouse(self):
        if self.deceased_set.first().sex == 'M':
            return self.heir_set.instance_of(Wife).count() > 0
        else:
            return self.heir_set.instance_of(Husband).count() > 0
    def has_asaba(self):
        return self.heir_set.filter(asaba=True).count() > 0

    def has_father(self):
        return self.heir_set.instance_of(Father).count() > 0

    def has_son(self):
        return self.heir_set.instance_of(Son).count() > 0

    def get_father(self):
        return self.heir_set.instance_of(Father).first()

    def get_mother(self):
        return self.heir_set.instance_of(Mother).first()

    def get_husband(self):
        return self.heir_set.instance_of(Husband).first()

    def get_wives(self):
        return self.heir_set.instance_of(Wife)

    def get_daughters(self):
        return self.heir_set.instance_of(Daughter)

    def get_sons(self):
        return self.heir_set.instance_of(Son)

    def get_fractions(self, heirs):
        fractions = set()
        for heir in heirs:
            fractions.add(heir.get_fraction())
        return fractions

    def set_calc_shares(self):
        count = self.heir_set.all().count()
        #if all are asaba (agnates)
        if self.heir_set.filter(asaba=True).count() == count:
            males = self.heir_set.filter(sex='M').count()
            females = self.heir_set.filter(sex='F').count()
            #if all same gender
            if   males == count or females  == count:
                self.shares = count
            else:
                for heir in self.heir_set.all():
                    self.shares = males * 2 + females
        else:
            denom_list = []
            fractions_set = self.get_fractions(self.heir_set.all())
            for fraction in fractions_set:
                denom_list.append(fraction.denominator)
            self.shares = self.lcm_list(denom_list)
        self.save()
        return self.shares
    def get_shares(self):
        shares = 0
        for  heir in self.heir_set.filter(correction=False):
            shares = shares + heir.share
        if self.correction == True:
            correction_set = self.heir_set.filter(correction=True).values('polymorphic_ctype_id','share').annotate(total=Count('id'))
            for result in correction_set:
                shares = shares + result["share"]


        if shares > self.shares:
            self.excess = True
            self.shares_excess = shares
            self.save()
            return self.shares_excess
        else:
            self.excess = False
            self.shares_excess = 0
            self.save()
        return shares

    def set_shares(self):
        for heir in self.heir_set.all():
            heir.set_share(self)

    def set_calc_correction(self):
        if self.correction == True:
            shares = 0
            if self.excess == True:
                shares = self.shares_excess
            else:
                shares = self.shares
            correction_set = self.heir_set.filter(correction=True).values('polymorphic_ctype_id','quote').annotate(total=Count('id'))
            if correction_set.count() == 1:
                heir_share = self.heir_set.filter(correction=True).first().share
                count = self.heir_set.filter(correction=True).count()
                if count % heir_share == 0:
                    self.shares_corrected = math.gcd(count, heir_share) * shares
                else:
                    self.shares_corrected = count * shares
            elif correction_set.count() > 1:
                factors = set()
                for result in correction_set:
                    heir_share = Fraction(result["quote"]).limit_denominator().numerator
                    count = result["total"]
                    if heir_share != 0:
                        if heir_share % count == 0:
                            factors.add(math.gcd(count, heir_share))
                        else:
                            factors.add(count)
                self.shares_corrected = reduce((lambda x, y: x * y), factors) * shares
            self.save()
            return self.shares_corrected


    def get_corrected_shares(self):
        if self.correction == True and self.shares_corrected != 0:
            shares = 0
            for  heir in self.heir_set.all():
                shares = shares + heir.get_corrected_share(self)
            return shares
    def set_calc_shortage(self):
        if self.shortage == True:
            if self.has_spouse() == False:
                self.shares_shorted = shares
                self.save()
            elif self.has_spouse() == True:
                if self.deceased_set.first().sex == 'M':
                    shares = self.get_wives().first().set_share()
                else:
                    shares = self.get_husband().set_share()
                heirs = self.get_heirs_no_spouse()
                denom_list = []
                fractions_set = self.get_fractions(heirs)
                for fraction in fractions_set:
                    denom_list.append(fraction.denominator)
                heirs_shares = self.lcm_list(denom_list)
                if remainder % heirs_shares == 0:
                    self.shares_shorted = math.gcd(remainder, heirs_shares) * shares
                else:
                    self.shares_shorted = remainder * shares
                self.save()
    def set_asaba_quotes(self):

        #check for asaba exclude father with quote
        asaba = self.heir_set.filter(asaba=True).exclude(quote__gt=0)
        count = asaba.count()
        # if no asaba then we have resedual shares to be redistributed
        if count == 0:
            pass
        for heir in asaba:
            heir.set_asaba_quote(self)
    def set_amounts(self):
        for heir in self.heir_set.all():
            heir.set_amount(self)
    def compute(self):
        self.get_quotes()
        self.set_calc_shares()
        self.set_shares()
        self.set_asaba_quotes()
        self.set_calc_correction()
        self.get_corrected_shares()
        self.set_amounts()

class Deceased(Person):
    """Deceased class"""
    estate = models.IntegerField()
    calc = models.ForeignKey(Calculation, on_delete=NON_POLYMORPHIC_CASCADE,null=True)
    def get_absolute_url(self):
        return reverse('calc:detail', args=[self.calc.id])
class Heir(Person):
    """Heir class"""
    quote = models.DecimalField(max_digits=11, decimal_places=10, default=0)  #prescribed share
    shared_quote = models.BooleanField(default=False)    #prescribed share is shared with other heir like 2 daughters
    share = models.IntegerField(default=0)
    corrected_share = models.IntegerField(default=0)
    amount = models.IntegerField(default=0)
    asaba = models.BooleanField(default=False)           #agnate or residuary
    blocked = models.BooleanField(default=False)         # restrcited from inheritance
    quote_reason = models.CharField(max_length=255, default="")
    correction = models.BooleanField(default=False)
    abstract = True
    calc = models.ForeignKey(Calculation, on_delete=NON_POLYMORPHIC_CASCADE,null=True)
    def get_absolute_url(self):
        return reverse('calc:detail', args=[self.calc.id])
    def __str__(self):
        return (self.first_name if self.first_name else " ")
    def get_quote(self, calc):
        pass
    def set_share(self, calc):
        if self.quote != 0 :
            share = calc.shares * self.get_fraction().numerator // self.get_fraction().denominator
            if self.shared_quote == True:
                count = calc.heir_set.filter(polymorphic_ctype_id=self.polymorphic_ctype_id).count()
                if share % count == 0:
                    self.share = share // count
                    self.save()
                else:
                    self.correction=True
                    calc.correction=True
                    self.share = share
                    self.save()
                    calc.save()
            else:
                self.share=share
                self.save()
            return self.share
        else:
            return 0

    def set_asaba_quote(self, calc):
        shares = calc.get_shares()
        remainder = calc.shares - shares
        if self.quote == 0:
            if remainder > 0 and shares > 0:
                quote = remainder / calc.shares
                #check for correction
                if self.shared_quote == True:
                    count = calc.heir_set.filter(asaba=True).count()
                    males = calc.heir_set.filter(asaba=True, sex='M').count()
                    females = calc.heir_set.filter(asaba=True, sex='F').count()
                    if remainder % count == 0:
                        if males == count or females == count or remainder % (males*2+females) == 0:
                            self.correction = False
                            self.share = remainder / count
                        else:
                            self.correction = True
                    else:
                        self.correction = True

                self.quote = quote
                self.quote_reason = _("residuary for asaba")
                self.save()

    def get_corrected_share(self, calc):
        if calc.correction==True and calc.shares_corrected != 0:
            if calc.excess == True:
                multiplier = calc.shares_corrected // calc.shares_excess
            else:
                multiplier = calc.shares_corrected // calc.shares

            if self.shared_quote == True:
                self.corrected_share = self.share
                self.save()
            else:
                self.corrected_share = self.share * multiplier
                self.save()
        return self.corrected_share

    def set_amount(self, calc):
        estate = calc.deceased_set.first().estate
        amount = 0
        if calc.correction == False:
            if calc.excess == False:
                amount = estate / calc.shares * self.share
            else:
                amount = estate / calc.shares_excess * self.share
        else:
            amount = estate / calc.shares_corrected * self.corrected_share
        self.amount = amount
        self.save()
    def get_fraction(self):
        return Fraction(self.quote).limit_denominator()

class Father(Heir):
    """Father class"""
    def add(self, calc, father):
        calc.deceased_set.first().add_father(father=father)
    def get_quote(self, calc):
        if calc.has_male_descendent():
            self.quote = 1/6
            self.quote_reason = _("father gets 1/6 prescribed share because of male decendent")
        elif calc.has_female_descendent():
            self.quote = 1/6
            self.asaba = True
            self.quote_reason = _("father gets 1/6 plus remainder because of female decendent")
        else:
            self.asaba = True
            self.quote_reason = _("father gets the remainder because there is no decendent")
        self.save()
        return self.quote


class Mother(Heir):
    """Mother class"""
    def add(self, calc, mother):
        calc.deceased_set.first().add_mother(mother=mother)

    def get_quote(self, calc):
        if calc.has_descendent() or calc.has_siblings():
            self.quote = 1/6
            self.quote_reason = _("mother gets 1/6 becasue of decendent or siblings")
        elif calc.has_spouse() and calc.has_father():
            if calc.deceased_set.first().sex == 'M':
                self.quote = 1/4
                self.quote_reason = _("mother gets 1/3 of the remainder which is 1/4.")
            else:
                self.quote = 1/6
                self.quote_reason = _("mother gets 1/3 of the remainder which is 1/6")
        self.save()
        return self.quote



class Husband(Heir):
    """Husbnad class"""
    def add(self, calc, husband):
        calc.deceased_set.first().add_husband(husband=husband)

    def get_quote(self, calc):
        if calc.has_descendent():
            self.quote = 1/4
            self.quote_reason = _("husband gets 1/4 becuase of decendent")
        else:
            self.quote = 1/2
            self.quote_reason = _("husband gets 1/2 becuase there is no decendent")
        self.save()
        return self.quote

class Wife(Heir):
    """Wife class"""
    def add(self, calc, wife):
        calc.deceased_set.first().add_wife(wife=wife)

    def get_quote(self, calc):
        if calc.heir_set.instance_of(Wife).count() == 1:
            if calc.has_descendent():
                self.quote = 1/8
                self.quote_reason = _("wife gets 1/8 becuase of decendent")
            else:
                self.quote = 1/4
                self.quote_reason = _("wife gets 1/4 becuase there is no decendent")
        else:
            if calc.has_descendent():
                self.quote = 1/8
                self.quote_reason = _("wives share the qoute of 1/8 becuase of decendent")
            else:
                self.quote = 1/4
                self.quote_reason = _("wives share the quote of 1/4 becuase there is no decendent")
            self.shared_quote = True
        self.save()
        return self.quote

class Daughter(Heir):
    """Daughter Class"""
    def add(self, calc, daughter, mother, father):
        calc.deceased_set.first().add_daughter(daughter=daughter, mother=mother, father=father)

    def get_quote(self, calc):
        if calc.has_son():
            self.asaba = True
            if calc.heir_set.instance_of(Daughter).count() > 1:
                self.shared_quote = True
        elif calc.heir_set.instance_of(Daughter).count() == 1:
            self.quote = 1/2
            self.quote_reason = _("Daughter gets 1/2 when she has no other sibling/s")
        else:
            self.quote = 2/3
            self.shared_quote = True
            self.quote_reason = _("Daughters share the quote of 2/3 when there is no son/s")
        self.save()
        return self.quote

class Son(Heir):
    """Son Class"""
    def add(self, calc, son, mother, father):
        calc.deceased_set.first().add_son(son=son, mother=mother, father=father)

    def get_quote(self, calc):
        if calc.heir_set.instance_of(Son).count() > 1:
            self.shared_quote = True
        self.asaba =  True
        self.quote_reason = _("Son/s share the remainder or all amount if no other heir exist")
        self.save()
        return self.quote

class Brother(Heir):
    pass

class Sister(Heir):
    pass

class GrandFather(Heir):
    pass

class GrandMother(Heir):
    pass

class SonOfSon(Heir):
    pass

class DaughterOfSon(Heir):
    pass

class PaternalHalfSister(Heir):
    pass

class PaternalHalfBrother(Heir):
    pass

class MaternalHalfSister(Heir):
    pass

class MaternalHalfBrother(Heir):
    pass
