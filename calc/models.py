from django.db import models
from polymorphic.models import PolymorphicModel

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

    def add_male(self,person):
        self.male = person

    def __str__(self):
        return "id: " + str(self.id) + " " +(self.husband.first_name if self.husband  else "") + " " + (self.wife.first_name if self.wife else "")


class Calculation(models.Model):
    """Calculation for bequest class"""
    user = models.ForeignKey(User,on_delete=models.CASCADE,null=True)
    name = models.CharField(max_length=200)

    def __str__(self):
        return str(self.name)

class Deceased(Person):
    """Deceased class"""
    estate = models.IntegerField()
    calc = models.ForeignKey(Calculation, on_delete=models.CASCADE)

class Heir(Person):
    """Heir class"""
    abstract = True
    calc = models.ForeignKey(Calculation, on_delete=models.CASCADE)

    def __str__(self):
        return (self.first_name if self.first_name else " ")

class Father(Heir):
    pass

class Mother(Heir):
    pass

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
