# Implementation Patterns & Consistency Rules

## Pattern Categories Defined

**Critical Conflict Points Identified:**
14 areas where AI agents could make different choices

## Naming Patterns

**Database Naming Conventions:**
- Tables: snake_case plural (e.g., `inheritance_cases`)
- Columns: snake_case (e.g., `user_id`, `case_status`)
- FKs: `{table}_id` (e.g., `case_id`)
- Indexes: `idx_{table}_{column}`

**API Naming Conventions:**
- REST endpoints: plural nouns (e.g., `/cases`, `/heirs`)
- Route params: `{id}` in docs, `:id` in Next.js routes
- Query params: snake_case (e.g., `case_id`)
- Headers: `X-Request-ID`, `X-Client-Version`

**Code Naming Conventions:**
- React components: PascalCase (e.g., `FamilyTreeVisualizer`)
- Files: kebab-case (e.g., `family-tree-visualizer.tsx`)
- Functions: camelCase in TS, snake_case in Python
- Variables: camelCase in TS, snake_case in Python

## Structure Patterns

**Project Organization:**
- Frontend: `src/app`, `src/components`, `src/features`, `src/lib`, `src/types`
- Backend: `apps/` for Django apps, `core/` for shared utilities
- Tests: colocated `*.test.tsx` in frontend; `tests/` per app in backend

**File Structure Patterns:**
- Config: `.env.*` at repo root, `settings/` in Django
- Static assets: `public/` (frontend), `static/` (backend)
- Docs: `docs/` only; ADRs in `docs/adr/`

## Format Patterns

**API Response Formats:**
- Success: `{ "data": ..., "meta": ... }`
- Error: RFC 7807 Problem+JSON format

**Data Exchange Formats:**
- JSON fields: snake_case in API payloads
- Dates: ISO 8601 strings
- Booleans: true/false only

## Communication Patterns

**Event System Patterns:**
- If internal events used: `domain.action` (e.g., `case.created`)
- Payloads: `{ event_id, occurred_at, data }`

**State Management Patterns:**
- Server state: React Query
- UI state: Zustand store per feature, no cross-feature global store
- Immutable updates in TS

## Process Patterns

**Error Handling Patterns:**
- API errors normalized to Problem+JSON
- UI error banners use a single `AppError` shape

**Loading State Patterns:**
- Single `loading` boolean per feature slice
- Skeletons for tree + report views

## Enforcement Guidelines

**All AI Agents MUST:**
- Follow naming conventions by language (TS vs Python).
- Keep API payloads snake_case and map to camelCase at UI boundary.
- Use Problem+JSON for all error responses.

**Pattern Enforcement:**
- Linting rules + API contract tests
- PR checklist in `docs/adr/0001-patterns.md`

## Pattern Examples

**Good Examples:**
- `GET /api/v1/cases?case_id=123`
- `FamilyTreeVisualizer` in `family-tree-visualizer.tsx`

**Anti-Patterns:**
- `GET /api/v1/case/123`
- `UserCard.tsx` file name with `user_card` Python naming
