// Vocabularies of the shared contracts. Identical to contracts/codes.json; a test keeps them equal.

export const CONTRACT_VERSIONS = { family: 1, basis: 1, result: 1, comparison: 1, presented_result: 1, preset: 1, catalog: 1 } as const;

export const CODES = {
  relationships: ["father", "mother", "husband", "wife", "son", "daughter", "son_of_son", "daughter_of_son", "grandfather", "paternal_grandmother", "maternal_grandmother", "brother", "sister", "paternal_brother", "paternal_sister", "maternal_brother", "maternal_sister", "son_of_brother", "son_of_paternal_brother", "uncle", "paternal_uncle", "son_of_uncle", "son_of_paternal_uncle"] as readonly string[],
  genders: ["male", "female"] as readonly string[],
  schools: ["hanafi", "maliki", "shafii", "hanbali", "jafari"] as readonly string[],
  sunni_schools: ["hanafi", "maliki", "shafii", "hanbali"] as readonly string[],
  basis_kinds: ["compare", "school", "country"] as readonly string[],
  person_statuses: ["alive", "died_before_or_with", "died_later"] as readonly string[],
  refusal_reasons: ["school_not_supported", "malikiyya_disputed", "manasikhat_unsupported", "invalid_family"] as readonly string[],
  allocation_kinds: ["fixed", "residue", "bequest", "blocked", "refused"] as readonly string[],
  proof_rules: ["fixed", "fixed_and_residuary", "residuary", "blocked", "grandfather_best_option", "mushtaraka", "akdariyya"] as readonly string[],
  proof_conditions: ["male_descendant", "female_descendant", "descendant", "no_descendant", "siblings", "no_descendant_or_siblings", "spouse_and_father", "with_son", "with_son_of_son", "with_daughter", "with_brother", "with_paternal_brother", "with_grandfather", "with_siblings", "with_sister", "with_maternal_siblings", "no_mother", "single", "several", "estate_exhausted", "excluded_by_full_siblings"] as readonly string[],
  blocked_by: ["male_descendant", "descendant", "father", "grandfather", "mother", "son", "daughters", "brother", "sisters", "paternal_brother", "paternal_sister", "son_of_brother", "son_of_paternal_brother", "uncle", "paternal_uncle", "son_of_uncle"] as readonly string[],
  proof_options: ["muqasama", "third_of_remainder", "sixth_of_estate"] as readonly string[],
  school_rules: ["grandfather_blocks_siblings", "grandfather_shares_with_siblings", "mushtaraka", "no_mushtaraka", "radd", "radd_later_scholars", "father_blocks_his_mother", "grandmother_inherits_with_her_son"] as readonly string[],
  proof_steps: ["base", "awl", "radd", "correction", "unallocated"] as readonly string[],
  comparison_outcomes: ["agreement", "difference", "all_refused"] as readonly string[],
  error_codes: ["invalid_contract", "unsupported_version", "invalid_basis", "preset_unavailable"] as readonly string[],
  review_states: ["reviewed", "pending"] as readonly string[],
  param_types: ["int", "fraction", "person", "code", "citation"] as readonly string[],
};
