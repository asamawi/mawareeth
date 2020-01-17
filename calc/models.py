from django.db import models
from polymorphic.models import PolymorphicModel
from polymorphic.managers import PolymorphicManager
from django.urls import reverse


from django.contrib.auth.models import User

class Person(PolymorphicModel):
    """Person Class"""
    GENDER_CHOICES = (
        ('M', 'Male'),
        ('F', 'Female'),
    )
    sex = models.CharField(max_length=1, choices=GENDER_CHOICES,null=False,blank=True)
    first_name = models.CharField(max_length=200,blank=True)
    last_name = models.CharField(max_length=200,blank=True)
    parents = models.ForeignKey('Marriage',null=True, on_delete=models.SET_NULL, blank=True)

    def add_father(self, person):

            if self.parents and self.parents.male:
                return "father already exist"
            else:

                #check for parents
                if self.parents is None:
                    self.parents = Marriage()

                self.parents.add_male(person)

                return person

    def __str__(self):
        return f"{self.first_name} id: {self.id}"

class Marriage(models.Model):
    """Marriage Class"""
    male = models.ForeignKey(Person,null=True, on_delete=models.SET_NULL,related_name='male',blank=True)
    female = models.ForeignKey(Person,null=True, on_delete=models.SET_NULL,related_name='female',blank=True)

    def add_male(self, person):
        self.male = person

    def __str__(self):
        return "id: " + str(self.id) + " " +(self.male.first_name if self.male  else "") + " " + (self.female.first_name if self.female else "")


class Calculation(models.Model):
    """Calculation for bequest class"""
    user = models.ForeignKey(User,on_delete=models.CASCADE,null=True)
    name = models.CharField(max_length=200)

    def add_father(self, first_name, last_name):
        return Father().add(calc=self, first_name=first_name, last_name=last_name)

    def add_mother(self, first_name, last_name):
        return Mother().add(calc=self, first_name=first_name, last_name=last_name)

    def __str__(self):
        return str(self.name)

class Deceased(Person):
    """Deceased class"""
    estate = models.IntegerField()
    calc = models.ForeignKey(Calculation, on_delete=models.CASCADE,null=True)
    def get_absolute_url(self):
        return reverse('calc:detail', args=[self.calc.id])
class Heir(Person):
    """Heir class"""
    abstract = True
    calc = models.ForeignKey(Calculation, on_delete=models.CASCADE,null=True)

    def __str__(self):
        return (self.first_name if self.first_name else " ")

class Father(Heir):

    def add(self, calc, first_name, last_name):
        f = Father.objects.create(calc=calc, first_name=first_name, last_name=last_name, sex="M")
        calc.deceased_set.first().add_father(f)



class Mother(Heir):
    def add(self, calc, first_name, last_name):
        calc.deceased_set.first().add_mother(self)


class Husband(Heir):
    pass

class Wife(Heir):
    pass

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
