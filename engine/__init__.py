"""The pure calculation core and its shared contracts. Standard library only."""
from .core import Evaluation, calculate, evaluate, final_shares, thaw
from .rule_set import RuleSet, parse_preset, school_rule_set

__all__ = ['Evaluation', 'RuleSet', 'calculate', 'evaluate', 'final_shares', 'parse_preset', 'school_rule_set', 'thaw']

from .queries import (Options, Impact, relationship_options, change_impossible, deceased_gender_conflict, delete_impact, placement_options, Placement, refusal, required_facts, share_changing_presets)

__all__ += ['Options', 'Impact', 'relationship_options', 'change_impossible', 'deceased_gender_conflict', 'delete_impact', 'placement_options', 'Placement', 'refusal', 'required_facts', 'share_changing_presets']
