# Epic 2 Context: Multi-School Deterministic Inheritance Engine

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Users receive deterministic inheritance calculations for all 4 Sunni Madhabs and the Jafari school, with measurable rule coverage, proof output, and no manual overrides. The engine is the product's core differentiator: a modular, rule-based "Logic-as-Code" calculator that isolates school-specific rules and can resolve multi-generational Manasikhat cascades that today need elite scholarly intervention.

## Stories

- Story 2.1: Standard Share Calculation Across All Required Schools
- Story 2.2: Deterministic Proof Output for Multi-School Results
- Story 2.3: Expanded Multi-School Coverage Beyond Standard Cases
- Story 2.4: Full Recursive Manasikhat Calculation

## Requirements & Constraints

- Shares must be calculated for the 4 Sunni Madhabs and the Jafari school, and results must differ where school rules differ.
- Every share distribution carries a deterministic, structured mathematical proof; identical input plus school selection must always yield identical results and proof structure. Proofs must reflect the school-specific legal basis where schools diverge.
- Manasikhat (successive, multi-generational inheritance) is resolved recursively end to end.
- No manual overrides of engine output. Fixes happen only at the engine level.
- Blocked or invalid heir data must make the calculation fail safely.
- Unsupported scenarios (including recursion beyond supported scope) must return an explicit unsupported-case response that distinguishes unsupported scope from a generic engine failure. Never silently degrade to an incorrect result.
- Performance targets: standard calculations under 200ms; complex Manasikhat under 1s.
- Determinism is maintained through versioned engine updates.

## Technical Decisions

- The delivery stack is the one in `epic-1-context.md`: Next.js and DRF, approved by the project owner on 2026-11-05. The planning line about Epic 0 predates that.
- The target is a pure domain module with no database writes. On 2026-11-07 the project owner chose to build on the fixed `Calculation.compute()` instead, so today it still writes, and a school-specific run must happen inside a transaction that is rolled back.
- The engine is a pure domain module: strict input validation, no DB writes, and it works from read-only snapshots of case data.
- Engine output is consumed downstream by reporting (PDF and HTML), verification, and audit, so the output shape and proof structure are a contract. Contract tests verify UI/engine alignment.
- Rules are modular per Madhab so school-specific logic stays isolated.

## Cross-Story Dependencies

- 2.2 builds on the calculation output of 2.1. 2.3 extends 2.1 coverage. 2.4 builds on 2.3 coverage and the proof structure from 2.2.
- Epic 1 (Story 1.5 live preview, Story 1.6 validation and hajb) consumes engine output and its supported-case boundary. Preview must not show numbers for cases the engine reports as unsupported.
- Epic 3 (results view, PDF report) renders engine shares, proofs, and citations, so the proof output shape must stay stable.
- Epic 7 (certification audit) later relies on engine discrepancies being traceable.
