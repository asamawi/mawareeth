from django.db import models
from polymorphic.models import PolymorphicModel
from polymorphic.managers import PolymorphicManager
from django.urls import reverse
from django.utils.translation import gettext as _
from polymorphic.managers import PolymorphicManager, PolymorphicQuerySet
from fractions import Fraction



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
    exces = models.BooleanField(default=False)       # if prescribed shares is greater than gcm
    correction = models.BooleanField(default=False)  # shares and heirs number division should give no fractions
    shares_exces = models.IntegerField(default=0)
    shares_corrected = models.IntegerField(default=0)

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

    def lcm(a, b):
        return abs(a*b) // math.gcd(a, b)

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
    asaba = models.BooleanField(default=False)           #agnate or residuary
    blocked = models.BooleanField(default=False)         # restrcited from inheritance
    quote_reason = models.CharField(max_length=255, default="")
    abstract = True
    calc = models.ForeignKey(Calculation, on_delete=NON_POLYMORPHIC_CASCADE,null=True)
    def get_absolute_url(self):
        return reverse('calc:detail', args=[self.calc.id])
    def __str__(self):
        return (self.first_name if self.first_name else " ")
    def get_quote(self, calc):
        pass

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
