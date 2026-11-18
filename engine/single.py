"""The single-estate School fiqh, in memory: classify every heir, then share the estate.

A port of `Calculation.get_quotes` / `get_quote` and `Calculation.distribute` from `calc/models.py`,
over plain heirs keyed by their stable person ids. Branch order, classification order, group, column,
awl, radd and correction arithmetic and every `round()` are kept exactly, so the answers are the same.
There is no display text here, only codes, Fractions and ints.

Where the schools differ, the position is read from the RuleSet's rule values, never from the
School's name. The `has_*` and count queries include blocked heirs, as the ORM queries did.
"""
import math
from dataclasses import dataclass
from fractions import Fraction
from typing import Dict, List, Optional, Tuple

from . import proof

ZERO = Fraction(0)
ONE = Fraction(1)

MALE = frozenset({
    'father', 'grandfather', 'husband', 'son', 'son_of_son', 'brother', 'paternal_brother', 'maternal_brother',
    'son_of_brother', 'son_of_paternal_brother', 'uncle', 'paternal_uncle', 'son_of_uncle', 'son_of_paternal_uncle',
})
# The order heirs are classified in: descendants, ascendants and spouses, siblings, then nephews and
# uncles. A heir only depends on those before it; ties keep the order of entry.
FIQH_ORDER = (
    'son', 'daughter', 'son_of_son', 'daughter_of_son',
    'father', 'grandfather', 'mother', 'paternal_grandmother', 'maternal_grandmother', 'husband', 'wife',
    'brother', 'sister', 'paternal_brother', 'paternal_sister', 'maternal_brother', 'maternal_sister',
    'son_of_brother', 'son_of_paternal_brother', 'uncle', 'paternal_uncle', 'son_of_uncle', 'son_of_paternal_uncle',
)
SIBLINGS = ('brother', 'sister', 'paternal_brother', 'paternal_sister', 'maternal_brother', 'maternal_sister')
GRANDMOTHERS = ('paternal_grandmother', 'maternal_grandmother')
SPOUSES = ('husband', 'wife')
MUSHTARAKA_FAMILY = frozenset({
    'husband', 'mother', 'paternal_grandmother', 'maternal_grandmother', 'maternal_brother', 'maternal_sister',
    'brother', 'sister',
})


class Refused(Exception):
    """The engine will not give a number for this family. `reason` is a stable refusal code."""

    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)


class Heir:
    """One heir in memory. `id` is the stable person id; `rel` is the relationship code."""

    def __init__(self, id, rel):
        self.id = id
        self.rel = rel
        self.quote = ZERO
        self.asaba = False
        self.blocked = False
        self.basis = None
        self.share = 0
        self.shorted_share = 0
        self.shortage_calc_share = 0
        self.shortage_union_share = 0
        self.corrected_share = 0

    def is_male(self):
        return self.rel in MALE

    def set_basis(self, rule, condition=None, blocked_by=None, option=None):
        self.basis = {
            'rule': rule, 'condition': condition, 'blocked_by': blocked_by,
            'fraction': self.quote if rule in proof.FRACTION_RULES else None,
            'school_rule': None, 'option': option,
        }


class Group:
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
        mixed = len({h.is_male() for h in self.members}) > 1
        self.weights = [2 if (mixed and h.is_male()) else 1 for h in self.members]

    def is_spouse(self):
        return isinstance(self.key, tuple) and self.key[1] in SPOUSES

    def column(self, base, amount):
        """Each member's whole number of parts of `base`. When the group's parts do not divide, every
        member shows the group's total instead and the result is flagged as needing a correction."""
        total_weight = sum(self.weights)
        values = [amount * weight * base / total_weight for weight in self.weights]
        if all(value.denominator == 1 for value in values):
            return [int(value) for value in values], False
        return [round(amount * base)] * len(values), True


def lcm_list(numbers):
    result = numbers[0]
    for number in numbers[1:]:
        result = abs(result * number) // math.gcd(result, number)
    return result


class Case:
    """The heirs of one estate, the positions to follow, and the queries the fiqh asks of them."""

    def __init__(self, heirs, rules):
        self.heirs = heirs
        self.rules = rules
        self.maternal_quote = False

    # -- School positions, from the rule values -------------------------------------------------
    def grandfather_blocks_siblings(self):
        return self.rules['grandfather_with_siblings'] == 'blocks'

    def father_blocks_his_mother(self):
        return self.rules['father_blocks_his_mother']

    # -- counts include blocked heirs ------------------------------------------------------------
    def count(self, *rels):
        return sum(1 for h in self.heirs if h.rel in rels)

    def has(self, *rels):
        return self.count(*rels) > 0

    def has_male_descendent(self):
        return self.has('son', 'son_of_son')

    def has_female_descendent(self):
        return self.has('daughter', 'daughter_of_son')

    def has_descendent(self):
        return self.has_male_descendent() or self.has_female_descendent()

    def has_siblings(self):
        return self.count(*SIBLINGS) > 1

    def has_spouse(self):
        return self.has(*SPOUSES)

    def any_asaba(self, *rels):
        return any(h.asaba for h in self.heirs if h.rel in rels)

    def grandmother_count(self):
        count = self.count('maternal_grandmother')
        if not (self.has('father') and self.father_blocks_his_mother()):
            count += self.count('paternal_grandmother')
        return count

    def gf_meets_siblings(self):
        """A grandfather and full or paternal siblings, and nobody else to decide between them."""
        return (self.has('grandfather') and not self.has('father') and not self.has_male_descendent()
                and self.has('brother', 'sister', 'paternal_brother', 'paternal_sister'))

    def gf_shares_with_siblings(self):
        return not self.grandfather_blocks_siblings() and self.gf_meets_siblings()

    def paternal_siblings_counted_out(self):
        paternal = self.has('paternal_brother', 'paternal_sister')
        return (self.gf_shares_with_siblings() and paternal
                and (self.has('brother') or (self.has('sister') and self.has_female_descendent())))

    def live_counts(self):
        """How many heirs of each relationship are not blocked."""
        counts = {}
        for heir in self.heirs:
            if not heir.blocked:
                counts[heir.rel] = counts.get(heir.rel, 0) + 1
        return counts

    def is_mushtaraka_family(self, live):
        """Husband, mother or grandmother(s), two or more maternal siblings and a full brother."""
        if not set(live) <= MUSHTARAKA_FAMILY:
            return False
        maternal = live.get('maternal_brother', 0) + live.get('maternal_sister', 0)
        return (live.get('husband', 0) == 1
                and live.get('mother', 0) + live.get('paternal_grandmother', 0)
                + live.get('maternal_grandmother', 0) >= 1
                and maternal >= 2
                and live.get('brother', 0) >= 1)

    def has_mushtaraka(self, live):
        return bool(self.rules['mushtaraka']) and self.is_mushtaraka_family(live)

    def is_malikiyya_family(self, live, maternal_count):
        return (bool(self.rules['malikiyya_disputed'])
                and live.get('husband', 0) == 1
                and live.get('mother', 0) + live.get('paternal_grandmother', 0)
                + live.get('maternal_grandmother', 0) >= 1
                and live.get('grandfather', 0) == 1
                and live.get('paternal_brother', 0) >= 1
                and maternal_count >= 2)

    def is_akdariyya(self, live):
        """Husband, mother, grandfather and one full or paternal sister, and no other heir."""
        if len(live) != 4:
            return False
        husband = [h for h in live if h.rel == 'husband']
        mother = [h for h in live if h.rel == 'mother']
        sisters = [h for h in live if h.rel in ('sister', 'paternal_sister')]
        grandfather = [h for h in live if h.rel == 'grandfather']
        return (len(husband) == 1 and len(mother) == 1 and len(sisters) == 1 and len(grandfather) == 1
                and husband[0].quote == Fraction(1, 2) and mother[0].quote == Fraction(1, 3))

    # -- classification --------------------------------------------------------------------------
    def classify(self):
        """Classify every heir in the fixed fiqh order. Returns the heirs in that order."""
        self.heirs.sort(key=lambda h: FIQH_ORDER.index(h.rel))  # stable: ties keep the order of entry
        for heir in self.heirs:
            getattr(self, 'quote_' + heir.rel)(heir)
        return self.heirs

    def block(self, heir, by):
        heir.blocked = True
        heir.set_basis('blocked', blocked_by=by)

    def quote_father(self, h):
        if self.has_male_descendent():
            h.quote = Fraction(1, 6)
            h.set_basis('fixed', 'male_descendant')
        elif self.has_female_descendent():
            h.quote = Fraction(1, 6)
            h.set_basis('fixed_and_residuary', 'female_descendant')
        else:
            h.asaba = True
            h.set_basis('residuary', 'no_descendant')

    def quote_mother(self, h):
        if self.has_descendent():
            h.quote = Fraction(1, 6)
            h.set_basis('fixed', 'descendant')
        elif self.has_siblings():
            h.quote = Fraction(1, 6)
            h.set_basis('fixed', 'siblings')
        elif self.has_spouse() and self.has('father'):
            # the family holds no sex for the deceased: a wife means a male deceased
            h.quote = Fraction(1, 4) if self.has('wife') else Fraction(1, 6)
            h.set_basis('fixed', 'spouse_and_father')
        else:
            h.quote = Fraction(1, 3)
            h.set_basis('fixed', 'no_descendant_or_siblings')

    def quote_husband(self, h):
        if self.has_descendent():
            h.quote = Fraction(1, 4)
            h.set_basis('fixed', 'descendant')
        else:
            h.quote = Fraction(1, 2)
            h.set_basis('fixed', 'no_descendant')

    def quote_wife(self, h):
        if self.has_descendent():
            h.quote = Fraction(1, 8)
            h.set_basis('fixed', 'descendant')
        else:
            h.quote = Fraction(1, 4)
            h.set_basis('fixed', 'no_descendant')

    def quote_daughter(self, h):
        if self.has('son'):
            h.asaba = True
            h.set_basis('residuary', 'with_son')
        elif self.count('daughter') == 1:
            h.quote = Fraction(1, 2)
            h.set_basis('fixed', 'single')
        else:
            h.quote = Fraction(2, 3)
            h.set_basis('fixed', 'several')

    def quote_son(self, h):
        h.asaba = True
        h.set_basis('residuary')

    def quote_brother(self, h):
        if self.has_male_descendent():
            self.block(h, 'male_descendant')
        elif self.has('father'):
            self.block(h, 'father')
        elif self.has('grandfather') and self.grandfather_blocks_siblings():
            self.block(h, 'grandfather')
        elif self.has('grandfather'):
            h.asaba = True
            h.set_basis('residuary', 'with_grandfather')
        else:
            h.asaba = True
            h.set_basis('residuary')

    def quote_sister(self, h):
        if self.has_male_descendent():
            self.block(h, 'male_descendant')
        elif self.has('father'):
            self.block(h, 'father')
        elif self.has('grandfather') and self.grandfather_blocks_siblings():
            self.block(h, 'grandfather')
        elif self.has('grandfather'):
            h.asaba = True
            h.set_basis('residuary', 'with_grandfather')
        elif self.has('brother'):
            h.asaba = True
            h.set_basis('residuary', 'with_brother')
        elif self.has_female_descendent():
            h.asaba = True
            h.set_basis('residuary', 'female_descendant')
        elif self.count('sister') == 1:
            h.quote = Fraction(1, 2)
            h.set_basis('fixed', 'single')
        else:
            h.quote = Fraction(2, 3)
            h.set_basis('fixed', 'several')

    def quote_grandfather(self, h):
        if self.has('father'):
            self.block(h, 'father')
        elif self.has_male_descendent():
            h.quote = Fraction(1, 6)
            h.set_basis('fixed', 'male_descendant')
        elif self.gf_shares_with_siblings():
            h.set_basis('grandfather_best_option', 'with_siblings')
        elif self.has_female_descendent():
            h.quote = Fraction(1, 6)
            h.set_basis('fixed_and_residuary', 'female_descendant')
        else:
            h.asaba = True
            h.set_basis('residuary', 'no_descendant')

    def quote_paternal_grandmother(self, h):
        if self.has('mother'):
            self.block(h, 'mother')
        elif self.has('father') and self.father_blocks_his_mother():
            self.block(h, 'father')
        else:
            h.quote = Fraction(1, 6)
            h.set_basis('fixed', 'no_mother')

    def quote_maternal_grandmother(self, h):
        if self.has('mother'):
            self.block(h, 'mother')
        else:
            h.quote = Fraction(1, 6)
            h.set_basis('fixed', 'no_mother')

    def quote_son_of_son(self, h):
        if self.has('son'):
            self.block(h, 'son')
        else:
            h.asaba = True
            h.set_basis('residuary')

    def quote_daughter_of_son(self, h):
        if self.has('son'):
            self.block(h, 'son')
        elif self.has('son_of_son'):
            h.asaba = True
            h.set_basis('residuary', 'with_son_of_son')
        elif self.has('daughter'):
            if self.count('daughter') == 1:
                h.quote = Fraction(1, 6)
                h.set_basis('fixed', 'with_daughter')
            else:
                self.block(h, 'daughters')
        elif self.count('daughter_of_son') == 1:
            h.quote = Fraction(1, 2)
            h.set_basis('fixed', 'single')
        else:
            h.quote = Fraction(2, 3)
            h.set_basis('fixed', 'several')

    def quote_paternal_sister(self, h):
        if self.has_male_descendent():
            self.block(h, 'male_descendant')
        elif self.has('father'):
            self.block(h, 'father')
        elif self.has('grandfather') and self.grandfather_blocks_siblings():
            self.block(h, 'grandfather')
        elif self.has('grandfather'):
            h.asaba = True
            h.set_basis('residuary', 'with_grandfather')
        elif self.has('brother'):
            self.block(h, 'brother')
        elif self.any_asaba('sister'):
            self.block(h, 'sisters')
        elif self.has('paternal_brother'):
            h.asaba = True
            h.set_basis('residuary', 'with_paternal_brother')
        elif self.has('sister'):
            if self.count('sister') == 1:
                h.quote = Fraction(1, 6)
                h.set_basis('fixed', 'with_sister')
            else:
                self.block(h, 'sisters')
        elif self.has_female_descendent():
            h.asaba = True
            h.set_basis('residuary', 'female_descendant')
        elif self.count('paternal_sister') == 1:
            h.quote = Fraction(1, 2)
            h.set_basis('fixed', 'single')
        else:
            h.quote = Fraction(2, 3)
            h.set_basis('fixed', 'several')

    def quote_paternal_brother(self, h):
        if self.has_male_descendent():
            self.block(h, 'male_descendant')
        elif self.has('father'):
            self.block(h, 'father')
        elif self.has('grandfather') and self.grandfather_blocks_siblings():
            self.block(h, 'grandfather')
        elif self.has('grandfather'):
            h.asaba = True
            h.set_basis('residuary', 'with_grandfather')
        elif self.has('brother'):
            self.block(h, 'brother')
        elif self.has('sister'):
            if self.any_asaba('sister'):
                self.block(h, 'sisters')
            else:
                h.asaba = True
                h.set_basis('residuary')
        else:
            h.asaba = True
            h.set_basis('residuary')

    def quote_maternal_sister(self, h):
        self._maternal(h, 'maternal_brother', 'maternal_sister')

    def quote_maternal_brother(self, h):
        self._maternal(h, 'maternal_sister', 'maternal_brother')

    def _maternal(self, h, other, own):
        if self.has_descendent():
            self.block(h, 'descendant')
        elif self.has('father'):
            self.block(h, 'father')
        elif self.has('grandfather'):
            self.block(h, 'grandfather')
        elif self.has(other):
            self.maternal_quote = True
            h.quote = Fraction(1, 3)
            h.set_basis('fixed', 'with_maternal_siblings')
        elif self.count(own) == 1:
            h.quote = Fraction(1, 6)
            h.set_basis('fixed', 'single')
        else:
            h.quote = Fraction(1, 3)
            h.set_basis('fixed', 'several')

    def _later_relative(self, h, extra):
        """The nephews and uncles: blocked by the first of the same chain that is present, then by
        the relatives of `extra`, in order; otherwise residuary."""
        if self.has_male_descendent():
            self.block(h, 'male_descendant')
        elif self.has('father'):
            self.block(h, 'father')
        elif self.has('grandfather'):
            self.block(h, 'grandfather')
        elif self.has('brother'):
            self.block(h, 'brother')
        elif self.any_asaba('sister'):
            self.block(h, 'sisters')
        elif self.has('paternal_brother'):
            self.block(h, 'paternal_brother')
        elif self.any_asaba('paternal_sister'):
            self.block(h, 'paternal_sister')
        else:
            for rel in extra:
                if self.has(rel):
                    self.block(h, rel)
                    return
            h.asaba = True
            h.set_basis('residuary')

    def quote_son_of_brother(self, h):
        self._later_relative(h, ())

    def quote_son_of_paternal_brother(self, h):
        self._later_relative(h, ('son_of_brother',))

    def quote_uncle(self, h):
        self._later_relative(h, ('son_of_brother', 'son_of_paternal_brother'))

    def quote_paternal_uncle(self, h):
        self._later_relative(h, ('son_of_brother', 'son_of_paternal_brother', 'uncle'))

    def quote_son_of_uncle(self, h):
        self._later_relative(h, ('son_of_brother', 'son_of_paternal_brother', 'uncle', 'paternal_uncle'))

    def quote_son_of_paternal_uncle(self, h):
        self._later_relative(h, ('son_of_brother', 'son_of_paternal_brother', 'uncle', 'paternal_uncle',
                                 'son_of_uncle'))

    # -- distribution ----------------------------------------------------------------------------
    def distribute(self):
        """Share the estate between the classified heirs, with exact fractions. Returns
        (final fractions by id, the table or None, the proof's step facts)."""
        heirs = self.heirs
        zero, one = ZERO, ONE
        live = [h for h in heirs if not h.blocked]
        gf_mode = self.gf_shares_with_siblings()
        sibs = [h for h in live if h.rel in ('brother', 'sister', 'paternal_brother', 'paternal_sister')] if gf_mode else []
        sib_ids = {h.id for h in sibs}
        mushtaraka = []
        if self.has_mushtaraka(self.live_counts()):
            mushtaraka = [h for h in live if h.rel in ('brother', 'sister', 'maternal_brother', 'maternal_sister')]
        mushtaraka_ids = {h.id for h in mushtaraka}

        # fixed shares, one group per type (maternal siblings share one group)
        reasons_pending = []
        fixed = {}
        for heir in live:
            if heir.asaba or heir.id in sib_ids or heir.id in mushtaraka_ids or (gf_mode and heir.rel == 'grandfather'):
                continue
            quote = heir.quote
            if quote <= 0:
                continue
            if self.maternal_quote and heir.rel in ('maternal_brother', 'maternal_sister'):
                key = 'maternal'
            elif heir.rel in GRANDMOTHERS:
                key = 'grandmother'
            else:
                key = ('type', heir.rel)
            if key not in fixed:
                fixed[key] = Group(key, quote)
            fixed[key].add(heir)
        groups = list(fixed.values())
        if mushtaraka:
            # the full siblings join the maternal siblings, and all of them share the third equally
            group = Group('mushtaraka', Fraction(1, 3), kind='mushtaraka')
            for heir in mushtaraka:
                group.add(heir, 1)
                group.prescribed[heir.id] = Fraction(1, 3)
                heir.asaba = False
                reasons_pending.append(heir)
            groups.append(group)
        fixed_total = sum((g.amount for g in groups), zero)

        extra = None          # father or grandfather who also takes the remainder
        extra_remainder = zero
        radd_groups = []
        # what each overridden reason rests on, for the proof: id -> (rule, condition, option)
        bases = {heir.id: (proof.MUSHTARAKA, None, None) for heir in reasons_pending}
        residual = zero
        if gf_mode:
            grandfather = next(h for h in live if h.rel == 'grandfather')
            left = max(zero, one - fixed_total)
            units = sum(2 if h.is_male() else 1 for h in sibs)
            options = [
                (left * 2 / (2 + units), 'muqasama'),
                (left / 3, 'third_of_remainder'),
                (Fraction(1, 6), 'sixth_of_estate'),
            ]
            grandfather_amount, grandfather_option = max(options, key=lambda option: option[0])
            pool = max(zero, left - grandfather_amount)
            if self.is_akdariyya(live):
                group = Group('akdariyya', grandfather_amount + Fraction(1, 2), kind='akdariyya')
                group.add(grandfather, 2)
                group.add(sibs[0], 1)
                # the scholars' table shows each one's own share before they are pooled
                group.prescribed = {grandfather.id: grandfather_amount, sibs[0].id: Fraction(1, 2)}
                groups.append(group)
                for heir in (grandfather, sibs[0]):
                    bases[heir.id] = (proof.AKDARIYYA, None, None)
            else:
                group = Group('grandfather', grandfather_amount, kind='grandfather')
                group.add(grandfather)
                groups.append(group)
                bases[grandfather.id] = (proof.GRANDFATHER_BEST_OPTION, 'with_siblings', grandfather_option)
                full = [h for h in sibs if h.rel in ('brother', 'sister')]
                paternal = [h for h in sibs if h.rel in ('paternal_brother', 'paternal_sister')]
                full_units = sum(2 if h.is_male() else 1 for h in full)
                paternal_units = sum(2 if h.is_male() else 1 for h in paternal)
                if not paternal:
                    full_total = pool
                elif not full:
                    full_total = zero
                elif self.paternal_siblings_counted_out():
                    full_total = pool
                elif any(h.is_male() for h in full):
                    full_total = pool
                else:
                    cap = Fraction(1, 2) if len(full) == 1 else Fraction(2, 3)
                    counted = pool * full_units / (full_units + paternal_units)
                    full_total = min(pool, max(counted, cap))
                for members, total in ((full, full_total), (paternal, pool - full_total)):
                    if not members:
                        continue
                    group = Group('full' if members is full else 'paternal', total, kind='siblings')
                    for heir in members:
                        group.add(heir, 1)
                    group.set_weights_by_sex()
                    groups.append(group)
                    if total == 0:
                        for heir in members:
                            if members is paternal and full and full_total > 0:
                                bases[heir.id] = (proof.RESIDUARY, 'excluded_by_full_siblings', None)
                            else:
                                bases[heir.id] = (proof.RESIDUARY, 'estate_exhausted', None)
        else:
            asaba = [h for h in live if h.asaba and h.id not in mushtaraka_ids]
            residual = max(zero, one - fixed_total)
            if asaba:
                group = Group('asaba', residual, kind='asaba')
                for heir in asaba:
                    group.add(heir, 1)
                group.set_weights_by_sex()
                groups.append(group)
                if residual == 0:
                    for heir in asaba:
                        bases[heir.id] = (proof.RESIDUARY, 'estate_exhausted', None)
            else:
                if self.has_female_descendent() and not self.has_male_descendent():
                    extra = next((g for g in groups if g.key in (('type', 'father'), ('type', 'grandfather'))), None)
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
        final = {heir.id: zero for heir in heirs}
        for group in groups:
            for heir, weight in zip(group.members, group.weights):
                final[heir.id] = group.final * weight / sum(group.weights)

        # shares: the lowest common base of the groups before awl or radd
        if not groups:
            base = 0
        elif all(g.kind == 'asaba' for g in groups):
            base = sum(groups[0].weights)
        else:
            dens = [g.stage.denominator for g in groups if g.stage > 0] or [1]
            base = lcm_list(dens)

        columns = {h.id: {'share': 0, 'shorted_share': 0, 'shortage_calc_share': 0, 'shortage_union_share': 0,
                          'correction': False} for h in heirs}
        merged = {}

        def put(group, column, values, fell_back):
            for heir, value in zip(group.members, values):
                columns[heir.id][column] = value
                if fell_back:
                    columns[heir.id]['correction'] = True
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
                    shortage_calc_shares = lcm_list([g.stage.denominator for g in radd_groups])
                    for group in radd_groups:
                        put(group, 'shorted_share', [remainder] * len(group.members), False)
                        put(group, 'shortage_calc_share', *group.column(shortage_calc_shares, group.stage))
                    shortage_union_shares = lcm_list([g.final.denominator for g in groups if g.final > 0] or [1])
                    final_base = shortage_union_shares
                    for group in groups:
                        put(group, 'shortage_union_share', *group.column(shortage_union_shares, group.final))
        correction = any(c['correction'] for c in columns.values())
        shares_corrected = 0
        if correction:
            dens = [f.denominator for f in final.values() if f > 0]
            shares_corrected = lcm_list([final_base or 1] + dens)

        for heir in heirs:
            heir.share = columns[heir.id]['share']
            heir.shorted_share = columns[heir.id]['shorted_share']
            heir.shortage_calc_share = columns[heir.id]['shortage_calc_share']
            heir.shortage_union_share = columns[heir.id]['shortage_union_share']
            fraction = final.get(heir.id, zero)
            heir.corrected_share = round(fraction * shares_corrected) if correction and not heir.blocked else 0
            if heir.id in bases:
                rule, condition, option = bases[heir.id]
                heir.set_basis(rule, condition, option=option)

        self._tag_school_rules(heirs, live, [h for g in radd_groups for h in g.members] if radd else [])
        left = one - sum(final.values(), zero)
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
        table = None
        if groups and base > 0:
            table = proof.build_table(
                [{'code': code, 'total': total_,
                  'values': {h.id: getattr(h, attr) for h in heirs},
                  'merged': {i for i, g in enumerate(groups) if mkey and id(g) in merged.get(mkey, ())}}
                 for code, attr, total_, mkey in spec],
                [[h.id for h in g.members] for g in groups],
                [h.id for h in heirs],
                {**{h.id: h.basis['fraction'] for h in heirs},
                 **{hid: share for g in groups for hid, share in g.prescribed.items()}},
                {h.id for h in heirs if h.blocked})
        steps = {
            'base': base,
            'awl': shares_excess if excess else None,
            'radd': final_base if radd else None,
            'correction': shares_corrected if correction else None,
            'unallocated': left if left > 0 else None,
        }
        return final, table, steps

    def _tag_school_rules(self, heirs, live, radd_members):
        """Name, on the heirs a school rule decided, the rule that applied. A heir keeps the first
        rule that tags it. The codes follow the rule values."""
        def tag(members, code):
            for heir in members:
                if heir.basis['school_rule'] is None:
                    heir.basis['school_rule'] = code
        if self.gf_meets_siblings():
            tag([h for h in heirs if h.rel in ('grandfather', 'brother', 'sister', 'paternal_brother', 'paternal_sister')],
                'grandfather_blocks_siblings' if self.grandfather_blocks_siblings()
                else 'grandfather_shares_with_siblings')
        if self.is_mushtaraka_family(self.live_counts()):
            tag([h for h in live if h.rel in ('brother', 'sister', 'maternal_brother', 'maternal_sister')],
                'mushtaraka' if self.rules['mushtaraka'] else 'no_mushtaraka')
        if (any(h.rel == 'father' for h in heirs) and any(h.rel == 'paternal_grandmother' for h in heirs)
                and not any(h.rel == 'mother' for h in heirs)):
            tag([h for h in heirs if h.rel in GRANDMOTHERS],
                'father_blocks_his_mother' if self.father_blocks_his_mother()
                else 'grandmother_inherits_with_her_son')
        if radd_members:
            tag(radd_members, 'radd_later_scholars' if self.rules['radd_position'] == 'radd_later_scholars' else 'radd')


@dataclass(frozen=True)
class Solved:
    """What the single-estate fiqh decided: the heirs in classification order, with the final
    fractions by id, the scholars' table (or None) and the facts of the steps."""
    heirs: Tuple[Heir, ...]
    final: Dict[str, Fraction]
    table: Optional[dict]
    steps: Dict[str, object]


def solve(entries, rules):
    """Classify and share one estate. `entries` is a list of (person id, relationship) in order of
    entry. Raises Refused('malikiyya_disputed') for the family the Maliki school disputes."""
    case = Case([Heir(id, rel) for id, rel in entries], rules)
    heirs = case.classify()
    live = case.live_counts()
    maternal = sum(1 for h in heirs if h.rel in ('maternal_brother', 'maternal_sister'))
    if case.has_descendent() or case.has('father'):
        maternal = 0
    if case.is_malikiyya_family(live, maternal):
        raise Refused('malikiyya_disputed')
    final, table, steps = case.distribute()
    return Solved(tuple(heirs), final, table, steps)
