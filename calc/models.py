from django.db import models

class Calculation (models.Model):
    """Calculation for bequest class"""
    deceased = models.CharField(max_length = 200)
    amount = models.IntegerField(default=1000)

    def __str__(self):
        return self.deceased

class Heir(models.Model):
    """Heir class"""

    heir_name = models.CharField(max_length = 200)
    calculation = models.ForeignKey(Calculation, on_delete=models.CASCADE)

    def __str__(self):
        return self.heir_name
