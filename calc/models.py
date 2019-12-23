from django.db import models

class Person(models.Model):
    """Person Class"""
    GENDER_CHOICES = (
        ('M', 'Male'),
        ('F', 'Female'),
    )
    sex = models.CharField(max_length=1, choices=GENDER_CHOICES)
    first_name = models.CharField()
    last_name = models.CharField()
    parents = models.ForeignKey(Marriage, on_delete=models.SET_NULL)

class Marriage (models.Model):
    husband = models.ForeignKey(Person, on_delete=models.SET_NULL)
    wife = models.ForeignKey(Person, on_delete=models.SET_NULL)





class Calculation (models.Model):
    """Calculation for bequest class"""
    deceased = Person()
    name = models.CharField()
    amount = models.IntegerField(default=1000)

    def __str__(self):
        return self.deceased

class Heir(Person):
    """Heir class"""

    calculation = models.ForeignKey(Calculation, on_delete=models.CASCADE)

    def __str__(self):
        return self.heir_name
