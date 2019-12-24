from django.db import models

class Person(models.Model):
    """Person Class"""
    GENDER_CHOICES = (
        ('M', 'Male'),
        ('F', 'Female'),
    )
    sex = models.CharField(max_length=1, choices=GENDER_CHOICES)
    first_name = models.CharField(max_length=200)
    last_name = models.CharField(max_length=200)
    parents = models.ForeignKey('Marriage',null=True, on_delete=models.SET_NULL)

    def add_father(self, first_name = None, last_name = None):
        if self.parents and self.parents.husband:
            return "father already exist"
        else:
            if first_name is None:
                first_name = self.first_name+" Father"
            if last_name is None:
                last_name = self.last_name
            father = Person(sex = 'M', first_name=first_name ,last_name=last_name)
            father.save()

            #check for parents
            if self.parents is None:
                self.parents = Marriage(husband=father)
            else:
                self.parents.husband=father

            self.parents.save()
            return father

    def add_mother(self, first_name = None, last_name = None):
        if self.parents and self.parents.wife:
            return "Mother already exist"
        else:
            if first_name is None:
                first_name = self.first_name+" Mother"
            if last_name is None:
                last_name = self.last_name
            mother = Person(sex = 'F', first_name=first_name ,last_name=last_name)
            mother.save()

            #check for parents
            if self.parents is None:
                self.parents = Marriage(wife=mother)
            else:
                self.parents.wife = mother

            self.parents.save()
            return mother

    def __str__(self):
        return f"{self.first_name} id: {self.id}"

class Marriage(models.Model):
    """Marriage Class"""
    husband = models.ForeignKey(Person,null=True, on_delete=models.SET_NULL,related_name='husband')
    wife = models.ForeignKey(Person,null=True, on_delete=models.SET_NULL,related_name='wife')

    def __str__(self):
        return "id: " + str(self.id) + " " +(self.husband.first_name if self.husband  else "") + " " + (self.wife.first_name if self.wife else "")

class Calculation(models.Model):
    """Calculation for bequest class"""
    deceased = models.ForeignKey(Person,null=True, on_delete=models.SET_NULL)
    name = models.CharField(max_length=200)
    amount = models.IntegerField(default=1000)

    def __str__(self):
        return self.deceased

class Heir(Person):
    """Heir class"""

    calc= models.ForeignKey(Calculation, on_delete=models.CASCADE)

    def __str__(self):
        return self.heir_name
