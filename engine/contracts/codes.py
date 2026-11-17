"""Vocabularies of the shared contracts. Identical to contracts/codes.json; a test keeps them equal."""

CONTRACT_VERSIONS = {"family": 1, "basis": 1, "result": 1, "comparison": 1, "presented_result": 2, "preset": 1, "catalog": 1}

RELATIONSHIPS = ('father', 'mother', 'husband', 'wife', 'son', 'daughter', 'son_of_son', 'daughter_of_son', 'grandfather', 'paternal_grandmother', 'maternal_grandmother', 'brother', 'sister', 'paternal_brother', 'paternal_sister', 'maternal_brother', 'maternal_sister', 'son_of_brother', 'son_of_paternal_brother', 'uncle', 'paternal_uncle', 'son_of_uncle', 'son_of_paternal_uncle')
GENDERS = ('male', 'female')
SCHOOLS = ('hanafi', 'maliki', 'shafii', 'hanbali', 'jafari')
SUNNI_SCHOOLS = ('hanafi', 'maliki', 'shafii', 'hanbali')
BASIS_KINDS = ('compare', 'school', 'country')
PERSON_STATUSES = ('alive', 'died_before_or_with', 'died_later')
REFUSAL_REASONS = ('school_not_supported', 'malikiyya_disputed', 'manasikhat_unsupported', 'invalid_family')
ALLOCATION_KINDS = ('fixed', 'residue', 'bequest', 'blocked', 'refused')
PROOF_RULES = ('fixed', 'fixed_and_residuary', 'residuary', 'blocked', 'grandfather_best_option', 'mushtaraka', 'akdariyya')
PROOF_CONDITIONS = ('male_descendant', 'female_descendant', 'descendant', 'no_descendant', 'siblings', 'no_descendant_or_siblings', 'spouse_and_father', 'with_son', 'with_son_of_son', 'with_daughter', 'with_brother', 'with_paternal_brother', 'with_grandfather', 'with_siblings', 'with_sister', 'with_maternal_siblings', 'no_mother', 'single', 'several', 'estate_exhausted', 'excluded_by_full_siblings')
BLOCKED_BY = ('male_descendant', 'descendant', 'father', 'grandfather', 'mother', 'son', 'daughters', 'brother', 'sisters', 'paternal_brother', 'paternal_sister', 'son_of_brother', 'son_of_paternal_brother', 'uncle', 'paternal_uncle', 'son_of_uncle')
PROOF_OPTIONS = ('muqasama', 'third_of_remainder', 'sixth_of_estate')
SCHOOL_RULES = ('grandfather_blocks_siblings', 'grandfather_shares_with_siblings', 'mushtaraka', 'no_mushtaraka', 'radd', 'radd_later_scholars', 'father_blocks_his_mother', 'grandmother_inherits_with_her_son')
PROOF_STEPS = ('base', 'awl', 'radd', 'correction', 'unallocated')
COMPARISON_OUTCOMES = ('agreement', 'difference', 'all_refused')
ERROR_CODES = ('invalid_contract', 'unsupported_version', 'invalid_basis', 'preset_unavailable')
REVIEW_STATES = ('reviewed', 'pending')
PARAM_TYPES = ('int', 'fraction', 'person', 'code', 'citation')
