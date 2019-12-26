from django.db import models
from django.contrib.auth.models import User

class Person(models.Model):
    """Person Class"""
    GENDER_CHOICES = (
        ('M', 'Male'),
        ('F', 'Female'),
    )
    sex = models.CharField(max_length=1, choices=GENDER_CHOICES,null=False)
    first_name = models.CharField(max_length=200)
    last_name = models.CharField(max_length=200)
    parents = models.ForeignKey('Marriage',null=True, on_delete=models.SET_NULL, blank=True)

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

    def add_son(self, first_name = None, last_name = None, parents = None):

        #check for existing Marriage/s
        count = 0
        # for a female Person
        if self.sex =='F':
            m = Marriage.objects.filter(wife = self)
            count = m.count()
            if count == 0:
                m = Marriage(wife = self)
                m.save()
            elif count == 1:
                m = Marriage.objects.get(wife = self)

        # for a male Person
        elif self.sex =='M':
            m = Marriage.objects.filter(husband = self)
            count = m.count()
            if count == 0:
                m = Marriage(husband = self)
                m.save()
            elif count == 1:
                m = Marriage.objects.get(husband = self)

        # Person with no sex defined
        else:
            return "Person should be male or female"

        if count > 1:
            if parents is None:
                return "can't handle more than one Marriage, please provide Marriage"
            elif isinstance(parents, Marriage):
                m = parents


        if first_name is None:
            first_name = self.first_name+" Son"
        if last_name is None:
            last_name = self.last_name
        son = Person(sex='M', first_name=first_name ,last_name=last_name)
        son.parents = m
        son.save()
        return son

    def add_spouse(self,first_name = None, last_name = None):

        if self.sex == 'M':
            if first_name is None:
                first_name = self.first_name+" wife"
            husband = self
            wife = Person(sex='F',first_name=first_name)
            wife.save()
        elif self.sex == 'F':
            if first_name is None:
                first_name = self.first_name+" husband"
            wife = self
            husband = Person(sex='M',first_name=first_name)
            husband.save()

        #create a Marriage
        m = Marriage(husband=husband, wife=wife)
        m.save()

        return m

    def add_brother(self,first_name = None, last_name = None):
        if self.parents is None:
            m = Marriage()
            m.save()
            self.parents = m
        if first_name is None:
            first_name = self.first_name+" brother"
        if last_name is None:
            last_name = self.last_name
        brother = Person(sex='M',first_name=first_name, last_name=last_name,parents=self.parents)
        brother.save()
        return brother



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
    user = models.ForeignKey(User,on_delete=models.CASCADE,null=True)
    deceased = models.ForeignKey(Person,null=True, on_delete=models.SET_NULL)
    name = models.CharField(max_length=200)
    amount = models.IntegerField(default=1000)

    _observers = []

    def attach(self, observer) -> None:
        """
        Attach an observer to the subject.
        """
        self._observers.append(observer)

    def add_father(self):
        self.deceased.add_father()
        self.add_father_heir()

    def add_mother(self):
        self.deceased.add_mother()
        self.add_mother_heir()

    def add_father_heir(self):
        father = Father(calc=self, person = self.deceased.parents.husband)
        father.save()
        self.attach(father)

    def add_mother_heir(self):
        mother = Mother(calc=self, person = self.deceased.parents.wife)
        mother.save()
        self.attach(mother)

    def add_deceased(self, d: Person):
        self.deceased = d

        #check for parents
        if d.parents:
            #check for Father
            if d.parents.husband:
                self.add_father_heir()
            #check for mother
            if d.parents.wife:
                self.add_mother()





    def __str__(self):
        return str(self.deceased)

class Heir(Person):
    """Heir class"""

    calc = models.ForeignKey(Calculation, on_delete=models.CASCADE)

    def calc(self) -> Calculation:
        return self.Calc

    def calc(self, calc: Calculation):
        self.calc= calc

    def add(self, calc: Calculation):
        pass

    def remove(self, calc: Calculation):
        pass

    def is_composite(self) ->bool:
        return False

    def __str__(self):
        return (self.first_name if self.first_name else " ")

class Father(Heir):
    def __init__(self, calc:Calculation = None, person:Person = None):
        super().__init__()
        self.calc = calc
        self.person = person
    person = models.ForeignKey(Person,null=True, on_delete=models.SET_NULL)

class Mother(Heir):
    def __init__(self, calc:Calculation = None, person:Person = None):
        super().__init__()
        self.calc = calc
        self.person = person
    person = models.ForeignKey(Person,null=True, on_delete=models.SET_NULL)
