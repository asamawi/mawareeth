from django.db import models, transaction
from polymorphic.models import PolymorphicModel
from polymorphic.managers import PolymorphicManager
from django.urls import reverse
from django.utils.translation import gettext as _
from polymorphic.managers import PolymorphicManager, PolymorphicQuerySet
from fractions import Fraction
from decimal import Decimal
from functools import reduce
import math
from django.db.models import Count
from . import proof, schools
from .schools import UnsupportedCase



class _Group:
    """Heirs who share one amount of the estate: one fixed share, the residue, or a pool."""

    def __init__(self, key, amount, kind='fixed'):
        self.key = key
        self.kind = kind
        self.amount = Fraction(amount)
        self.stage = self.final = self.amount
        self.members = []
        self.weights = []
        # a pooled group's prescribed share of each member, for the scholars' table
        self.prescribed = {}

    def add(self, heir, weight=1):
        self.members.append(heir)
        self.weights.append(weight)

    def set_weights_by_sex(self):
        mixed = len({is_male(h) for h in self.members}) > 1
        self.weights = [2 if (mixed and is_male(h)) else 1 for h in self.members]

    def is_spouse(self):
        return isinstance(self.key, type) and issubclass(self.key, (Husband, Wife))

    def column(self, base, amount):
        """Each member's whole number of parts of `base`. When the group's
        parts do not divide, every member shows the group's total instead and
        the result is flagged as needing a correction."""
        total_weight = sum(self.weights)
        values = [amount * weight * base / total_weight for weight in self.weights]
        if all(value.denominator == 1 for value in values):
            return [int(value) for value in values], False
        return [round(amount * base)] * len(values), True


def is_male(heir):
    return isinstance(heir, MALE_HEIRS)


def money(value):
    """Round an exact amount half up to 2 decimals."""
    cents = math.floor(Fraction(value) * 100 + Fraction(1, 2))
    return Decimal(cents) / 100


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
        if self.male_marriages.count() == 0:
            m = Marriage.objects.create()
            m.add_male(husband)
            m.add_female(self)
            return m
        else:
             raise _("Husband already exist")

    def add_wife(self, wife):
        #check for existing marriages
        if self.female_marriages.count() < 4:
            m = Marriage.objects.create()
            m.add_male(self)
            m.add_female(wife)
            return m
        else:
            raise _("Can't have more than 4 wives")

    def add_daughter(self, daughter, mother, father):

        #check if person is a male
        if self.sex == 'M':
            #check for marriages
            if self.male_marriages.count() != 0:
                daughter.parents=Marriage.objects.filter(male=self, female=mother).first() or Marriage.objects.create(male=self, female=mother)
            else:
                daughter.parents=Marriage.objects.create()
                daughter.parents.add_male(self)
                daughter.parents.add_female(mother)

        elif self.sex == 'F':
            if self.female_marriages.count() != 0:
                daughter.parents=Marriage.objects.get(female=self, male=father)
            else:
                daughter.parents=Marriage.objects.create()
                daughter.parents.add_male(father)
                daughter.parents.add_female(self)

    def add_son(self, son, mother, father):

        #check if person is a male
        if self.sex == 'M':
            #check for marriages
            if self.male_marriages.count() != 0:
                son.parents=Marriage.objects.filter(male=self, female=mother).first() or Marriage.objects.create(male=self, female=mother)
            else:
                son.parents=Marriage.objects.create()
                son.parents.add_male(self)
                son.parents.add_female(mother)

        elif self.sex == 'F':
            if self.female_marriages.count() != 0:
                son.parents=Marriage.objects.get(female=self, male=father)
            else:
                son.parents=Marriage.objects.create()
                son.parents.add_male(father)
                son.parents.add_female(self)

    def add_brother(self, brother):
        brother.parents=self.parents
        brother.save()

    def add_sister(self, sister):
        sister.parents=self.parents
        sister.save()

    def add_grandFather(self, grandFather):
        if self.parents and self.parents.male:
            self.parents.male.add_father(grandFather)
        self.save()

        return grandFather

    def add_grandMother(self, grandMother):
        pass

    def add_sonOfSon(self, son):
        pass

    def add_daughterOfSon(self, daughter):
        pass

    def add_paternalSister(self, sister):
        pass

    def add_paternalBrother(self, brother):
        pass

    def add_maternalSister(self, sister):
        pass

    def add_maternalBrother(self, brother):
        pass

    def add_sonOfBrother(self, sonOfBrother):
        pass

    def add_sonOfPaternalBrother(self, sonOfPaternalBrother):
        pass

    def add_uncle(self, uncle):
        pass

    def add_paternalUncle(self, uncle):
        pass

    def add_sonOfUncle(self, sonOfUncle):
        pass

    def add_sonOfPaternalUncle(self, sonOfPaternalUncle):
        pass

    def __str__(self):
        return f"{self.first_name} id: {self.id}"

class Marriage(models.Model):
    """Marriage Class"""
    male = models.ForeignKey(Person,null=True, on_delete=models.CASCADE,related_name='male_marriages',blank=True)
    female = models.ForeignKey(Person,null=True, on_delete=models.CASCADE,related_name='female_marriages',blank=True)

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
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.CASCADE, related_name="layers")
    # The school of the run in progress. It is an input to compute() and is never stored.
    madhab = schools.DEFAULT
    # The proof of the last compute(); like the school it is transient and never stored.
    proof = None
    shares = models.IntegerField(default=0)      # LCM for all prescribed shares
    excess = models.BooleanField(default=False)       # if prescribed shares is greater than gcm
    shortage = models.BooleanField(default=False)
    residual_shares = models.IntegerField(default=0)
    correction = models.BooleanField(default=False)  # shares and heirs number division should give no fractions
    shortage_calc = models.BooleanField(default=False)
    shortage_calc_shares = models.IntegerField(default=0)
    shortage_union_shares = models.IntegerField(default=0)
    shares_excess = models.IntegerField(default=0)
    shares_corrected = models.IntegerField(default=0)
    shares_shorted = models.IntegerField(default=0)
    maternal_quote = models.BooleanField(default=False)
    common_quote = models.BooleanField(default=False) # siblings share quote with maternal siblings in case of no remainder

    user = models.ForeignKey(User,on_delete=models.CASCADE,null=True)
    name = models.CharField(max_length=200)

    def add_father(self, father):
        return father.add(calc=self)

    def add_mother(self, mother):
        return mother.add(calc=self)

    def add_husband(self, husband):
        return husband.add(calc=self)

    def add_wife(self, wife):
        return wife.add(calc=self)

    def add_daughter(self, daughter, mother, father):
        return daughter.add(calc=self, mother=mother, father=father)

    def add_son(self, son, mother, father):
        return son.add(calc=self, mother=mother, father=father)

    def add_brother(self, heir):
        heir.add(calc=self)
        heir.save()
        return heir

    def add_sister(self, heir):
        heir.add(calc=self)
        heir.save()
        return heir

    def add_grandFather(self, heir):
        heir.add(calc=self)
        heir.save()
        return heir

    def add_grandMother(self, heir):
        heir.add(calc=self)
        heir.save()
        return heir

    def add_sonOfSon(self, heir):
        heir.add(calc=self)
        heir.save()
        return heir

    def add_daughterOfSon(self, heir):
        heir.add(calc=self)
        heir.save()
        return heir

    def add_paternalSister(self, heir):
        heir.add(calc=self)
        heir.save()
        return heir

    def add_paternalBrother(self, heir):
        heir.add(calc=self)
        heir.save()
        return heir

    def add_maternalSister(self, heir):
        heir.add(calc=self)
        heir.save()
        return heir

    def add_maternalBrother(self, heir):
        heir.add(calc=self)
        heir.save()
        return heir

    def add_sonOfBrother(self, heir):
        heir.add(calc=self)
        heir.save()
        return heir

    def add_sonOfPaternalBrother(self, heir):
        heir.add(calc=self)
        heir.save()
        return heir

    def add_uncle(self, heir):
        heir.add(calc=self)
        heir.save()
        return heir

    def add_paternalUncle(self, heir):
        heir.add(calc=self)
        heir.save()
        return heir

    def add_sonOfUncle(self, heir):
        heir.add(calc=self)
        heir.save()
        return heir

    def add_sonOfPaternalUncle(self, heir):
        heir.add(calc=self)
        heir.save()
        return heir

    def __str__(self):
        return str(self.name)

    def get_quotes(self):
        """Classify every heir in a fixed fiqh order, so that no heir reads a
        flag another heir has not set yet. Returns the classified heirs."""
        heirs = sorted(self.heir_set.all(), key=lambda heir: (FIQH_ORDER.index(type(heir)) if type(heir) in FIQH_ORDER else len(FIQH_ORDER), heir.pk))
        for heir in heirs:
            heir.get_quote(self)
        return heirs

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
        return self.heir_set.instance_of(Brother).count() + self.heir_set.instance_of(PaternalBrother).count() + self.heir_set.instance_of(MaternalBrother).count() + self.heir_set.instance_of(Sister).count() + self.heir_set.instance_of(PaternalSister).count() + self.heir_set.instance_of(MaternalSister).count() > 1

    def has_spouse(self):
        return self.heir_set.instance_of(Wife, Husband).count() > 0

    def has_asaba(self):
        return self.heir_set.filter(asaba=True).count() > 0

    def has_father(self):
        return self.heir_set.instance_of(Father).count() > 0

    def has_grandFather(self):
        return self.heir_set.instance_of(GrandFather).count() > 0

    def grandmother_count(self):
        """How many grandmothers of either line the family has that are not blocked. The
        mother blocks both lines, and that case never reaches this count; the father blocks
        only his own mother, and only under the schools where he does."""
        count = self.heir_set.instance_of(MaternalGrandMother).count()
        if not (self.has_father() and schools.father_blocks_his_mother(self.madhab)):
            count += self.heir_set.instance_of(GrandMother).count()
        return count

    def has_mohter(self):
        return self.heir_set.instance_of(Mother).count() > 0

    def has_son(self):
        return self.heir_set.instance_of(Son).count() > 0

    def has_brother(self):
        return self.heir_set.instance_of(Brother).count() > 0

    def has_sister(self):
        return self.heir_set.instance_of(Sister).count() > 0

    def has_grandFather(self):
        return self.heir_set.instance_of(GrandFather).count() > 0

    def has_sonOfSon(self):
        return self.heir_set.instance_of(SonOfSon).count() > 0

    def has_paternalBrother(self):
        return self.heir_set.instance_of(PaternalBrother).count() > 0

    def has_sonOfBrother(self):
        return self.heir_set.instance_of(SonOfBrother).count() > 0

    def has_sonOfPaternalBrother(self):
        return self.heir_set.instance_of(SonOfPaternalBrother).count() > 0

    def has_uncle(self):
        return self.heir_set.instance_of(Uncle).count() > 0

    def has_paternalUncle(self):
        return self.heir_set.instance_of(PaternalUncle).count() > 0

    def has_sonOfUncle(self):
        return self.heir_set.instance_of(SonOfUncle).count() > 0

    def has_daughter(self):
        return self.heir_set.instance_of(Daughter).count() > 0

    def has_maternalSister(self):
        return self.heir_set.instance_of(MaternalSister).count() > 0

    def has_maternalBrother(self):
        return self.heir_set.instance_of(MaternalBrother).count() > 0

    def get_father(self):
        return self.heir_set.instance_of(Father).first()

    def get_mother(self):
        return self.heir_set.instance_of(Mother).first()

    def get_husband(self):
        return self.heir_set.instance_of(Husband).first()

    def get_wives(self):
        return self.heir_set.instance_of(Wife)

    def get_spouse(self):
        return self.heir_set.instance_of(Husband,Wife)

    def get_daughters(self):
        return self.heir_set.instance_of(Daughter)

    def get_sons(self):
        return self.heir_set.instance_of(Son)

    def get_brothers(self):
        return self.heir_set.instance_of(Brother)

    def get_sisters(self):
        return self.heir_set.instance_of(Sister)

    def get_grandFather(self):
        return self.heir_set.instance_of(GrandFather).first()

    def get_paternalSisters(self):
        return self.heir_set.instance_of(PaternalSister)

    def get_heirs_no_spouse(self):
        return self.heir_set.not_instance_of(Husband, Wife)

    def get_fractions(self, heirs):
        fractions = set()
        for heir in heirs:
            fractions.add(heir.get_fraction())
        return fractions

    def get_shares(self):
        """Sum of the shares in the Shares column (each group counted once)."""
        total = 0
        seen = set()
        gf_mode = self.gf_shares_with_siblings()
        for heir in self.heir_set.filter(blocked=False):
            if heir.correction:
                if heir.asaba:
                    key = ('asaba', isinstance(heir, (Brother, Sister)) if gf_mode else None, heir.share)
                elif self.maternal_quote and isinstance(heir, (MaternalBrother, MaternalSister)):
                    key = ('maternal', heir.share)
                else:
                    key = (heir.polymorphic_ctype_id, heir.share)
                if key in seen:
                    continue
                seen.add(key)
            total += heir.share
        return total

    def set_calc_shares(self):
        return self.shares

    def set_calc_correction(self):
        return self.shares_corrected if self.correction else None

    def get_corrected_shares(self):
        if self.correction and self.shares_corrected != 0:
            return sum(heir.corrected_share for heir in self.heir_set.filter(blocked=False))

    def gf_meets_siblings(self):
        """True when a grandfather and full or paternal siblings are in the family and nobody
        else decides between them: no father (who would block him) and no male descendant
        (who would block the siblings). The school then decides who takes what."""
        return (self.has_grandFather() and not self.has_father() and not self.has_male_descendent()
                and self.heir_set.instance_of(Brother, Sister, PaternalBrother, PaternalSister).count() > 0)

    def gf_shares_with_siblings(self):
        """True when the grandfather shares the estate with full or paternal siblings.

        That is the case when the school does not let him block them."""
        return not schools.grandfather_blocks_siblings(self.madhab) and self.gf_meets_siblings()

    def paternal_siblings_counted_out(self):
        """True when paternal siblings are counted against a grandfather and then get nothing.

        Only where the grandfather shares with the siblings (Maliki, Shafi'i, Hanbali): a full
        brother takes the whole siblings' pool, and so do full sisters who are residuary with a
        female descendant. The paternal siblings stay live, so they still count in his muqasama."""
        paternal = self.heir_set.instance_of(PaternalBrother, PaternalSister).count() > 0
        return (self.gf_shares_with_siblings() and paternal
                and (self.has_brother() or (self.has_sister() and self.has_female_descendent())))

    def is_akdariyya(self, live):
        """Husband, mother, grandfather and one full or paternal sister, and no other heir."""
        if len(live) != 4:
            return False
        husband = [h for h in live if isinstance(h, Husband)]
        mother = [h for h in live if isinstance(h, Mother)]
        sisters = [h for h in live if isinstance(h, (Sister, PaternalSister))]
        grandfather = [h for h in live if isinstance(h, GrandFather)]
        return (len(husband) == 1 and len(mother) == 1 and len(sisters) == 1 and len(grandfather) == 1
                and husband[0].exact_quote() == Fraction(1, 2) and mother[0].exact_quote() == Fraction(1, 3))

    def distribute(self, heirs):
        """Share the estate between the classified heirs, with exact fractions.

        This is the only place where results are worked out. Every stored column
        (shares, excess, shortage, correction and amount) is derived from the
        one fraction each heir ends up with. Returns those fractions, keyed by
        heir id."""
        zero = Fraction(0)
        one = Fraction(1)
        live = [h for h in heirs if not h.blocked]
        gf_mode = self.gf_shares_with_siblings()
        sibs = [h for h in live if isinstance(h, (Brother, Sister, PaternalBrother, PaternalSister))] if gf_mode else []
        sib_ids = {h.pk for h in sibs}
        mushtaraka = []
        if schools.has_mushtaraka(self.madhab, self.live_counts(heirs)):
            mushtaraka = [h for h in live if isinstance(h, (Brother, Sister, MaternalBrother, MaternalSister))]
        mushtaraka_ids = {h.pk for h in mushtaraka}

        # fixed shares, one group per type (maternal siblings share one group)
        reasons_pending = []
        fixed = {}
        for heir in live:
            if heir.asaba or heir.pk in sib_ids or heir.pk in mushtaraka_ids or (gf_mode and isinstance(heir, GrandFather)):
                continue
            quote = heir.exact_quote()
            if quote <= 0:
                continue
            if self.maternal_quote and isinstance(heir, (MaternalBrother, MaternalSister)):
                key = 'maternal'
            elif isinstance(heir, (GrandMother, MaternalGrandMother)):
                key = 'grandmother'
            else:
                key = type(heir)
            if key not in fixed:
                fixed[key] = _Group(key, quote)
            fixed[key].add(heir)
        groups = list(fixed.values())
        if mushtaraka:
            # the full siblings join the maternal siblings, and all of them share the third equally
            group = _Group('mushtaraka', Fraction(1, 3), kind='mushtaraka')
            for heir in mushtaraka:
                group.add(heir, 1)
                # all of them share the maternal siblings' third, which the table shows once
                group.prescribed[heir.pk] = Fraction(1, 3)
                heir.asaba = False
                reasons_pending.append(heir)
            groups.append(group)
        fixed_total = sum((g.amount for g in groups), zero)

        extra = None          # father or grandfather who also takes the remainder
        extra_remainder = zero
        radd_groups = []
        reasons = {heir.pk: _("Mushtaraka: the full siblings share the maternal siblings' third equally")
                   for heir in reasons_pending}
        # what each overridden reason rests on, for the proof: (rule, condition, option)
        bases = {heir.pk: (proof.MUSHTARAKA, None, None) for heir in reasons_pending}
        residual = zero
        if gf_mode:
            grandfather = next(h for h in live if isinstance(h, GrandFather))
            left = max(zero, one - fixed_total)
            units = sum(2 if is_male(h) else 1 for h in sibs)
            options = [
                (left * 2 / (2 + units), _("Grandfather shares the remainder with the siblings as one more brother, which is the best of his options"), 'muqasama'),
                (left / 3, _("Grandfather gets 1/3 of the remainder, which is the best of his options with siblings"), 'third_of_remainder'),
                (Fraction(1, 6), _("Grandfather gets 1/6 of the estate, which is the best of his options with siblings"), 'sixth_of_estate'),
            ]
            grandfather_amount, grandfather_reason, grandfather_option = max(options, key=lambda option: option[0])
            pool = max(zero, left - grandfather_amount)
            if self.is_akdariyya(live):
                group = _Group('akdariyya', grandfather_amount + Fraction(1, 2), kind='akdariyya')
                group.add(grandfather, 2)
                group.add(sibs[0], 1)
                # the scholars' table shows each one's own share before they are pooled
                group.prescribed = {grandfather.pk: grandfather_amount, sibs[0].pk: Fraction(1, 2)}
                groups.append(group)
                for heir in (grandfather, sibs[0]):
                    reasons[heir.pk] = _("Akdariyya: the grandfather and the sister pool their shares and split them two to one")
                    bases[heir.pk] = (proof.AKDARIYYA, None, None)
            else:
                group = _Group('grandfather', grandfather_amount, kind='grandfather')
                group.add(grandfather)
                groups.append(group)
                reasons[grandfather.pk] = grandfather_reason
                bases[grandfather.pk] = (proof.GRANDFATHER_BEST_OPTION, 'with_siblings', grandfather_option)
                full = [h for h in sibs if isinstance(h, (Brother, Sister))]
                paternal = [h for h in sibs if isinstance(h, (PaternalBrother, PaternalSister))]
                full_units = sum(2 if is_male(h) else 1 for h in full)
                paternal_units = sum(2 if is_male(h) else 1 for h in paternal)
                if not paternal:
                    full_total = pool
                elif not full:
                    full_total = zero
                elif self.paternal_siblings_counted_out():
                    full_total = pool
                elif any(is_male(h) for h in full):
                    full_total = pool
                else:
                    cap = Fraction(1, 2) if len(full) == 1 else Fraction(2, 3)
                    counted = pool * full_units / (full_units + paternal_units)
                    full_total = min(pool, max(counted, cap))
                for members, total in ((full, full_total), (paternal, pool - full_total)):
                    if not members:
                        continue
                    group = _Group('full' if members is full else 'paternal', total, kind='siblings')
                    for heir in members:
                        group.add(heir, 1)
                    group.set_weights_by_sex()
                    groups.append(group)
                    if total == 0:
                        for heir in members:
                            if members is paternal and full and full_total > 0:
                                reasons[heir.pk] = _("Paternal siblings count against the grandfather but get nothing because of the full siblings")
                                bases[heir.pk] = (proof.RESIDUARY, 'excluded_by_full_siblings', None)
                            else:
                                reasons[heir.pk] = _("The shares of the grandfather and the others use up the whole estate, so nothing is left for the siblings")
                                bases[heir.pk] = (proof.RESIDUARY, 'estate_exhausted', None)
        else:
            asaba = [h for h in live if h.asaba and h.pk not in mushtaraka_ids]
            residual = max(zero, one - fixed_total)
            if asaba:
                group = _Group('asaba', residual, kind='asaba')
                for heir in asaba:
                    group.add(heir, 1)
                group.set_weights_by_sex()
                groups.append(group)
                if residual == 0:
                    for heir in asaba:
                        reasons[heir.pk] = _("The fixed shares use up the whole estate, so nothing is left for the residuary heirs")
                        bases[heir.pk] = (proof.RESIDUARY, 'estate_exhausted', None)
            else:
                if self.has_female_descendent() and not self.has_male_descendent():
                    extra = next((g for g in groups if g.key in (Father, GrandFather)), None)
                if extra is not None:
                    extra_remainder = residual
                elif residual > 0:
                    radd_groups = [g for g in groups if not g.is_spouse()]

        total = sum((g.amount for g in groups), zero)
        for group in groups:
            group.stage = group.amount
            group.final = group.amount / total if total > 1 else group.amount
        excess = total > 1
        if extra is not None and extra_remainder > 0:
            extra.final = extra.amount + extra_remainder
        radd = bool(radd_groups) and total < 1
        if radd:
            spouse_total = sum((g.amount for g in groups if g.is_spouse()), zero)
            radd_total = sum((g.amount for g in radd_groups), zero)
            for group in radd_groups:
                group.final = group.amount * (one - spouse_total) / radd_total

        # a father or grandfather with a female descendant who is left no remainder only has the fixed share
        has_remainder = extra is not None and extra_remainder > 0
        for heir in live:
            if heir.basis['rule'] == proof.FIXED_AND_RESIDUARY and not (has_remainder and heir in extra.members):
                heir.basis['condition'] = 'estate_exhausted'

        # the final fraction of every heir
        final = {heir.pk: zero for heir in heirs}
        for group in groups:
            for heir, weight in zip(group.members, group.weights):
                final[heir.pk] = group.final * weight / sum(group.weights)

        # shares: the lowest common base of the groups before awl or radd
        if not groups:
            base = 0
        elif all(g.kind == 'asaba' for g in groups):
            base = sum(groups[0].weights)
        else:
            dens = [g.stage.denominator for g in groups if g.stage > 0] or [1]
            base = self.lcm_list(dens)

        columns = {h.pk: {'share': 0, 'shorted_share': 0, 'shortage_calc_share': 0, 'shortage_union_share': 0,
                          'correction': False} for h in heirs}

        merged = {}

        def put(group, column, values, fell_back):
            for heir, value in zip(group.members, values):
                columns[heir.pk][column] = value
                if fell_back:
                    columns[heir.pk]['correction'] = True
            if fell_back:
                merged.setdefault(column, set()).add(id(group))

        for group in groups:
            put(group, 'share', *group.column(base, group.stage))

        shares_excess = shares_shorted = shortage_calc_shares = shortage_union_shares = 0
        shortage = shortage_calc = False
        final_base = base
        if excess:
            shares_excess = sum(round(g.stage * base) for g in groups)
            final_base = shares_excess
        elif extra is not None and extra_remainder > 0:
            shortage = True
            shares_shorted = base
            final_base = shares_shorted
            for group in groups:
                put(group, 'shorted_share', *group.column(base, group.final))
        elif radd:
            shortage = True
            spouse = [g for g in groups if g.is_spouse()]
            if not spouse:
                shares_shorted = sum(round(g.stage * base) for g in radd_groups)
                final_base = shares_shorted
                for group in radd_groups:
                    put(group, 'shorted_share', *group.column(shares_shorted, group.final))
            else:
                spouse = spouse[0]
                shares_shorted = spouse.stage.denominator
                final_base = shares_shorted
                put(spouse, 'shorted_share', *spouse.column(shares_shorted, spouse.final))
                remainder = shares_shorted - spouse.stage.numerator
                if len(radd_groups) == 1:
                    put(radd_groups[0], 'shorted_share', *radd_groups[0].column(shares_shorted, radd_groups[0].final))
                else:
                    shortage_calc = True
                    shortage_calc_shares = self.lcm_list([g.stage.denominator for g in radd_groups])
                    for group in radd_groups:
                        put(group, 'shorted_share', [remainder] * len(group.members), False)
                        put(group, 'shortage_calc_share', *group.column(shortage_calc_shares, group.stage))
                    shortage_union_shares = self.lcm_list([g.final.denominator for g in groups if g.final > 0] or [1])
                    final_base = shortage_union_shares
                    for group in groups:
                        put(group, 'shortage_union_share', *group.column(shortage_union_shares, group.final))
        correction = any(c['correction'] for c in columns.values())
        shares_corrected = 0
        if correction:
            dens = [f.denominator for f in final.values() if f > 0]
            shares_corrected = self.lcm_list([final_base or 1] + dens)

        # amounts: exact fraction of the estate, rounded half up to 2 decimals
        deceased = self.deceased_set.first()
        estate = Fraction(deceased.estate) if deceased else zero
        for group in groups:
            if group.kind in ('akdariyya', 'mushtaraka'):
                for heir, weight in zip(group.members, group.weights):
                    heir.set_quote(group.stage * weight / sum(group.weights))
            elif group.kind in ('asaba', 'siblings', 'grandfather') and group.stage > 0:
                for heir in group.members:
                    heir.set_quote(group.stage)
        calc_ids = {h.pk for g in radd_groups for h in g.members} if shortage_calc else set()
        for heir in heirs:
            heir.share = columns[heir.pk]['share']
            heir.shorted_share = columns[heir.pk]['shorted_share']
            heir.shortage_calc = heir.pk in calc_ids
            heir.shortage_calc_share = columns[heir.pk]['shortage_calc_share']
            heir.shortage_union_share = columns[heir.pk]['shortage_union_share']
            heir.correction = columns[heir.pk]['correction']
            fraction = final.get(heir.pk, zero)
            heir.corrected_share = round(fraction * shares_corrected) if correction and not heir.blocked else 0
            heir.amount = money(estate * fraction)
            if heir.pk in reasons:
                heir.quote_reason = reasons[heir.pk]
                heir.set_basis(bases[heir.pk][0], bases[heir.pk][1], option=bases[heir.pk][2])
            heir.save()

        self.shares = base
        self.residual_shares = round(residual * base) if base else 0
        self.excess = excess
        self.shares_excess = shares_excess
        self.shortage = shortage
        self.shares_shorted = shares_shorted
        self.shortage_calc = shortage_calc
        self.shortage_calc_shares = shortage_calc_shares
        self.shortage_union_shares = shortage_union_shares
        self.correction = correction
        self.shares_corrected = shares_corrected
        self.common_quote = False
        self.save()
        self._tag_school_rules(heirs, live, [h for g in radd_groups for h in g.members] if radd else [])
        left = one - sum(final.values(), zero)
        totals = {'share': base, 'shorted_share': shares_shorted, 'shortage_calc_share': shortage_calc_shares,
                  'shortage_union_share': shortage_union_shares, 'corrected_share': shares_corrected}
        spec = [('base', 'share', base, 'share')]
        if excess:
            spec.append(('awl', 'share', shares_excess, 'share'))
        if shortage:
            spec.append(('radd' if radd else 'remainder', 'shorted_share', shares_shorted, 'shorted_share'))
        if shortage_calc:
            spec.append(('radd_calc', 'shortage_calc_share', shortage_calc_shares, 'shortage_calc_share'))
            spec.append(('radd_union', 'shortage_union_share', shortage_union_shares, 'shortage_union_share'))
        if correction:
            spec.append(('correction', 'corrected_share', shares_corrected, None))
        self.table = None
        if groups and base > 0:
            self.table = proof.build_table(
                [{'code': code, 'total': total,
                  'values': {h.pk: getattr(h, attr) for h in heirs},
                  'merged': {i for i, g in enumerate(groups) if mkey and id(g) in merged.get(mkey, ())}}
                 for code, attr, total, mkey in spec],
                [[h.pk for h in g.members] for g in groups],
                [h.pk for h in heirs],
                {**{h.pk: h.basis['fraction'] for h in heirs},
                 **{pk: share for g in groups for pk, share in g.prescribed.items()}},
                {h.pk for h in heirs if h.blocked})
        self._proof_steps = {
            'base': base,
            'awl': shares_excess if excess else None,
            'radd': final_base if radd else None,
            'correction': shares_corrected if correction else None,
            'unallocated': left if left > 0 else None,
        }
        return final

    def _tag_school_rules(self, heirs, live, radd_members):
        """Name, on the heirs a school rule decided, the rule that applied. A heir keeps the
        first rule that tags it."""
        def tag(members, code):
            for heir in members:
                if heir.basis['school_rule'] is None:
                    heir.basis['school_rule'] = code
        if self.gf_meets_siblings():
            tag([h for h in heirs if isinstance(h, (GrandFather, Brother, Sister, PaternalBrother, PaternalSister))],
                schools.grandfather_rule(self.madhab))
        if schools.is_mushtaraka_family(self.live_counts(heirs)):
            tag([h for h in live if isinstance(h, (Brother, Sister, MaternalBrother, MaternalSister))],
                schools.mushtaraka_rule(self.madhab))
        if (any(isinstance(h, Father) for h in heirs) and any(isinstance(h, GrandMother) for h in heirs)
                and not any(isinstance(h, Mother) for h in heirs)):
            tag([h for h in heirs if isinstance(h, (GrandMother, MaternalGrandMother))],
                schools.grandmother_rule(self.madhab))
        if radd_members:
            tag(radd_members, schools.radd_rule(self.madhab))

    def clear(self):
        self.shares = 0
        self.excess = False
        self.shortage = False
        self.residual_shares = 0
        self.correction = False
        self.shortage_calc = False
        self.shortage_calc_shares = 0
        self.shortage_union_shares = 0
        self.shares_excess = 0
        self.shares_corrected = 0
        self.shares_shorted = 0
        self.maternal_quote  = False
        self.common_quote = False
        for heir in self.heir_set.all():
            heir.clear()
        self.save()

    def compute(self, madhab=schools.DEFAULT):
        """Work out every heir's share under one school: hanafi, maliki, shafii or
        hanbali. With no school the result is the Hanbali one, as before.

        The school is an input to this run and is never stored. An unknown id raises
        ValueError. A case the engine refuses raises UnsupportedCase with a stable
        `reason` code, and no result is given for it.

        The run first reloads this calculation under its row lock, preserving committed
        name and owner changes. It is one transaction, so on
        PostgreSQL simultaneous runs on one case go one after another (a run waits,
        with no time limit, while another holds the lock), other readers only see
        complete results, and any exception, a refusal included, rolls back every
        write the run made. The in-memory instance and its heirs are not restored
        after such a failure, so do not save them. Inside a caller's transaction the
        run is a savepoint and the lock is held until that outer transaction ends.
        A deleted case raises Calculation.DoesNotExist and writes nothing. Cases
        with later deaths are refused here; compute_manasikhat() is their entry
        point. Legacy results pages do not run layered cases."""
        self.proof = None
        self.table = None
        self._proof_steps = None
        schools.check_school(madhab)
        with transaction.atomic():
            self.refresh_from_db(from_queryset=Calculation.objects.select_for_update())
            if not getattr(self, "_manasikhat_run", False) and (
                    self.parent_id is not None or self.layers.exists()
                    or Deceased.objects.filter(heir__calc=self).exists()):
                raise UnsupportedCase(schools.MANASIKHAT_UNSUPPORTED)
            self.madhab = madhab
            self.clear()
            heirs = self.get_quotes()
            live = self.live_counts(heirs)
            maternal = sum(1 for h in heirs if isinstance(h, (MaternalBrother, MaternalSister)))
            if self.has_descendent() or self.has_father():
                maternal = 0
            schools.check_family(madhab, live, maternal)
            final = self.distribute(heirs)
            self.proof = proof.build(
                madhab, [(h.pk, type(h).__name__, h.basis, final[h.pk]) for h in heirs], self._proof_steps)
            return final

    @staticmethod
    def live_counts(heirs):
        """How many heirs of each type are not blocked, keyed by class name."""
        counts = {}
        for heir in heirs:
            if not heir.blocked:
                name = type(heir).__name__
                counts[name] = counts.get(name, 0) + 1
        return counts

    def get_absolute_url(self):
        return reverse('calc:detail', args=[self.id])
class Deceased(Person):
    """Deceased class"""
    heir = models.ForeignKey("Heir", null=True, blank=True, on_delete=NON_POLYMORPHIC_CASCADE, related_name="later_deaths")
    death_order = models.IntegerField(default=1)
    estate = models.IntegerField()
    calc = models.ForeignKey(Calculation, on_delete=NON_POLYMORPHIC_CASCADE,null=True)
    def get_absolute_url(self):
        return reverse('calc:detail', args=[self.calc.id])
class Heir(Person):
    """Heir class"""
    # Free the inherited Person.heir name for Deceased.heir.
    person_ptr = models.OneToOneField(Person, on_delete=models.CASCADE, parent_link=True, primary_key=True, related_name="heir_row")
    same_person = models.ForeignKey("self", null=True, blank=True, on_delete=NON_POLYMORPHIC_CASCADE, related_name="person_rows")
    quote = models.DecimalField(max_digits=11, decimal_places=10, default=0)  #prescribed share
    shared_quote = models.BooleanField(default=False)    #prescribed share is shared with other heir like 2 daughters
    share = models.IntegerField(default=0)
    corrected_share = models.IntegerField(default=0)
    shorted_share = models.IntegerField(default=0)
    amount = models.DecimalField(max_digits=20, decimal_places=2, default=0)
    asaba = models.BooleanField(default=False)           #agnate or residuary
    blocked = models.BooleanField(default=False)         # restricted from inheritance
    quote_reason = models.CharField(max_length=255, default="")
    # What the share rests on, as stable codes for the proof. Transient, set by get_quote().
    basis = None
    correction = models.BooleanField(default=False)
    shortage_calc = models.BooleanField(default = False)
    shortage_calc_share = models.IntegerField(default=0)
    shortage_union_share = models.IntegerField(default=0)
    abstract = True
    calc = models.ForeignKey(Calculation, on_delete=NON_POLYMORPHIC_CASCADE,null=True)
    def get_absolute_url(self):
        return reverse('calc:detail', args=[self.calc.id])
    def __str__(self):
        return (self.first_name if self.first_name else " ")
    def get_quote(self, calc):
        pass
    def set_quote(self, quote):
        """Keep the prescribed share exactly, and store it rounded in the quote column."""
        quote = Fraction(quote)
        self._exact_quote = quote
        self.quote = (Decimal(quote.numerator) / Decimal(quote.denominator)).quantize(Decimal('1e-10'))

    def exact_quote(self):
        quote = getattr(self, '_exact_quote', None)
        if quote is None:
            quote = Fraction(self.quote).limit_denominator(10 ** 6)
        return quote

    def set_basis(self, rule, condition=None, blocked_by=None, option=None):
        """Record what this heir's share rests on, beside the translated quote_reason, as
        stable codes for the proof. Call it after set_quote, which a fixed share reads."""
        self.basis = {
            'rule': rule, 'condition': condition, 'blocked_by': blocked_by,
            'fraction': self.exact_quote() if rule in proof.FRACTION_RULES else None,
            'school_rule': None, 'option': option,
        }

    def set_share(self, calc):
        return self.share

    def get_corrected_share(self, calc):
        return self.corrected_share

    def get_fraction(self):
        return Fraction(self.quote).limit_denominator()
    def clear(self):
        self.quote = 0
        self._exact_quote = Fraction(0)
        self.shared_quote = False
        self.share = 0
        self.corrected_share = 0
        self.shorted_share = 0
        self.amount = 0
        self.asaba = False
        self.blocked = False
        self.quote_reason = ""
        self.basis = None
        self.correction = False
        self.shortage_calc = False
        self.shortage_calc_share  = 0
        self.shortage_union_share  = 0
        self.save()

class Father(Heir):
    """Father class"""
    def add(self, calc):
        calc.deceased_set.first().add_father(father=self)
    def get_quote(self, calc):
        if calc.has_male_descendent():
            self.set_quote(Fraction(1, 6))
            self.quote_reason = _("father gets 1/6 prescribed share because of male descendant")
            self.set_basis('fixed', 'male_descendant')
        elif calc.has_female_descendent():
            self.set_quote(Fraction(1, 6))
            #self.asaba = True
            self.quote_reason = _("father gets 1/6 plus remainder because of female descendant")
            self.set_basis('fixed_and_residuary', 'female_descendant')
        else:
            self.asaba = True
            self.quote_reason = _("father gets the remainder because there is no descendant")
            self.set_basis('residuary', 'no_descendant')
        self.save()
        return self.quote


class Mother(Heir):
    """Mother class"""
    def add(self, calc):
        calc.deceased_set.first().add_mother(mother=self)

    def get_quote(self, calc):
        if calc.has_descendent():
            self.set_quote(Fraction(1, 6))
            self.quote_reason = _("mother gets 1/6 because of descendant")
            self.set_basis('fixed', 'descendant')
        elif calc.has_siblings():
            self.set_quote(Fraction(1, 6))
            self.quote_reason = _("mother gets 1/6 because of siblings")
            self.set_basis('fixed', 'siblings')
        elif calc.has_spouse() and calc.has_father():
            if calc.deceased_set.first().sex == 'M':
                self.set_quote(Fraction(1, 4))
                self.quote_reason = _("mother gets 1/3 of the remainder which is 1/4.")
                self.set_basis('fixed', 'spouse_and_father')
            else:
                self.set_quote(Fraction(1, 6))
                self.quote_reason = _("mother gets 1/3 of the remainder which is 1/6")
                self.set_basis('fixed', 'spouse_and_father')
        else:
            self.set_quote(Fraction(1, 3))
            self.quote_reason = _("mother gets 1/3 because no descendant or siblings")
            self.set_basis('fixed', 'no_descendant_or_siblings')
        self.save()
        return self.quote



class Husband(Heir):
    """Husbnad class"""
    def add(self, calc):
        calc.deceased_set.first().add_husband(husband=self)

    def get_quote(self, calc):
        if calc.has_descendent():
            self.set_quote(Fraction(1, 4))
            self.quote_reason = _("husband gets 1/4 becuase of descendant")
            self.set_basis('fixed', 'descendant')
        else:
            self.set_quote(Fraction(1, 2))
            self.quote_reason = _("husband gets 1/2 becuase there is no descendant")
            self.set_basis('fixed', 'no_descendant')
        self.save()
        return self.quote

class Wife(Heir):
    """Wife class"""
    def add(self, calc):
        calc.deceased_set.first().add_wife(wife=self)

    def get_quote(self, calc):
        if calc.heir_set.instance_of(Wife).count() == 1:
            if calc.has_descendent():
                self.set_quote(Fraction(1, 8))
                self.quote_reason = _("wife gets 1/8 becuase of descendant")
                self.set_basis('fixed', 'descendant')
            else:
                self.set_quote(Fraction(1, 4))
                self.quote_reason = _("wife gets 1/4 becuase there is no descendant")
                self.set_basis('fixed', 'no_descendant')
        else:
            if calc.has_descendent():
                self.set_quote(Fraction(1, 8))
                self.quote_reason = _("wives share the qoute of 1/8 becuase of descendant")
                self.set_basis('fixed', 'descendant')
            else:
                self.set_quote(Fraction(1, 4))
                self.quote_reason = _("wives share the quote of 1/4 becuase there is no descendant")
                self.set_basis('fixed', 'no_descendant')
            self.shared_quote = True
        self.save()
        return self.quote

class Daughter(Heir):
    """Daughter Class"""
    def add(self, calc, mother, father):
        calc.deceased_set.first().add_daughter(daughter=self, mother=mother, father=father)

    def get_quote(self, calc):
        if calc.has_son():
            self.asaba = True
            self.quote_reason = _("Daughter/s with Son/s share the residuary. The son will receive a share of two daughters.")
            self.set_basis('residuary', 'with_son')
            if calc.heir_set.instance_of(Daughter).count() > 1:
                self.shared_quote = True
        elif calc.heir_set.instance_of(Daughter).count() == 1:
            self.set_quote(Fraction(1, 2))
            self.quote_reason = _("Daughter gets 1/2 when she has no other sibling/s")
            self.set_basis('fixed', 'single')
        else:
            self.set_quote(Fraction(2, 3))
            self.shared_quote = True
            self.quote_reason = _("Daughters share the quote of 2/3 when there is no son/s")
            self.set_basis('fixed', 'several')
        self.save()
        return self.quote

class Son(Heir):
    """Son Class"""
    def add(self, calc, mother, father):
        calc.deceased_set.first().add_son(son=self, mother=mother, father=father)

    def get_quote(self, calc):
        if calc.heir_set.instance_of(Son).count() > 1:
            self.shared_quote = True
        self.asaba =  True
        self.quote_reason = _("Son/s share the remainder or all amount if no other heir exist")
        self.set_basis('residuary')
        self.save()
        return self.quote

class Brother(Heir):
    """Brother Class"""
    def add(self, calc):
        calc.deceased_set.first().add_brother(brother=self)

    def get_quote(self, calc):
        brothers = calc.heir_set.instance_of(Brother)
        if brothers.count() > 1:
            self.shared_quote = True
        if calc.has_male_descendent():
            self.blocked = True
            self.quote_reason = _("Bother/s are blocked by male descendant")
            self.set_basis('blocked', blocked_by='male_descendant')
        elif calc.has_father():
            self.blocked = True
            self.quote_reason = _("Brother/s are blocked by father")
            self.set_basis('blocked', blocked_by='father')
        elif calc.has_grandFather() and schools.grandfather_blocks_siblings(calc.madhab):
            self.blocked = True
            self.quote_reason = _("Brother/s are blocked by grandfather")
            self.set_basis('blocked', blocked_by='grandfather')
        elif calc.has_grandFather():
            self.asaba = True
            self.quote_reason = _("Brother/s share the estate with the grandfather")
            self.set_basis('residuary', 'with_grandfather')
        else:
            self.asaba =  True
            self.quote_reason = _("Brother/s share the remainder or all amount if no other heir exist")
            self.set_basis('residuary')
        self.save()
        return self.quote

class Sister(Heir):
    """Sister Class"""
    def add(self, calc):
        calc.deceased_set.first().add_sister(sister=self)

    def get_quote(self, calc):
        sisters = calc.heir_set.instance_of(Sister)
        if sisters.count() > 1:
            self.shared_quote = True
        if calc.has_male_descendent():
            self.blocked = True
            self.quote_reason = _("Sister/s are blocked by male descendant")
            self.set_basis('blocked', blocked_by='male_descendant')
        elif calc.has_father():
            self.blocked = True
            self.quote_reason = _("Sister/s are blocked by father")
            self.set_basis('blocked', blocked_by='father')
        elif calc.has_grandFather() and schools.grandfather_blocks_siblings(calc.madhab):
            self.blocked = True
            self.quote_reason = _("Sister/s are blocked by grandfather")
            self.set_basis('blocked', blocked_by='grandfather')
        elif calc.has_grandFather():
            self.asaba = True
            self.quote_reason = _("Sister/s share the estate with the grandfather")
            self.set_basis('residuary', 'with_grandfather')
        elif calc.has_brother():
            self.asaba = True
            self.quote_reason = _("Sister/s with borther/s share the remainder or all the amount if no other heir exist. The brother will receive a share of two sisters")
            self.set_basis('residuary', 'with_brother')
        elif calc.has_female_descendent():
            self.asaba = True
            self.quote_reason = _("Sister/s with female descendant share the remainder")
            self.set_basis('residuary', 'female_descendant')
        else:
            if sisters.count() == 1:
                self.set_quote(Fraction(1, 2))
                self.quote_reason = _("Sister gets half when no father or son. ")
                self.set_basis('fixed', 'single')
            else:
                self.set_quote(Fraction(2, 3))
                self.quote_reason = _("Sisters share 2/3 when no father or son.")
                self.set_basis('fixed', 'several')
        self.save()
        return self.quote

class GrandFather(Heir):
    """GrandFather Class"""
    def add(self, calc):
        calc.deceased_set.first().add_grandFather(grandFather=self)

    def get_quote(self, calc):
        if calc.has_father():
            self.blocked = True
            self.quote_reason = _("Grandfather is blocked by father")
            self.set_basis('blocked', blocked_by='father')
        elif calc.has_male_descendent():
            self.set_quote(Fraction(1, 6))
            self.quote_reason = _("Grandfather gets 1/6 prescribed share because of male descendant")
            self.set_basis('fixed', 'male_descendant')
        elif calc.gf_shares_with_siblings():
            self.quote_reason = _("Grandfather shares the estate with the full and paternal siblings and takes the best of his options")
            self.set_basis('grandfather_best_option', 'with_siblings')
        elif calc.has_female_descendent():
            self.set_quote(Fraction(1, 6))
            #self.asaba = True
            self.quote_reason = _("Grandfather gets 1/6 plus remainder because of female descendant")
            self.set_basis('fixed_and_residuary', 'female_descendant')
        else:
            self.asaba = True
            self.quote_reason = _("Grandfather gets the remainder because there is no descendant")
            self.set_basis('residuary', 'no_descendant')
        self.save()
        return self.quote

class GrandMother(Heir):
    """GrandMother class: the paternal grandmother, the father's mother."""
    def add(self, calc):
        calc.deceased_set.first().add_grandMother(grandMother=self)

    def get_quote(self, calc):
        if calc.has_mohter():
            self.blocked = True
            self.quote_reason = _("Grandmother is blocked by mother")
            self.set_basis('blocked', blocked_by='mother')
        elif calc.has_father() and schools.father_blocks_his_mother(calc.madhab):
            self.blocked = True
            self.quote_reason = _("Paternal grandmother is blocked by father")
            self.set_basis('blocked', blocked_by='father')
        else:
            if calc.grandmother_count() > 1:
                self.shared_quote = True
            self.set_quote(Fraction(1, 6))
            self.quote_reason = _("Grandmother gets 1/6 if no mother")
            self.set_basis('fixed', 'no_mother')
        self.save()
        return self.quote

class MaternalGrandMother(Heir):
    """MaternalGrandMother class: the mother's mother."""
    def add(self, calc):
        pass

    def get_quote(self, calc):
        if calc.has_mohter():
            self.blocked = True
            self.quote_reason = _("Maternal grandmother is blocked by mother")
            self.set_basis('blocked', blocked_by='mother')
        else:
            if calc.grandmother_count() > 1:
                self.shared_quote = True
            self.set_quote(Fraction(1, 6))
            self.quote_reason = _("Maternal grandmother gets 1/6 if no mother")
            self.set_basis('fixed', 'no_mother')
        self.save()
        return self.quote

class SonOfSon(Heir):
    """SonOfSon class"""
    def add(self, calc):
        calc.deceased_set.first().add_sonOfSon(son=self)

    def get_quote(self, calc):
        if calc.has_son():
            self.blocked = True
            self.quote_reason = _("Son of son is blocked by Son")
            self.set_basis('blocked', blocked_by='son')
        else:
            if calc.heir_set.instance_of(SonOfSon).count() > 1:
                self.shared_quote = True
            self.asaba = True
            self.quote_reason = _("Son of son share the remainder or all amount if no other heir exist")
            self.set_basis('residuary')
        self.save()
        return self.quote

class DaughterOfSon(Heir):
    """DaughterOfSon Class"""
    def add(self, calc, ):
        calc.deceased_set.first().add_daughterOfSon(daughter=self)

    def get_quote(self, calc):
        daughtersOfSon = calc.heir_set.instance_of(DaughterOfSon)
        if daughtersOfSon.count() > 1:
            self.shared_quote = True
        if calc.has_son():
            self.blocked = True
            self.quote_reason = _("Daughter of son is blocked by son")
            self.set_basis('blocked', blocked_by='son')
        elif calc.has_sonOfSon():
            self.asaba = True
            self.quote_reason = _("Daughter/s of son with Son/s of son share the residuary. The son of son will receive a share of two daughters of son.")
            self.set_basis('residuary', 'with_son_of_son')
        elif calc.has_daughter():
            daughters = calc.heir_set.instance_of(Daughter)
            if daughters.count()==1:
                self.set_quote(Fraction(1, 6))
                self.quote_reason = _("Daughter of son get 1/6, with daughter")
                self.set_basis('fixed', 'with_daughter')
            else:
                self.blocked = True
                self.quote_reason = _("Daughter/s of son are blocked by daugters")
                self.set_basis('blocked', blocked_by='daughters')
        elif daughtersOfSon.count() == 1:
            self.set_quote(Fraction(1, 2))
            self.quote_reason = _("Daughter of son gets 1/2 when she has no other sibling/s")
            self.set_basis('fixed', 'single')
        else:
            self.set_quote(Fraction(2, 3))
            self.quote_reason = _("Daughters of son share the quote of 2/3 when there is no son/s of son")
            self.set_basis('fixed', 'several')
        self.save()
        return self.quote


class PaternalSister(Heir):
    """PaternalSister Class"""
    def add(self, calc):
        calc.deceased_set.first().add_paternalSister(sister=self)

    def get_quote(self, calc):
        paternalSisters = calc.heir_set.instance_of(PaternalSister)
        if paternalSisters.count() > 1:
            self.shared_quote = True
        if calc.has_male_descendent():
            self.blocked = True
            self.quote_reason = _("Paternal sister/s are blocked by male descendant")
            self.set_basis('blocked', blocked_by='male_descendant')
        elif calc.has_father():
            self.blocked = True
            self.quote_reason = _("Paternal sister/s are blocked by father")
            self.set_basis('blocked', blocked_by='father')
        elif calc.has_grandFather() and schools.grandfather_blocks_siblings(calc.madhab):
            self.blocked = True
            self.quote_reason = _("Paternal sister/s are blocked by grandfather")
            self.set_basis('blocked', blocked_by='grandfather')
        elif calc.has_grandFather():
            self.asaba = True
            self.quote_reason = _("Paternal sister/s share the estate with the grandfather")
            self.set_basis('residuary', 'with_grandfather')
        elif calc.has_brother():
            self.blocked = True
            self.quote_reason = _("Paternal sister/s are blocked by borther/s")
            self.set_basis('blocked', blocked_by='brother')
        elif calc.get_sisters().filter(asaba=True):
            self.blocked = True
            self.quote_reason = _("Paternal sister/s are blocked by sisters")
            self.set_basis('blocked', blocked_by='sisters')
        elif calc.has_paternalBrother():
            self.asaba = True
            self.quote_reason = _("Paternal sister/s with paternal half borther/s share the remainder or all the amount if no other heir exist. The brother will receive a share of two sisters")
            self.set_basis('residuary', 'with_paternal_brother')
        elif calc.has_sister():
            sisters= calc.heir_set.instance_of(Sister)
            if sisters.count()==1:
                self.set_quote(Fraction(1, 6))
                self.quote_reason = _("Paternal sister/s get 1/6 with sister")
                self.set_basis('fixed', 'with_sister')
            else:
                self.blocked = True
                self.quote_reason = _("Paternal sisters/s are blocked by sisters")
                self.set_basis('blocked', blocked_by='sisters')
        elif calc.has_female_descendent():
            self.asaba = True
            self.quote_reason = _("Paternal sister/s with female descendant share the remainder")
            self.set_basis('residuary', 'female_descendant')
        elif paternalSisters.count() == 1:
            self.set_quote(Fraction(1, 2))
            self.quote_reason = _("Paternal sister gets half when no father or son. ")
            self.set_basis('fixed', 'single')
        else:
            self.set_quote(Fraction(2, 3))
            self.quote_reason = _("Paternal sisters share 2/3 when no father or son.")
            self.set_basis('fixed', 'several')
        self.save()
        return self.quote

class PaternalBrother(Heir):
    """PaternalBrother Class"""
    def add(self, calc):
        calc.deceased_set.first().add_paternalBrother(brother=self)

    def get_quote(self, calc):
        paternalBrothers = calc.heir_set.instance_of(PaternalBrother)
        if paternalBrothers.count() > 1:
            self.shared_quote = True
        if calc.has_male_descendent():
            self.blocked = True
            self.quote_reason = _("Paternal brother/s are blocked by male descendant")
            self.set_basis('blocked', blocked_by='male_descendant')
        elif calc.has_father():
            self.blocked = True
            self.quote_reason = _("Paternal brother/s are blocked by father")
            self.set_basis('blocked', blocked_by='father')
        elif calc.has_grandFather() and schools.grandfather_blocks_siblings(calc.madhab):
            self.blocked = True
            self.quote_reason = _("Paternal brother/s are blocked by grandfather")
            self.set_basis('blocked', blocked_by='grandfather')
        elif calc.has_grandFather():
            self.asaba = True
            self.quote_reason = _("Paternal brother/s share the estate with the grandfather")
            self.set_basis('residuary', 'with_grandfather')
        elif calc.has_brother():
            self.blocked = True
            self.quote_reason = _("Paternal brother/s are blocked by brothers")
            self.set_basis('blocked', blocked_by='brother')
        elif calc.has_sister():
            asaba = calc.get_sisters().filter(asaba=True)
            if asaba:
                self.blocked = True
                self.quote_reason = _("Paternal brother/s are blocked by sisters")
                self.set_basis('blocked', blocked_by='sisters')
            else:
                self.asaba = True
                self.quote_reason = _("Paternal brother/s share the remainder or all amount if no other heir exist")
                self.set_basis('residuary')
        else:
            self.asaba =  True
            self.quote_reason = _("Paternal brother/s share the remainder or all amount if no other heir exist")
            self.set_basis('residuary')
        self.save()
        return self.quote

class MaternalSister(Heir):
    """MaternalSister Class"""
    def add(self, calc):
        calc.deceased_set.first().add_maternalSister(sister=self)

    def get_quote(self, calc):
        maternalSisters = calc.heir_set.instance_of(MaternalSister)
        if maternalSisters.count() > 1:
            self.shared_quote = True
        if calc.has_descendent():
            self.blocked = True
            self.quote_reason = _("Maternal sister/s are blocked by descendant")
            self.set_basis('blocked', blocked_by='descendant')
        elif calc.has_father():
            self.blocked = True
            self.quote_reason = _("Maternal sister/s are blocked by father")
            self.set_basis('blocked', blocked_by='father')
        elif calc.has_grandFather():
            self.blocked = True
            self.quote_reason = _("Maternal sister/s are blocked by grandfather")
            self.set_basis('blocked', blocked_by='grandfather')
        elif calc.has_maternalBrother():
            calc.maternal_quote = True
            calc.save()
            self.shared_quote = True
            self.set_quote(Fraction(1, 3))
            self.quote_reason = _("Maternal sister/s with maternal brother/s share 1/3")
            self.set_basis('fixed', 'with_maternal_siblings')
        elif maternalSisters.count() == 1:
            self.set_quote(Fraction(1, 6))
            self.quote_reason = _("Maternal sister get 1/6")
            self.set_basis('fixed', 'single')
        else:
            self.set_quote(Fraction(1, 3))
            self.quote_reason = _("Maternal sisters share 1/3")
            self.set_basis('fixed', 'several')
        self.save()
        return self.quote

class MaternalBrother(Heir):
    """MaternalBrother Class"""
    def add(self, calc):
        calc.deceased_set.first().add_maternalBrother(brother=self)

    def get_quote(self, calc):
        MaternalBrothers = calc.heir_set.instance_of(MaternalBrother)
        if MaternalBrothers.count() > 1:
            self.shared_quote = True
        if calc.has_descendent():
            self.blocked = True
            self.quote_reason = _("Maternal brother/s are blocked by descendant")
            self.set_basis('blocked', blocked_by='descendant')
        elif calc.has_father():
            self.blocked = True
            self.quote_reason = _("Maternal brother/s are blocked by father")
            self.set_basis('blocked', blocked_by='father')
        elif calc.has_grandFather():
            self.blocked = True
            self.quote_reason = _("Maternal brother/s are blocked by grandfather")
            self.set_basis('blocked', blocked_by='grandfather')
        elif calc.has_maternalSister():
            calc.maternal_quote = True
            calc.save()
            self.shared_quote = True
            self.set_quote(Fraction(1, 3))
            self.quote_reason = _("Maternal brother/s with maternal sister/s share 1/3")
            self.set_basis('fixed', 'with_maternal_siblings')
        elif MaternalBrothers.count() == 1:
            self.set_quote(Fraction(1, 6))
            self.quote_reason = _("Maternal brother get 1/6")
            self.set_basis('fixed', 'single')
        else:
            self.set_quote(Fraction(1, 3))
            self.quote_reason = _("Maternal brothers share 1/3")
            self.set_basis('fixed', 'several')
        self.save()
        return self.quote

class SonOfBrother(Heir):
    """Son of Brother class"""
    def add(self, calc):
        calc.deceased_set.first().add_sonOfBrother(sonOfBrother=self)

    def get_quote(self, calc):
        sonsOfBrother = calc.heir_set.instance_of(SonOfBrother)
        if sonsOfBrother.count() > 1:
            self.shared_quote = True
        if calc.has_male_descendent():
            self.blocked = True
            self.quote_reason = _("Son/s of Brother are blocked by male descendant")
            self.set_basis('blocked', blocked_by='male_descendant')
        elif calc.has_father():
            self.blocked = True
            self.quote_reason = _("Son/s of Brother are blocked by father")
            self.set_basis('blocked', blocked_by='father')
        elif calc.has_grandFather():
            self.blocked = True
            self.quote_reason = _("Son/s of Brother are blocked by grandfather")
            self.set_basis('blocked', blocked_by='grandfather')
        elif calc.has_brother():
            self.blocked = True
            self.quote_reason = _("Son/s of Brother are blocked by brother/s")
            self.set_basis('blocked', blocked_by='brother')
        elif calc.get_sisters().filter(asaba=True):
            self.blocked = True
            self.quote_reason = _("Son/s of Brother are blocked by sisters")
            self.set_basis('blocked', blocked_by='sisters')
        elif calc.has_paternalBrother():
            self.blocked = True
            self.quote_reason = _("Son/s of Brother are blocked by paternal brother/s")
            self.set_basis('blocked', blocked_by='paternal_brother')
        elif calc.get_paternalSisters().filter(asaba=True):
            self.blocked = True
            self.quote_reason = _("Son/s of Brother are blocked by paternal sister/s")
            self.set_basis('blocked', blocked_by='paternal_sister')
        else:
            self.asaba =  True
            self.quote_reason = _("Son/s of Brother share the remainder or all amount if no other heir exist")
            self.set_basis('residuary')
        self.save()
        return self.quote

class SonOfPaternalBrother(Heir):
    """Son of Paternal Brother class"""
    def add(self, calc):
        calc.deceased_set.first().add_sonOfPaternalBrother(sonOfPaternalBrother=self)

    def get_quote(self, calc):
        sonsOfPaternalBrother = calc.heir_set.instance_of(SonOfPaternalBrother)
        if sonsOfPaternalBrother.count() > 1:
            self.shared_quote = True
        if calc.has_male_descendent():
            self.blocked = True
            self.quote_reason = _("Son/s of Paternal Brother are blocked by male descendant")
            self.set_basis('blocked', blocked_by='male_descendant')
        elif calc.has_father():
            self.blocked = True
            self.quote_reason = _("Son/s of Paternal Brother are blocked by father")
            self.set_basis('blocked', blocked_by='father')
        elif calc.has_grandFather():
            self.blocked = True
            self.quote_reason = _("Son/s of Paternal Brother are blocked by grandfather")
            self.set_basis('blocked', blocked_by='grandfather')
        elif calc.has_brother():
            self.blocked = True
            self.quote_reason = _("Son/s of Paternal Brother are blocked by brother/s")
            self.set_basis('blocked', blocked_by='brother')
        elif calc.get_sisters().filter(asaba=True):
            self.blocked = True
            self.quote_reason = _("Son/s of Paternal Brother are blocked by sisters")
            self.set_basis('blocked', blocked_by='sisters')
        elif calc.has_paternalBrother():
            self.blocked = True
            self.quote_reason = _("Son/s of Paternal Brother are blocked by paternal brother/s")
            self.set_basis('blocked', blocked_by='paternal_brother')
        elif calc.get_paternalSisters().filter(asaba=True):
            self.blocked = True
            self.quote_reason = _("Son/s of Paternal Brother are blocked by paternal sister/s")
            self.set_basis('blocked', blocked_by='paternal_sister')
        elif calc.has_sonOfBrother():
            self.blocked = True
            self.quote_reason = _("Son/s of Paternal Brother are blocked by sons of brother")
            self.set_basis('blocked', blocked_by='son_of_brother')
        else:
            self.asaba =  True
            self.quote_reason = _("Son/s of Paternal Brother share the remainder or all amount if no other heir exist")
            self.set_basis('residuary')
        self.save()
        return self.quote

class Uncle(Heir):
    """Uncle class"""
    def add(self, calc):
        calc.deceased_set.first().add_uncle(uncle=self)

    def get_quote(self, calc):
        uncles = calc.heir_set.instance_of(Uncle)
        if uncles.count() > 1:
            self.shared_quote = True
        if calc.has_male_descendent():
            self.blocked = True
            self.quote_reason = _("Uncle/s are blocked by male descendant")
            self.set_basis('blocked', blocked_by='male_descendant')
        elif calc.has_father():
            self.blocked = True
            self.quote_reason = _("Uncle/s are blocked by father")
            self.set_basis('blocked', blocked_by='father')
        elif calc.has_grandFather():
            self.blocked = True
            self.quote_reason = _("Uncle/s are blocked by grandfather")
            self.set_basis('blocked', blocked_by='grandfather')
        elif calc.has_brother():
            self.blocked = True
            self.quote_reason = _("Uncle/s are blocked by brother/s")
            self.set_basis('blocked', blocked_by='brother')
        elif calc.get_sisters().filter(asaba=True):
            self.blocked = True
            self.quote_reason = _("Uncle/s are blocked by sisters")
            self.set_basis('blocked', blocked_by='sisters')
        elif calc.has_paternalBrother():
            self.blocked = True
            self.quote_reason = _("Uncle/s are blocked by paternal brother/s")
            self.set_basis('blocked', blocked_by='paternal_brother')
        elif calc.get_paternalSisters().filter(asaba=True):
            self.blocked = True
            self.quote_reason = _("Uncle/s are blocked by paternal sister/s")
            self.set_basis('blocked', blocked_by='paternal_sister')
        elif calc.has_sonOfBrother():
            self.blocked = True
            self.quote_reason = _("Uncle/s are blocked by sons of brother")
            self.set_basis('blocked', blocked_by='son_of_brother')
        elif calc.has_sonOfPaternalBrother():
            self.blocked = True
            self.quote_reason = _("Uncle/s are blocked by sons of paternal brother")
            self.set_basis('blocked', blocked_by='son_of_paternal_brother')
        else:
            self.asaba =  True
            self.quote_reason = _("Uncle/s share the remainder or all amount if no other heir exist")
            self.set_basis('residuary')
        self.save()
        return self.quote

class PaternalUncle(Heir):
    """Paternal Uncle class"""
    def add(self, calc):
        calc.deceased_set.first().add_paternalUncle(uncle=self)

    def get_quote(self, calc):
        paternalUncles = calc.heir_set.instance_of(PaternalUncle)
        if paternalUncles.count() > 1:
            self.shared_quote = True
        if calc.has_male_descendent():
            self.blocked = True
            self.quote_reason = _("Paternal Uncle/s are blocked by male descendant")
            self.set_basis('blocked', blocked_by='male_descendant')
        elif calc.has_father():
            self.blocked = True
            self.quote_reason = _("Paternal Uncle/s are blocked by father")
            self.set_basis('blocked', blocked_by='father')
        elif calc.has_grandFather():
            self.blocked = True
            self.quote_reason = _("Paternal Uncle/s are blocked by grandfather")
            self.set_basis('blocked', blocked_by='grandfather')
        elif calc.has_brother():
            self.blocked = True
            self.quote_reason = _("Paternal Uncle/s are blocked by brother/s")
            self.set_basis('blocked', blocked_by='brother')
        elif calc.get_sisters().filter(asaba=True):
            self.blocked = True
            self.quote_reason = _("Paternal Uncle/s are blocked by sisters")
            self.set_basis('blocked', blocked_by='sisters')
        elif calc.has_paternalBrother():
            self.blocked = True
            self.quote_reason = _("Paternal Uncle/s are blocked by paternal brother/s")
            self.set_basis('blocked', blocked_by='paternal_brother')
        elif calc.get_paternalSisters().filter(asaba=True):
            self.blocked = True
            self.quote_reason = _("Paternal Uncle/s are blocked by paternal sister/s")
            self.set_basis('blocked', blocked_by='paternal_sister')
        elif calc.has_sonOfBrother():
            self.blocked = True
            self.quote_reason = _("Paternal Uncle/s are blocked by sons of brother")
            self.set_basis('blocked', blocked_by='son_of_brother')
        elif calc.has_sonOfPaternalBrother():
            self.blocked = True
            self.quote_reason = _("Paternal Uncle/s are blocked by sons of paternal brother")
            self.set_basis('blocked', blocked_by='son_of_paternal_brother')
        elif calc.has_uncle():
            self.blocked = True
            self.quote_reason = _("Paternal Uncle/s are blocked by uncle/s")
            self.set_basis('blocked', blocked_by='uncle')
        else:
            self.asaba =  True
            self.quote_reason = _("Paternal Uncle/s share the remainder or all amount if no other heir exist")
            self.set_basis('residuary')
        self.save()
        return self.quote

class SonOfUncle(Heir):
    """Son of Uncle class"""
    def add(self, calc):
        calc.deceased_set.first().add_sonOfUncle(sonOfUncle=self)

    def get_quote(self, calc):
        sonsOfUncle = calc.heir_set.instance_of(SonOfUncle)
        if sonsOfUncle.count() > 1:
            self.shared_quote = True
        if calc.has_male_descendent():
            self.blocked = True
            self.quote_reason = _("Son/s of uncle are blocked by male descendant")
            self.set_basis('blocked', blocked_by='male_descendant')
        elif calc.has_father():
            self.blocked = True
            self.quote_reason = _("Son/s of Uncle/s are blocked by father")
            self.set_basis('blocked', blocked_by='father')
        elif calc.has_grandFather():
            self.blocked = True
            self.quote_reason = _("Son/s of Uncle/s are blocked by grandfather")
            self.set_basis('blocked', blocked_by='grandfather')
        elif calc.has_brother():
            self.blocked = True
            self.quote_reason = _("Son/s of Uncle/s are blocked by brother/s")
            self.set_basis('blocked', blocked_by='brother')
        elif calc.get_sisters().filter(asaba=True):
            self.blocked = True
            self.quote_reason = _("Son/s of Uncle/s are blocked by sisters")
            self.set_basis('blocked', blocked_by='sisters')
        elif calc.has_paternalBrother():
            self.blocked = True
            self.quote_reason = _("Son/s of Uncle/s are blocked by paternal brother/s")
            self.set_basis('blocked', blocked_by='paternal_brother')
        elif calc.get_paternalSisters().filter(asaba=True):
            self.blocked = True
            self.quote_reason = _("Son/s of Uncle/s are blocked by paternal sister/s")
            self.set_basis('blocked', blocked_by='paternal_sister')
        elif calc.has_sonOfBrother():
            self.blocked = True
            self.quote_reason = _("Son/s of Uncle/s are blocked by sons of brother")
            self.set_basis('blocked', blocked_by='son_of_brother')
        elif calc.has_sonOfPaternalBrother():
            self.blocked = True
            self.quote_reason = _("Son/s of Uncle/s are blocked by sons of paternal brother")
            self.set_basis('blocked', blocked_by='son_of_paternal_brother')
        elif calc.has_uncle():
            self.blocked = True
            self.quote_reason = _("Son/s of Uncle/s are blocked by uncle/s")
            self.set_basis('blocked', blocked_by='uncle')
        elif calc.has_paternalUncle():
            self.blocked = True
            self.quote_reason = _("Son/s of Uncle/s are blocked by paternal uncle/s")
            self.set_basis('blocked', blocked_by='paternal_uncle')
        else:
            self.asaba =  True
            self.quote_reason = _("Son/s of Uncle/s share the remainder or all amount if no other heir exist")
            self.set_basis('residuary')
        self.save()
        return self.quote

class SonOfPaternalUncle(Heir):
    """Son of Paternal Uncle class"""
    def add(self, calc):
        calc.deceased_set.first().add_sonOfPaternalUncle(sonOfPaternalUncle=self)

    def get_quote(self, calc):
        sonsOfPaternalUncle = calc.heir_set.instance_of(SonOfPaternalUncle)
        if sonsOfPaternalUncle.count() > 1:
            self.shared_quote = True
        if calc.has_male_descendent():
            self.blocked = True
            self.quote_reason = _("Son/s of paternal uncle are blocked by male descendant")
            self.set_basis('blocked', blocked_by='male_descendant')
        elif calc.has_father():
            self.blocked = True
            self.quote_reason = _("Son/s of paternal Uncle/s are blocked by father")
            self.set_basis('blocked', blocked_by='father')
        elif calc.has_grandFather():
            self.blocked = True
            self.quote_reason = _("Son/s of paternal Uncle/s are blocked by grandfather")
            self.set_basis('blocked', blocked_by='grandfather')
        elif calc.has_brother():
            self.blocked = True
            self.quote_reason = _("Son/s of paternal Uncle/s are blocked by brother/s")
            self.set_basis('blocked', blocked_by='brother')
        elif calc.get_sisters().filter(asaba=True):
            self.blocked = True
            self.quote_reason = _("Son/s of paternal Uncle/s are blocked by sisters")
            self.set_basis('blocked', blocked_by='sisters')
        elif calc.has_paternalBrother():
            self.blocked = True
            self.quote_reason = _("Son/s of paternal Uncle/s are blocked by paternal brother/s")
            self.set_basis('blocked', blocked_by='paternal_brother')
        elif calc.get_paternalSisters().filter(asaba=True):
            self.blocked = True
            self.quote_reason = _("Son/s of paternal Uncle/s are blocked by paternal sister/s")
            self.set_basis('blocked', blocked_by='paternal_sister')
        elif calc.has_sonOfBrother():
            self.blocked = True
            self.quote_reason = _("Son/s of paternal Uncle/s are blocked by sons of brother")
            self.set_basis('blocked', blocked_by='son_of_brother')
        elif calc.has_sonOfPaternalBrother():
            self.blocked = True
            self.quote_reason = _("Son/s of paternal Uncle/s are blocked by sons of paternal brother")
            self.set_basis('blocked', blocked_by='son_of_paternal_brother')
        elif calc.has_uncle():
            self.blocked = True
            self.quote_reason = _("Son/s of paternal Uncle/s are blocked by uncle/s")
            self.set_basis('blocked', blocked_by='uncle')
        elif calc.has_paternalUncle():
            self.blocked = True
            self.quote_reason = _("Son/s of paternal Uncle/s are blocked by paternal uncle/s")
            self.set_basis('blocked', blocked_by='paternal_uncle')
        elif calc.has_sonOfUncle():
            self.blocked = True
            self.quote_reason = _("Son/s of paternal Uncle/s are blocked by son/s of uncle/s")
            self.set_basis('blocked', blocked_by='son_of_uncle')
        else:
            self.asaba =  True
            self.quote_reason = _("Son/s of paternal Uncle/s share the remainder or all amount if no other heir exist")
            self.set_basis('residuary')
        self.save()
        return self.quote


# The order heirs are classified in: descendants, ascendants and spouses,
# siblings, then nephews and uncles. A heir only depends on those before it.
FIQH_ORDER = [
    Son, Daughter, SonOfSon, DaughterOfSon,
    Father, GrandFather, Mother, GrandMother, MaternalGrandMother, Husband, Wife,
    Brother, Sister, PaternalBrother, PaternalSister, MaternalBrother, MaternalSister,
    SonOfBrother, SonOfPaternalBrother, Uncle, PaternalUncle, SonOfUncle, SonOfPaternalUncle,
]
MALE_HEIRS = (
    Father, GrandFather, Husband, Son, SonOfSon, Brother, PaternalBrother, MaternalBrother,
    SonOfBrother, SonOfPaternalBrother, Uncle, PaternalUncle, SonOfUncle, SonOfPaternalUncle,
)
