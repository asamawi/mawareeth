"""Where a relative can be added: the anchor table behind the placement query.

An anchor is a person already in the family. `ANCHORS` maps the anchor's relationship to the
estate's deceased (or `root` for the deceased) onto the candidates that can be added at it. Each
candidate is `(link, relationship)`: `link` is the new person's role relative to the anchor and
`relationship` is the new person's relationship to the estate's deceased. Paths that have no
relationship code (a daughter's children, a son's wife) are absent. The orientation of the edge
a caller would record is `parent_of` from parent to child and `spouse_of` from the anchor to the new
person.
"""
from types import MappingProxyType

ROOT = 'root'

ANCHORS = MappingProxyType({
    ROOT: (('parent', 'father'), ('parent', 'mother'), ('spouse', 'husband'), ('spouse', 'wife'),
           ('child', 'son'), ('child', 'daughter')),
    'son': (('child', 'son_of_son'), ('child', 'daughter_of_son')),
    'father': (('parent', 'grandfather'), ('parent', 'paternal_grandmother'),
               ('child', 'brother'), ('child', 'sister'),
               ('child', 'paternal_brother'), ('child', 'paternal_sister')),
    'mother': (('parent', 'maternal_grandmother'),
               ('child', 'brother'), ('child', 'sister'),
               ('child', 'maternal_brother'), ('child', 'maternal_sister')),
    'grandfather': (('child', 'uncle'), ('child', 'paternal_uncle')),
    'brother': (('child', 'son_of_brother'),),
    'paternal_brother': (('child', 'son_of_paternal_brother'),),
    'uncle': (('child', 'son_of_uncle'),),
    'paternal_uncle': (('child', 'son_of_paternal_uncle'),),
})
