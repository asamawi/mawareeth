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
