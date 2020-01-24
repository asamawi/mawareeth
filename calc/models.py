from django.db import models
from polymorphic.models import PolymorphicModel
from polymorphic.managers import PolymorphicManager
from django.urls import reverse
from django.utils.translation import gettext as _
from polymorphic.managers import PolymorphicManager, PolymorphicQuerySet



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
        if self.female.count() == 0:
            m = Marriage.objects.create()
            m.add_male(husband)
            m.add_female(self)
            return m
        else:
             raise _("Husband already exist")

    def add_wife(self, wife):
        #check for existing marriages
        if self.male.count() < 4:
            m = Marriage.objects.create()
            m.add_male(self)
            m.add_female(wife)
            return m
        else:
            raise _("Cann't have more than 4 wifes")
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

    def __str__(self):
        return str(self.name)

class Deceased(Person):
    """Deceased class"""
    estate = models.IntegerField()
    calc = models.ForeignKey(Calculation, on_delete=NON_POLYMORPHIC_CASCADE,null=True)
    def get_absolute_url(self):
        return reverse('calc:detail', args=[self.calc.id])
class Heir(Person):
    """Heir class"""
    abstract = True
    calc = models.ForeignKey(Calculation, on_delete=NON_POLYMORPHIC_CASCADE,null=True)
    def get_absolute_url(self):
        return reverse('calc:detail', args=[self.calc.id])
    def __str__(self):
        return (self.first_name if self.first_name else " ")

class Father(Heir):
    """Father class"""
    def add(self, calc, father):
        calc.deceased_set.first().add_father(father=father)

class Mother(Heir):
    """Mother class"""
    def add(self, calc, mother):
        calc.deceased_set.first().add_mother(mother=mother)


class Husband(Heir):
    """Husbnad class"""
    def add(self, calc, husband):
        calc.deceased_set.first().add_husband(husband=husband)

class Wife(Heir):
    """Wife class"""
    def add(self, calc, wife):
        calc.deceased_set.first().add_wife(wife=wife)

class Daughter(Heir):
    pass

class Son(Heir):
    pass

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
