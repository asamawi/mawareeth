# Phase Boundaries

## Delivery Strategy

The PRD defines a migration-first strategy: the current sprint is the Heroku-to-Hetzner migration of the existing Django application, and product modernization remains in scope only when it does not become a prerequisite for that migration.

## Phase 1: Infrastructure Stabilization and Heroku Exit

- Preserve the current Django monolith as one deployable WSGI service.
- Containerize the existing app, publish immutable artifacts, deploy through Caddy plus Docker Compose, and prove backup, monitoring, and blue-green release safety.
- Do not require Next.js, DRF extraction, or a `web/` plus `api/` repository split in this phase.

## Phase 2: Core Product Delivery

- Deliver the recursive Manasikhat graph solver and deterministic inheritance engine across the required schools.
- Deliver the guided interview, family tree visualization, proof-rich results, privacy-first case handling, and multilingual accessible UX.
- Deliver verified lawyer onboarding, lawyer selection, paid certification purchase, and auditable certified report delivery.
- If a split frontend and backend architecture is still desired, approve it as a separate modernization initiative before implementation.

## Phase 3: Universal Expansion

- Add Christian, Druze, and civil-law inheritance modules.
- Offer public OpenAPI and SDK surfaces for banking and legal-tech integrations.
- Deliver professional Arabic, English, and French localization.
- Expand the marketplace with membership tiers, sponsored placements, earned reviews, and further optimization.

## Phase 4: Visionary Intelligence

- Consider an LLM-based scholarly validator in the CI/CD loop.
- Consider immutable recording of verified distributions.
